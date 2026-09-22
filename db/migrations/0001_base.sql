-- Schema base do painel fora do Supabase.
--
-- Consolida o estado final das migrações 0001–0035 de `supabase/migrations`
-- (histórico mantido lá, só para consulta), sem o que era do Supabase:
-- Storage (os arquivos vão para disco, ver `src/lib/armazenamento.ts`), Vault
-- e pg_cron/pg_net (os disparos saem do container `cron`, ver
-- `deploy/cron/crontab`) e Realtime (nunca usado pelo app).
--
-- O modelo de autorização é o mesmo: RLS no banco como segunda barreira,
-- atrás do DAL. Para as policies continuarem valendo sem mudança, reproduz a
-- peça do Supabase de que elas dependem — `auth.uid()` e o papel
-- `authenticated`. O app, em cada consulta feita em nome de alguém, abre uma
-- transação com `set local role authenticated` e grava o id da pessoa em
-- `painel.usuario_id` (ver `src/lib/db/index.ts`).
--
-- PRÉ-REQUISITO: o papel de login do app (`painel_app`) já existe — é criado
-- pelo `deploy/postgres/init.sh` na primeira subida do container, porque a
-- senha vem do ambiente e não pode ficar versionada aqui.

/* --------------------------------- Papéis -------------------------------- */

-- Papel sem login em que as consultas "em nome de alguém" rodam. Não tem
-- BYPASSRLS, então toda policy se aplica. Papel é do cluster, não do banco:
-- o guard deixa recriar o banco sem derrubar o papel.
do $$
begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- O app entra como `painel_app` e troca para `authenticated` quando consulta
-- em nome de alguém. Fora disso (agendador, sincronizações, gestão de conta),
-- ignora o RLS — o equivalente à secret key do Supabase.
grant authenticated to painel_app;
alter role painel_app bypassrls;

/* ------------------------------ Autenticação ----------------------------- */

create schema auth;

-- Substitui `auth.users` do Supabase. A senha é bcrypt: os hashes migrados do
-- Supabase Auth (também bcrypt) continuam valendo sem ninguém trocar senha.
create table auth.usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  senha_hash    text not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index usuarios_email_unico on auth.usuarios (lower(email));

-- Sessão opaca: o cookie leva um token aleatório; aqui fica só o SHA-256 dele,
-- para um vazamento do banco não entregar sessões válidas.
create table auth.sessoes (
  token_hash  text primary key,
  usuario_id  uuid not null references auth.usuarios (id) on delete cascade,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null
);

create index on auth.sessoes (usuario_id);
create index on auth.sessoes (expira_em);

-- Mesmo contrato do `auth.uid()` do Supabase: nulo sem sessão, o que faz
-- todas as policies negarem.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('painel.usuario_id', true), '')::uuid
$$;

-- `authenticated` só enxerga a função, nunca as tabelas de credenciais.
grant usage on schema auth to authenticated;
revoke all on function auth.uid() from public;
grant execute on function auth.uid() to authenticated;

grant usage on schema auth to painel_app;
grant select, insert, update, delete on auth.usuarios, auth.sessoes to painel_app;

/* --------------------------------- Enums --------------------------------- */

create type public.status_automacao   as enum ('ativa', 'pausada', 'rascunho');
create type public.tipo_automacao     as enum ('python-cron', 'n8n', 'upload');
create type public.resultado_execucao as enum ('sucesso', 'erro', 'em_andamento');
create type public.nivel_log          as enum ('info', 'aviso', 'erro');
create type public.papel_membro       as enum ('admin', 'editor', 'leitor');
create type public.status_membro      as enum ('ativo', 'convidado', 'inativo');

/* -------------------------------- Tabelas -------------------------------- */

create table public.empresas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text,
  email         text,
  eh_plataforma boolean not null default false,
  logo_url      text,
  criada_em     timestamptz not null default now()
);

-- Só pode haver uma empresa de plataforma (a Proos).
create unique index empresas_uma_plataforma
    on public.empresas ((true))
 where eh_plataforma;

-- Atributos de exibição da pessoa. A identidade (e-mail de login e senha)
-- vive em `auth.usuarios`.
create table public.perfis (
  id            uuid primary key references auth.usuarios (id) on delete cascade,
  nome          text not null default '',
  email         text not null,
  ultimo_acesso timestamptz
);

-- Vínculo pessoa <-> empresa: é o que define o que cada um enxerga.
create table public.membros (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  user_id    uuid not null references public.perfis (id)   on delete cascade,
  papel      public.papel_membro  not null default 'leitor',
  status     public.status_membro not null default 'convidado',
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

create index on public.membros (user_id);

create table public.automacoes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  nome             text not null,
  descricao        text not null default '',
  status           public.status_automacao not null default 'rascunho',
  tipo             public.tipo_automacao not null,
  config           jsonb not null default '{}'::jsonb,
  proxima_execucao timestamptz,
  sincronizado_ate timestamptz,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now()
);

create index on public.automacoes (empresa_id);

-- O dispatcher roda a cada minuto e só olha automações ativas e vencidas.
create index on public.automacoes (proxima_execucao)
  where status = 'ativa';

create table public.automacao_segredos (
  automacao_id  uuid primary key references public.automacoes (id) on delete cascade,
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  valores       jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

create table public.execucoes (
  id            uuid primary key default gen_random_uuid(),
  automacao_id  uuid not null references public.automacoes (id) on delete cascade,
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  resultado     public.resultado_execucao not null default 'em_andamento',
  origem        text not null default 'agendador',
  iniciada_em   timestamptz not null default now(),
  finalizada_em timestamptz,
  duracao_ms    integer,
  log_path      text,
  -- Id da execução no n8n: torna a sincronização idempotente.
  externo_id    text,
  arquivo_path  text,
  arquivo_nome  text
);

create index on public.execucoes (empresa_id, iniciada_em desc);
create index on public.execucoes (automacao_id, iniciada_em desc);

-- Sem predicado de propósito (ver supabase/migrations/0033): NULL não
-- conflita com NULL, e o ON CONFLICT precisa casar com o índice sem `where`.
create unique index execucoes_externo_id_unico
  on public.execucoes (automacao_id, externo_id);

create table public.logs_execucao (
  id           bigserial primary key,
  execucao_id  uuid not null references public.execucoes (id) on delete cascade,
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  nivel        public.nivel_log not null default 'info',
  mensagem     text not null,
  horario      timestamptz not null default now()
);

create index on public.logs_execucao (execucao_id, horario);
create index on public.logs_execucao (empresa_id, horario desc);

-- Conexões únicas, geridas pela Proos: `id boolean ... check (id)` garante
-- no máximo uma linha.
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

-- As credenciais do Infisical vêm do ambiente (INFISICAL_CLIENT_ID/SECRET);
-- aqui só o que a Proos ajusta pela tela.
create table public.integracao_infisical_plataforma (
  id               boolean primary key default true,
  projeto_id       text not null,
  ambiente         text not null default 'prod',
  pasta_raiz       text not null default '/clientes'
    check (pasta_raiz ~ '^/[A-Za-z0-9_/-]*$'),
  injetar_segredos boolean not null default true,
  mascarar_valores boolean not null default true,
  criada_em        timestamptz not null default now(),
  check (id)
);

-- Pasta de segredos de cada cliente dentro do projeto Infisical compartilhado.
create table public.infisical_caminhos_clientes (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  caminho       text not null,
  atualizado_em timestamptz not null default now()
);

create table public.arquivos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  nome          text not null,
  caminho       text not null unique,
  tamanho_bytes bigint not null,
  tipo_mime     text,
  enviado_por   uuid references public.perfis (id) on delete set null,
  enviado_em    timestamptz not null default now()
);

create index on public.arquivos (empresa_id, enviado_em desc);

-- "Acessos e chaves": metadado listável numa tabela, valor em outra sem
-- policy de SELECT.
create table public.acessos_chaves (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  nome          text not null,
  descricao     text not null default '',
  criado_por    uuid references public.perfis (id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index acessos_chaves_nome_por_empresa
    on public.acessos_chaves (empresa_id, lower(nome));

create index on public.acessos_chaves (empresa_id, criado_em desc);

create table public.acessos_chaves_segredo (
  chave_id      uuid primary key references public.acessos_chaves (id) on delete cascade,
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

/* ---------------------------------- Omie --------------------------------- */

create table public.omie_faturamento_mensal (
  empresa_id       uuid    not null references public.empresas (id) on delete cascade,
  competencia      date    not null check (extract(day from competencia) = 1),
  cliente_codigo   bigint  not null,
  categoria_codigo text    not null,
  valor            numeric(14, 2) not null,
  quantidade_os    integer not null default 0,
  primary key (empresa_id, competencia, cliente_codigo, categoria_codigo)
);

create table public.omie_clientes (
  empresa_id uuid   not null references public.empresas (id) on delete cascade,
  codigo     bigint not null,
  nome       text   not null,
  primary key (empresa_id, codigo)
);

create table public.omie_categorias (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  codigo     text not null,
  descricao  text not null,
  primary key (empresa_id, codigo)
);

create table public.omie_sincronizacao (
  empresa_id           uuid primary key references public.empresas (id) on delete cascade,
  iniciada_em          timestamptz,
  concluida_em         timestamptz,
  primeira_competencia date,
  erro                 text
);

-- Situação do contrato de serviço no Omie (cCodSit): "00" rascunho,
-- "10" ativo, "90" suspenso, "99" cancelado. `categorias` são as dos itens
-- do contrato — só contrato com item recorrente conta para a recorrência.
create table public.omie_contratos (
  empresa_id      uuid    not null references public.empresas (id) on delete cascade,
  codigo          bigint  not null,
  cliente_codigo  bigint  not null,
  situacao        text    not null,
  categorias      text[]  not null default '{}',
  primary key (empresa_id, codigo)
);

/* -------------------------------- Helpers -------------------------------- */

-- SECURITY DEFINER nos quatro: as policies precisam consultar `membros`, e
-- sem isso o RLS entraria em recursão infinita. Ficam em `privado`, fora do
-- alcance de quem só tem `authenticated`, exceto pelo EXECUTE.

create schema privado;

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

-- Admin de plataforma enxerga todas as empresas; os demais, só aquelas em que
-- têm vínculo ativo.
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

grant usage on schema privado to authenticated;

revoke all on function privado.eh_admin_plataforma() from public;
revoke all on function privado.empresas_do_usuario() from public;
revoke all on function privado.eh_admin(uuid)        from public;
revoke all on function privado.pode_escrever(uuid)   from public;

grant execute on function privado.eh_admin_plataforma() to authenticated;
grant execute on function privado.empresas_do_usuario() to authenticated;
grant execute on function privado.eh_admin(uuid)        to authenticated;
grant execute on function privado.pode_escrever(uuid)   to authenticated;

-- Move a automação e tudo que pendura dela para outra empresa, numa
-- transação só — pela metade, o RLS esconderia partes do histórico dos dois
-- lados. Checagem explícita porque, como definer, ignora o RLS de quem chama.
create function public.vincular_automacao(automacao uuid, empresa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not privado.eh_admin_plataforma() then
    raise exception 'Só administradores da Proos podem vincular automações.';
  end if;

  if not exists (select 1 from public.empresas where id = empresa) then
    raise exception 'Empresa inexistente.';
  end if;

  update public.logs_execucao l
     set empresa_id = empresa
    from public.execucoes e
   where e.id = l.execucao_id
     and e.automacao_id = automacao;

  update public.execucoes
     set empresa_id = empresa
   where automacao_id = automacao;

  update public.automacao_segredos
     set empresa_id = empresa
   where automacao_id = automacao;

  update public.automacoes
     set empresa_id = empresa,
         atualizada_em = now()
   where id = automacao;
end;
$$;

revoke all on function public.vincular_automacao(uuid, uuid) from public;
grant execute on function public.vincular_automacao(uuid, uuid) to authenticated;

/* --------------------------------- Grants -------------------------------- */

-- Mesmo ponto de partida do Supabase: `authenticated` tem os privilégios de
-- tabela e quem recorta o acesso é o RLS. Tabela com RLS ligado e sem policy
-- para o comando nega tudo.
grant usage on schema public to authenticated, painel_app;
grant select, insert, update, delete on all tables in schema public to authenticated, painel_app;
grant usage, select on all sequences in schema public to authenticated, painel_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, painel_app;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, painel_app;

/* ---------------------------------- RLS ---------------------------------- */

alter table public.empresas                          enable row level security;
alter table public.perfis                            enable row level security;
alter table public.membros                           enable row level security;
alter table public.automacoes                        enable row level security;
alter table public.automacao_segredos                enable row level security;
alter table public.execucoes                         enable row level security;
alter table public.logs_execucao                     enable row level security;
alter table public.integracao_n8n_plataforma         enable row level security;
alter table public.integracao_n8n_plataforma_segredo enable row level security;
alter table public.integracao_infisical_plataforma   enable row level security;
alter table public.infisical_caminhos_clientes       enable row level security;
alter table public.arquivos                          enable row level security;
alter table public.acessos_chaves                    enable row level security;
alter table public.acessos_chaves_segredo            enable row level security;
alter table public.omie_faturamento_mensal           enable row level security;
alter table public.omie_clientes                     enable row level security;
alter table public.omie_categorias                   enable row level security;
alter table public.omie_sincronizacao                enable row level security;
alter table public.omie_contratos                    enable row level security;

-- empresas: enxerga as suas; só admin da empresa altera; só a Proos cria.
create policy empresas_leitura on public.empresas
  for select using (id in (select privado.empresas_do_usuario()));

create policy empresas_escrita on public.empresas
  for update using (privado.eh_admin(id))
  with check (privado.eh_admin(id));

create policy empresas_insercao on public.empresas
  for insert with check (privado.eh_admin_plataforma());

-- perfis: o próprio, e quem divide empresa com você.
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

-- automacoes: leitura para membros da empresa; escrita só da Proos.
create policy automacoes_leitura on public.automacoes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy automacoes_escrita on public.automacoes
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- Segredo de automação: só INSERT, e só pela Proos. Quem lê é o agendador,
-- fora do RLS.
create policy automacao_segredos_insercao on public.automacao_segredos
  for insert with check (privado.eh_admin_plataforma());

-- execucoes / logs: só leitura; quem grava é o agendador, fora do RLS.
create policy execucoes_leitura on public.execucoes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy logs_leitura on public.logs_execucao
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Integrações da plataforma: só a Proos configura. A do Infisical é legível
-- por quem tem empresa (projeto, ambiente e pasta raiz não são segredo).
create policy integracao_n8n_plataforma_gestao on public.integracao_n8n_plataforma
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_gestao on public.integracao_infisical_plataforma
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_leitura on public.integracao_infisical_plataforma
  for select using (exists (select 1 from privado.empresas_do_usuario()));

-- Segredo do n8n: sem policy de SELECT (nem a Proos lê de volta), mas com
-- INSERT/UPDATE para a tela conseguir gravar.
create policy integracao_n8n_plataforma_segredo_insercao
  on public.integracao_n8n_plataforma_segredo
  for insert with check (privado.eh_admin_plataforma());

create policy integracao_n8n_plataforma_segredo_atualizacao
  on public.integracao_n8n_plataforma_segredo
  for update using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- Caminhos do Infisical: cada empresa lê o próprio; só a Proos define.
create policy infisical_caminhos_leitura on public.infisical_caminhos_clientes
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy infisical_caminhos_gestao on public.infisical_caminhos_clientes
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

-- arquivos: mesmo isolamento das automações; metadado não se edita.
create policy arquivos_leitura on public.arquivos
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy arquivos_insercao on public.arquivos
  for insert with check (privado.pode_escrever(empresa_id) and enviado_por = auth.uid());

create policy arquivos_exclusao on public.arquivos
  for delete using (privado.eh_admin(empresa_id) or enviado_por = auth.uid());

-- Acessos e chaves: cada empresa cuida das suas; o valor não volta pela
-- consulta, mas INSERT/UPDATE precisam existir para a tela gravar.
create policy acessos_chaves_leitura on public.acessos_chaves
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy acessos_chaves_escrita on public.acessos_chaves
  for all using (privado.pode_escrever(empresa_id))
  with check (privado.pode_escrever(empresa_id));

create policy acessos_chaves_segredo_insercao on public.acessos_chaves_segredo
  for insert with check (privado.pode_escrever(empresa_id));

create policy acessos_chaves_segredo_atualizacao on public.acessos_chaves_segredo
  for update using (privado.pode_escrever(empresa_id))
  with check (privado.pode_escrever(empresa_id));

-- Omie: leitura para quem pertence à empresa; gravação só pelo servidor,
-- fora do RLS, depois de conferir o acesso.
create policy omie_faturamento_leitura on public.omie_faturamento_mensal
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_clientes_leitura on public.omie_clientes
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_categorias_leitura on public.omie_categorias
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_sincronizacao_leitura on public.omie_sincronizacao
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_contratos_leitura on public.omie_contratos
  for select using (empresa_id in (select privado.empresas_do_usuario()));
