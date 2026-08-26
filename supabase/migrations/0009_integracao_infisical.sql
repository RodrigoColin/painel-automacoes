-- Conecta a empresa a um projeto do Infisical, para os segredos usados pelas
-- automações virem de lá em vez de ficarem espalhados no painel.
--
-- Mesmo padrão de integracoes_n8n: URL/projeto/ambiente ficam numa tabela
-- legível pelos membros; o Client Secret da Machine Identity fica numa tabela
-- separada, sem policy nenhuma, para nunca ser lido pelo cliente. O Client ID
-- não é sensível sozinho (é só o identificador da identidade — o Infisical
-- trata como um "usuário"), então fica junto com o resto da conexão.

create table public.integracoes_infisical (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  site_url      text not null default 'https://app.infisical.com',
  client_id     text not null,
  projeto_id    text not null,
  ambiente      text not null default 'prod',
  caminho_base  text not null default '/',
  criada_em     timestamptz not null default now()
);

create table public.integracoes_infisical_segredos (
  empresa_id     uuid primary key references public.empresas (id) on delete cascade,
  client_secret  text not null,
  atualizado_em  timestamptz not null default now()
);

alter table public.integracoes_infisical          enable row level security;
alter table public.integracoes_infisical_segredos enable row level security;

create policy integracoes_infisical_leitura on public.integracoes_infisical
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy integracoes_infisical_escrita on public.integracoes_infisical
  for all using (privado.eh_admin(empresa_id))
  with check (privado.eh_admin(empresa_id));

-- `integracoes_infisical_segredos` fica sem policy de propósito: só quem lê
-- com a secret key do Supabase (o executor) enxerga o Client Secret.
