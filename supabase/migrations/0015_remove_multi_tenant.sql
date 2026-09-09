-- Remove o modelo multi-tenant: o painel passa a servir uma única
-- organização, com uma conexão de n8n e uma de Infisical só, sem conceito de
-- "empresa" nenhum. `empresas`, `membros` e o isolamento por cliente dentro
-- do Infisical (`infisical_caminhos_clientes`) deixam de existir.
--
-- Combinado com o pedido: zera os dados de teste (Scopo/Oystr/Admin, 2
-- automações, 0 execuções reais) em vez de tentar migrá-los — não havia
-- histórico de verdade para preservar.
--
-- Papel por usuário substitui papel por empresa: cada linha de `perfis` ganha
-- `papel` (admin | usuario) e `status` (ativo | inativo), direto na tabela,
-- já que não existe mais `membros` para guardar isso. Só dois níveis de
-- acesso: administrador (tudo, inclusive integrações e outros usuários) e
-- usuário (opera automações, não mexe em integrações nem em papéis).

/* ------------------------- Remove o multi-tenant ------------------------- */

-- Derrubar os helpers com CASCADE já remove toda policy que dependia deles —
-- é basicamente todo o RLS multi-tenant (empresas, membros, automacoes,
-- execucoes, logs_execucao, infisical_caminhos_clientes e as integrações de
-- plataforma). Menos risco de esquecer uma policy órfã do que listar cada
-- `drop policy` à mão.
drop function privado.pode_escrever(uuid) cascade;
drop function privado.eh_admin(uuid) cascade;
drop function privado.eh_admin_plataforma() cascade;
drop function privado.empresas_do_usuario() cascade;

-- Sem histórico real para preservar (0 execuções, 0 logs) — descarta as
-- automações de teste junto com o que dependia delas.
truncate table public.automacoes cascade;

drop table public.infisical_caminhos_clientes;
drop table public.membros;
drop table public.empresas cascade;

alter table public.automacoes         drop column empresa_id;
alter table public.automacao_segredos drop column empresa_id;
alter table public.execucoes          drop column empresa_id;
alter table public.logs_execucao      drop column empresa_id;

drop type public.papel_membro;

/* ------------------------- Papel por usuário ------------------------- */

create type public.papel_usuario  as enum ('admin', 'usuario');
create type public.status_usuario as enum ('ativo', 'inativo');

alter table public.perfis add column papel  public.papel_usuario  not null default 'usuario';
alter table public.perfis add column status public.status_usuario not null default 'ativo';

drop type public.status_membro;

-- Bootstrap: os perfis que já existiam (as contas reais de quem já usava o
-- painel) viram admin, para ninguém ficar trancado do lado de fora depois
-- desta migração.
update public.perfis set papel = 'admin';

-- Dali em diante, quem se cadastra primeiro vira admin automaticamente; o
-- restante entra como usuário comum. Sem tabela de convite/aprovação — quem
-- se autentica pelo Supabase Auth já tem acesso ao painel.
create or replace function privado.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    case when exists (select 1 from public.perfis) then 'usuario' else 'admin' end
  );
  return new;
end;
$$;

/* ------------------------------- Helpers -------------------------------- */

create function privado.esta_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and status = 'ativo'
  )
$$;

create function privado.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfis
    where id = auth.uid() and status = 'ativo' and papel = 'admin'
  )
$$;

revoke all on function privado.esta_ativo() from public;
revoke all on function privado.eh_admin()   from public;
grant execute on function privado.esta_ativo() to authenticated, anon;
grant execute on function privado.eh_admin()   to authenticated, anon;

/* --------------------------------- RLS ----------------------------------- */

-- perfis: todo mundo lê a própria linha (mesmo inativo — precisa continuar
-- vendo o próprio nome); ativos leem os colegas também. Só admin muda papel
-- ou status de alguém; a própria pessoa só altera o resto do perfil — a
-- subconsulta em `with check` compara com o valor já salvo, então um usuário
-- comum não consegue se promover a admin escrevendo direto na tabela.
--
-- `perfis_leitura`/`perfis_proprio` já existiam desde o schema inicial e não
-- dependiam de nenhum dos helpers derrubados acima (então o CASCADE não as
-- limpou) — precisam ser recriadas explicitamente com a nova regra.
drop policy if exists perfis_leitura on public.perfis;
drop policy if exists perfis_proprio on public.perfis;

create policy perfis_leitura on public.perfis
  for select using (id = auth.uid() or privado.esta_ativo());

create policy perfis_proprio on public.perfis
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and papel  = (select atual.papel  from public.perfis atual where atual.id = auth.uid())
    and status = (select atual.status from public.perfis atual where atual.id = auth.uid())
  );

create policy perfis_admin_gestao on public.perfis
  for update using (privado.eh_admin())
  with check (privado.eh_admin());

-- automacoes / execucoes / logs_execucao: leitura para qualquer pessoa ativa;
-- escrita de automações para admin e usuário (ambos operam o dia a dia).
-- `execucoes`/`logs_execucao` continuam sem policy de escrita: quem grava é
-- o agendador, com a secret key, que ignora RLS.
create policy automacoes_leitura on public.automacoes
  for select using (privado.esta_ativo());

create policy automacoes_escrita on public.automacoes
  for all using (privado.esta_ativo())
  with check (privado.esta_ativo());

create policy execucoes_leitura on public.execucoes
  for select using (privado.esta_ativo());

create policy logs_leitura on public.logs_execucao
  for select using (privado.esta_ativo());

-- `automacao_segredos` segue sem policy nenhuma, de propósito: só o executor
-- (secret key) lê os valores.

/* ------------------------ Integrações (uma só) --------------------------- */

-- Já eram conexões únicas (uma conta de n8n, um projeto Infisical); o nome
-- "_plataforma" só fazia sentido quando existia uma empresa Admin distinta
-- das empresas clientes. Sem tenants, a conexão é só "a conexão do painel".
alter table public.integracao_n8n_plataforma        rename to integracao_n8n;
alter table public.integracao_n8n_plataforma_segredo rename to integracao_n8n_segredo;
alter table public.integracao_infisical_plataforma        rename to integracao_infisical;
alter table public.integracao_infisical_plataforma_segredo rename to integracao_infisical_segredo;

-- Substitui `infisical_caminhos_clientes` (uma pasta por empresa): agora só
-- existe uma organização, então uma pasta só, guardada junto do resto da
-- conexão.
alter table public.integracao_infisical add column caminho text not null default '/';

-- Leitura liberada para qualquer pessoa ativa (não é segredo, é só a conexão
-- configurada); só admin conecta ou reconfigura.
create policy integracao_n8n_leitura on public.integracao_n8n
  for select using (privado.esta_ativo());

create policy integracao_n8n_insercao on public.integracao_n8n
  for insert with check (privado.eh_admin());

create policy integracao_n8n_atualizacao on public.integracao_n8n
  for update using (privado.eh_admin())
  with check (privado.eh_admin());

create policy integracao_infisical_leitura on public.integracao_infisical
  for select using (privado.esta_ativo());

create policy integracao_infisical_insercao on public.integracao_infisical
  for insert with check (privado.eh_admin());

create policy integracao_infisical_atualizacao on public.integracao_infisical
  for update using (privado.eh_admin())
  with check (privado.eh_admin());

-- Segredos: sem policy de SELECT (só o executor, com a secret key, lê); só
-- admin pode gravar.
create policy integracao_n8n_segredo_insercao on public.integracao_n8n_segredo
  for insert with check (privado.eh_admin());

create policy integracao_n8n_segredo_atualizacao on public.integracao_n8n_segredo
  for update using (privado.eh_admin())
  with check (privado.eh_admin());

create policy integracao_infisical_segredo_insercao on public.integracao_infisical_segredo
  for insert with check (privado.eh_admin());

create policy integracao_infisical_segredo_atualizacao on public.integracao_infisical_segredo
  for update using (privado.eh_admin())
  with check (privado.eh_admin());
