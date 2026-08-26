-- Reformula n8n e Infisical de "uma conexão por empresa" para "uma conexão
-- compartilhada, gerida pela Broad, com clientes isolados dentro dela".
--
-- O desenho anterior assumia que cada empresa tinha sua própria instância de
-- n8n e seu próprio projeto Infisical. Não é o caso: a Broad centraliza uma
-- conta de n8n e um projeto Infisical para todos os clientes. Nenhuma das
-- tabelas antigas tinha linha nenhuma em produção — dá para substituir limpo.

-- Marca qual empresa é a Broad. Só pode haver uma.
alter table public.empresas add column eh_plataforma boolean not null default false;

create unique index empresas_uma_plataforma
    on public.empresas ((true))
 where eh_plataforma;

update public.empresas set eh_plataforma = true
 where nome = 'Broad';

-- SECURITY DEFINER pelo mesmo motivo de `eh_admin`: a policy de
-- `infisical_caminhos_clientes` (abaixo) precisa consultar `membros`.
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

revoke all on function privado.eh_admin_plataforma() from public;
grant execute on function privado.eh_admin_plataforma() to authenticated, anon;

/* ------------------------------- n8n -------------------------------- */

drop table public.integracoes_n8n_segredos;
drop table public.integracoes_n8n;

-- Singleton: `id boolean primary key default true` com `check (id)` garante
-- no máximo uma linha — não existe `false` possível de inserir.
create table public.integracao_n8n_plataforma (
  id            boolean primary key default true,
  instancia_url text not null,
  criada_em     timestamptz not null default now(),
  check (id)
);

create table public.integracao_n8n_plataforma_segredo (
  id            boolean primary key default true,
  api_key       text not null,
  atualizado_em timestamptz not null default now(),
  check (id)
);

alter table public.integracao_n8n_plataforma        enable row level security;
alter table public.integracao_n8n_plataforma_segredo enable row level security;

create policy integracao_n8n_plataforma_gestao on public.integracao_n8n_plataforma
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- `integracao_n8n_plataforma_segredo` fica sem policy de propósito: só o
-- sincronizador, com a secret key do Supabase, enxerga a chave de API.

/* ----------------------------- Infisical ------------------------------ */

drop table public.integracoes_infisical_segredos;
drop table public.integracoes_infisical;

create table public.integracao_infisical_plataforma (
  id               boolean primary key default true,
  site_url         text not null default 'https://app.infisical.com',
  client_id        text not null,
  projeto_id       text not null,
  ambiente         text not null default 'prod',
  injetar_segredos boolean not null default true,
  mascarar_valores boolean not null default true,
  criada_em        timestamptz not null default now(),
  check (id)
);

create table public.integracao_infisical_plataforma_segredo (
  id            boolean primary key default true,
  client_secret text not null,
  atualizado_em timestamptz not null default now(),
  check (id)
);

alter table public.integracao_infisical_plataforma        enable row level security;
alter table public.integracao_infisical_plataforma_segredo enable row level security;

create policy integracao_infisical_plataforma_gestao on public.integracao_infisical_plataforma
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- Pasta de segredos de cada cliente dentro do projeto compartilhado — é o que
-- impede a automação de um cliente enxergar a pasta de outro. Só a Broad
-- define; cada empresa só lê a própria linha.
create table public.infisical_caminhos_clientes (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  caminho       text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.infisical_caminhos_clientes enable row level security;

create policy infisical_caminhos_leitura on public.infisical_caminhos_clientes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy infisical_caminhos_gestao on public.infisical_caminhos_clientes
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());
