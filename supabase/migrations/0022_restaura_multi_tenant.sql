-- Restaura o modelo multi-tenant desfeito pela 0015.
--
-- Contexto: a 0015 e as seis seguintes foram aplicadas direto no banco, sem
-- passar por este repositório — o código aqui nunca deixou de ser
-- multi-tenant. Em vez de reescrever o app para single-tenant, esta migração
-- traz o banco de volta ao modelo que o código já implementa, preservando o
-- que as 0016-0021 acrescentaram.
--
-- O modelo é o mesmo de antes: `empresas` com uma única `eh_plataforma` (a
-- Proos), `membros` ligando pessoa a empresa com papel, e quatro helpers em
-- `privado` como ponto único de autorização — quem enxerga uma empresa
-- (`empresas_do_usuario`), quem é admin de plataforma (`eh_admin_plataforma`),
-- quem administra uma empresa (`eh_admin`) e quem escreve nela
-- (`pode_escrever`). Admin da Proos alcança todas as empresas por esses
-- helpers; cliente não enxerga nem a Proos nem os outros clientes.
--
-- As tabelas que a 0019 criou (`arquivos`) e o tipo `upload` da 0018 são
-- mantidos e passam a ser isolados por empresa como o resto.

/* ------------------- Desmonta o que prende ao single-tenant -------------- */

-- Papel volta a viver em `membros` (por empresa), então o papel global em
-- `perfis` e a trava do "último admin" perdem o sentido.
drop trigger if exists impede_remover_ultimo_admin on public.perfis;
drop function if exists privado.impede_remover_ultimo_admin();

-- Referencia `perfis.papel`/`perfis.status` no `with check`; precisa sair
-- antes das colunas.
drop policy if exists perfis_proprio on public.perfis;

-- CASCADE derruba junto toda policy single-tenant que dependia destes dois
-- helpers — automacoes, execucoes, logs_execucao, perfis, arquivos, as
-- integrações e as duas policies de bucket no Storage.
drop function privado.esta_ativo() cascade;
drop function privado.eh_admin() cascade;

alter table public.perfis drop column papel;
alter table public.perfis drop column status;

drop type public.papel_usuario;
drop type public.status_usuario;

/* ----------------------------- Empresas ---------------------------------- */

create type public.papel_membro  as enum ('admin', 'editor', 'leitor');
create type public.status_membro as enum ('ativo', 'convidado', 'inativo');

create table public.empresas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text,
  email         text,
  eh_plataforma boolean not null default false,
  criada_em     timestamptz not null default now()
);

-- Só pode haver uma empresa de plataforma.
create unique index empresas_uma_plataforma
    on public.empresas ((true))
 where eh_plataforma;

-- Vínculo pessoa <-> empresa: é esta tabela que define o que cada usuário
-- enxerga, e o que alimenta o `empresa-switcher` da UI.
create table public.membros (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  user_id    uuid not null references public.perfis (id)   on delete cascade,
  papel      public.papel_membro  not null default 'leitor',
  status     public.status_membro not null default 'convidado',
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

create index on public.membros (user_id);

/* --------------------- Devolve `empresa_id` às tabelas ------------------- */

-- Todas estão vazias (a 0015 truncou `automacoes` em cascata e `arquivos`
-- nunca chegou a receber linha), então `not null` entra direto, sem backfill.
alter table public.automacoes         add column empresa_id uuid not null references public.empresas (id) on delete cascade;
alter table public.automacao_segredos add column empresa_id uuid not null references public.empresas (id) on delete cascade;
alter table public.execucoes          add column empresa_id uuid not null references public.empresas (id) on delete cascade;
alter table public.logs_execucao      add column empresa_id uuid not null references public.empresas (id) on delete cascade;
alter table public.arquivos           add column empresa_id uuid not null references public.empresas (id) on delete cascade;

create index on public.automacoes (empresa_id);
create index on public.execucoes  (empresa_id, iniciada_em desc);
create index on public.arquivos   (empresa_id, enviado_em desc);

/* ------------------------------ Integrações ------------------------------ */

-- Volta a nomenclatura "_plataforma": a conexão é única e gerida pela Proos,
-- mas existe de novo uma distinção entre a empresa de plataforma e as
-- clientes. O `rename` preserva as linhas já configuradas (a instância n8n e
-- sua chave de API continuam valendo).
alter table public.integracao_n8n                 rename to integracao_n8n_plataforma;
alter table public.integracao_n8n_segredo         rename to integracao_n8n_plataforma_segredo;
alter table public.integracao_infisical           rename to integracao_infisical_plataforma;
alter table public.integracao_infisical_segredo   rename to integracao_infisical_plataforma_segredo;

-- A pasta única volta a ser uma pasta por cliente.
alter table public.integracao_infisical_plataforma drop column caminho;

-- Pasta de segredos de cada cliente dentro do projeto Infisical
-- compartilhado — é o que impede a automação de um cliente enxergar a pasta
-- de outro. Só a Proos define; cada empresa lê apenas a própria linha.
create table public.infisical_caminhos_clientes (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  caminho       text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.infisical_caminhos_clientes enable row level security;

/* -------------------------------- Helpers -------------------------------- */

-- SECURITY DEFINER de propósito, nos quatro: as policies precisam consultar
-- `membros`, e sem isso o RLS entraria em recursão infinita (ver 0003).

create function privado.eh_admin_plataforma()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.membros m
      join public.empresas e on e.id = m.empresa_id
     where m.user_id = auth.uid()
       and m.status = 'ativo'
       and m.papel = 'admin'
       and e.eh_plataforma
  )
$$;

-- Admin de plataforma enxerga todas as empresas; os demais, só aquelas em
-- que têm vínculo ativo.
create function privado.empresas_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.empresas where privado.eh_admin_plataforma()
  union
  select empresa_id from public.membros
  where user_id = auth.uid() and status = 'ativo'
$$;

create function privado.eh_admin(alvo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select privado.eh_admin_plataforma() or exists (
    select 1 from public.membros
    where user_id = auth.uid()
      and empresa_id = alvo
      and status = 'ativo'
      and papel = 'admin'
  )
$$;

create function privado.pode_escrever(alvo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select privado.eh_admin_plataforma() or exists (
    select 1 from public.membros
    where user_id = auth.uid()
      and empresa_id = alvo
      and status = 'ativo'
      and papel in ('admin', 'editor')
  )
$$;

revoke all on function privado.eh_admin_plataforma()  from public;
revoke all on function privado.empresas_do_usuario()  from public;
revoke all on function privado.eh_admin(uuid)         from public;
revoke all on function privado.pode_escrever(uuid)    from public;

grant execute on function privado.eh_admin_plataforma() to authenticated, anon;
grant execute on function privado.empresas_do_usuario() to authenticated, anon;
grant execute on function privado.eh_admin(uuid)        to authenticated;
grant execute on function privado.pode_escrever(uuid)   to authenticated;

-- Perfil volta a nascer sem papel: quem define o acesso é a linha em
-- `membros`, criada pelo convite.
create or replace function privado.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email
  );
  return new;
end;
$$;

/* ---------------------------------- RLS ---------------------------------- */

alter table public.empresas enable row level security;
alter table public.membros  enable row level security;

-- empresas: enxerga as suas; só admin da empresa altera; só a Proos cria.
create policy empresas_leitura on public.empresas
  for select using (id in (select privado.empresas_do_usuario()));

create policy empresas_escrita on public.empresas
  for update using (privado.eh_admin(id))
  with check (privado.eh_admin(id));

create policy empresas_insercao on public.empresas
  for insert with check (privado.eh_admin_plataforma());

-- perfis: o próprio, e quem divide empresa com você (a tela /usuarios).
create policy perfis_leitura on public.perfis
  for select using (
    id = auth.uid()
    or id in (
      select user_id from public.membros
      where empresa_id in (select privado.empresas_do_usuario())
    )
  );

create policy perfis_proprio on public.perfis
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- membros: lista quem divide empresa com você; só admin mexe.
create policy membros_leitura on public.membros
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy membros_admin on public.membros
  for all using (privado.eh_admin(empresa_id))
  with check (privado.eh_admin(empresa_id));

-- automacoes / execucoes / logs: leitura para membros da empresa, escrita só
-- para admin e editor. `execucoes`/`logs_execucao` seguem sem policy de
-- escrita: quem grava é o agendador, com a secret key, que ignora RLS.
create policy automacoes_leitura on public.automacoes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy automacoes_escrita on public.automacoes
  for all using (privado.pode_escrever(empresa_id))
  with check (privado.pode_escrever(empresa_id));

create policy execucoes_leitura on public.execucoes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy logs_leitura on public.logs_execucao
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- arquivos: mesmo isolamento das automações. Ninguém edita o metadado depois
-- de enviado — reenviar é a forma de substituir um arquivo.
create policy arquivos_leitura on public.arquivos
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy arquivos_insercao on public.arquivos
  for insert with check (privado.pode_escrever(empresa_id) and enviado_por = auth.uid());

create policy arquivos_exclusao on public.arquivos
  for delete using (privado.eh_admin(empresa_id) or enviado_por = auth.uid());

-- Caminhos do Infisical: cada empresa lê o próprio; só a Proos define.
create policy infisical_caminhos_leitura on public.infisical_caminhos_clientes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy infisical_caminhos_gestao on public.infisical_caminhos_clientes
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- Integrações: leitura para quem tem empresa (é só a conexão configurada,
-- não o segredo); só a Proos conecta ou reconfigura.
create policy integracao_n8n_plataforma_gestao on public.integracao_n8n_plataforma
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_gestao on public.integracao_infisical_plataforma
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- Segredos: sem policy de SELECT (só o executor, com a secret key, lê), mas
-- com INSERT/UPDATE para a Proos poder salvar a chave pela tela (ver 0013).
create policy integracao_n8n_plataforma_segredo_insercao
  on public.integracao_n8n_plataforma_segredo
  for insert with check (privado.eh_admin_plataforma());

create policy integracao_n8n_plataforma_segredo_atualizacao
  on public.integracao_n8n_plataforma_segredo
  for update using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_segredo_insercao
  on public.integracao_infisical_plataforma_segredo
  for insert with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_segredo_atualizacao
  on public.integracao_infisical_plataforma_segredo
  for update using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- `automacao_segredos` segue sem policy nenhuma, de propósito: só o executor
-- (secret key) lê os valores.

/* -------------------------------- Storage -------------------------------- */

-- As duas policies de bucket caíram no CASCADE junto com `esta_ativo()`.
-- Voltam exigindo vínculo ativo com alguma empresa; o metadado em
-- `public.arquivos` (com RLS por empresa) é que autoriza a operação de fato.
create policy automacao_uploads_insercao on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'automacao-uploads'
    and exists (select 1 from privado.empresas_do_usuario())
  );

create policy arquivos_bucket_insercao on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'arquivos'
    and exists (select 1 from privado.empresas_do_usuario())
  );

-- Passa a contar por empresa. Deixa de ser SECURITY DEFINER sobre
-- `storage.objects` (que somava o bucket inteiro, de todo mundo) e passa a
-- somar `public.arquivos` como INVOKER — assim o próprio RLS da tabela já
-- restringe o total ao que a pessoa enxerga.
create or replace function public.armazenamento_bytes_usados()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(tamanho_bytes), 0)::bigint from public.arquivos
$$;

revoke all on function public.armazenamento_bytes_usados() from public, anon;
grant execute on function public.armazenamento_bytes_usados() to authenticated;

/* --------------------------------- Seed ---------------------------------- */

-- Recria a empresa de plataforma e as duas clientes. Os cadastros anteriores
-- (CNPJ, e-mail) foram perdidos na 0015 junto com a tabela; ficam só os
-- nomes, o resto se preenche pela tela.
with proos as (
  insert into public.empresas (nome, eh_plataforma)
  values ('Proos', true)
  returning id
)
insert into public.membros (empresa_id, user_id, papel, status)
select proos.id, p.id, 'admin', 'ativo'
  from proos, public.perfis p;

insert into public.empresas (nome) values ('Scopo'), ('Oystr');
