-- Admin da empresa de plataforma (Admin) passa a ter acesso total — leitura
-- e escrita — a todas as empresas, não só à própria. Em vez de tocar em cada
-- policy de cada tabela, o efeito é obtido atualizando os três helpers que
-- toda a autorização multi-tenant já usa como ponto único: quem enxerga uma
-- empresa (`empresas_do_usuario`), quem administra uma empresa (`eh_admin`) e
-- quem pode escrever numa empresa (`pode_escrever`). Toda policy que já
-- depende deles (empresas, membros, automacoes, execucoes, logs_execucao,
-- infisical_caminhos_clientes, ...) passa a valer para admin de plataforma
-- automaticamente, sem migração adicional.

create or replace function privado.empresas_do_usuario()
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

create or replace function privado.eh_admin(alvo uuid)
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

create or replace function privado.pode_escrever(alvo uuid)
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
