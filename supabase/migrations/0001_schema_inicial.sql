-- Schema inicial do Painel de Automações.
--
-- Modelo multi-tenant: toda linha pertence a uma empresa, e o isolamento é
-- garantido por RLS no próprio banco — não só pelo código da aplicação.
-- Os valores dos enums espelham os tipos em `src/lib/data.ts` e
-- `src/lib/automacao-tipos.ts`.

/* --------------------------------- Enums --------------------------------- */

create type public.status_automacao   as enum ('ativa', 'pausada', 'rascunho');
create type public.tipo_automacao     as enum ('python-cron', 'n8n');
create type public.resultado_execucao as enum ('sucesso', 'erro', 'em_andamento');
create type public.nivel_log          as enum ('info', 'aviso', 'erro');
create type public.papel_membro       as enum ('admin', 'editor', 'leitor');
create type public.status_membro      as enum ('ativo', 'convidado', 'inativo');

/* -------------------------------- Tabelas -------------------------------- */

create table public.empresas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cnpj       text,
  email      text,
  criada_em  timestamptz not null default now()
);

-- Espelha `auth.users` com os dados que o painel exibe. O Supabase Auth é a
-- fonte de verdade da identidade; aqui ficam só os atributos de perfil.
create table public.perfis (
  id             uuid primary key references auth.users (id) on delete cascade,
  nome           text not null default '',
  email          text not null,
  ultimo_acesso  timestamptz
);

-- Vínculo pessoa <-> empresa. É esta tabela que define o que cada usuário
-- enxerga; o `empresa-switcher` da UI passa a listar exatamente estas linhas.
create table public.membros (
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  user_id     uuid not null references public.perfis (id)   on delete cascade,
  papel       public.papel_membro  not null default 'leitor',
  status      public.status_membro not null default 'convidado',
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

create table public.automacoes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  nome             text not null,
  descricao        text not null default '',
  status           public.status_automacao not null default 'rascunho',
  tipo             public.tipo_automacao not null,
  -- Config da união discriminada (`ConfigPythonCron` | `ConfigN8n`) sem os
  -- campos sensíveis, que vão para `automacao_segredos`.
  config           jsonb not null default '{}'::jsonb,
  responsavel_id   uuid references public.perfis (id) on delete set null,
  -- Preenchido pelo agendador a cada execução; é o que o dispatcher consulta.
  proxima_execucao timestamptz,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now()
);

-- Segredos das automações: variáveis de ambiente do script Python e
-- credenciais da instância n8n. Tabela separada de propósito — nenhuma policy
-- concede leitura ao cliente, só o executor (service role) enxerga.
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
  -- Saída volumosa vai para o Storage; aqui fica só o ponteiro.
  log_path      text
);

create table public.logs_execucao (
  id           bigserial primary key,
  execucao_id  uuid not null references public.execucoes (id) on delete cascade,
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  nivel        public.nivel_log not null default 'info',
  mensagem     text not null,
  horario      timestamptz not null default now()
);

/* -------------------------------- Índices -------------------------------- */

create index on public.membros (user_id);
create index on public.automacoes (empresa_id);
create index on public.execucoes (empresa_id, iniciada_em desc);
create index on public.execucoes (automacao_id, iniciada_em desc);
create index on public.logs_execucao (execucao_id, horario);

-- O dispatcher roda a cada minuto e só olha automações ativas e vencidas;
-- o índice parcial mantém essa consulta barata conforme a base cresce.
create index on public.automacoes (proxima_execucao)
  where status = 'ativa';

/* -------------------------------- Helpers -------------------------------- */

-- SECURITY DEFINER de propósito: as policies de `membros` precisam consultar
-- `membros`, e sem isso o RLS entra em recursão infinita.
create function public.empresas_do_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id from public.membros
  where user_id = auth.uid() and status = 'ativo'
$$;

create function public.pode_escrever(alvo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membros
    where user_id = auth.uid()
      and empresa_id = alvo
      and status = 'ativo'
      and papel in ('admin', 'editor')
  )
$$;

-- Cria o perfil assim que alguém se cadastra pelo Supabase Auth.
create function public.ao_criar_usuario()
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

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();

/* ---------------------------------- RLS ---------------------------------- */

alter table public.empresas           enable row level security;
alter table public.perfis             enable row level security;
alter table public.membros            enable row level security;
alter table public.automacoes         enable row level security;
alter table public.automacao_segredos enable row level security;
alter table public.execucoes          enable row level security;
alter table public.logs_execucao      enable row level security;

-- empresas: enxerga as suas; só admin altera.
create policy empresas_leitura on public.empresas
  for select using (id in (select public.empresas_do_usuario()));

create policy empresas_escrita on public.empresas
  for update using (
    exists (
      select 1 from public.membros
      where user_id = auth.uid() and empresa_id = empresas.id
        and status = 'ativo' and papel = 'admin'
    )
  );

-- perfis: o próprio, e os colegas das empresas em comum (a tela /usuarios).
create policy perfis_leitura on public.perfis
  for select using (
    id = auth.uid()
    or id in (
      select user_id from public.membros
      where empresa_id in (select public.empresas_do_usuario())
    )
  );

create policy perfis_proprio on public.perfis
  for update using (id = auth.uid());

-- membros: lista quem divide empresa com você; só admin mexe.
create policy membros_leitura on public.membros
  for select using (empresa_id in (select public.empresas_do_usuario()));

create policy membros_admin on public.membros
  for all using (
    exists (
      select 1 from public.membros m
      where m.user_id = auth.uid() and m.empresa_id = membros.empresa_id
        and m.status = 'ativo' and m.papel = 'admin'
    )
  );

-- automacoes / execucoes / logs: leitura para membros da empresa,
-- escrita só para admin e editor.
create policy automacoes_leitura on public.automacoes
  for select using (empresa_id in (select public.empresas_do_usuario()));

create policy automacoes_escrita on public.automacoes
  for all using (public.pode_escrever(empresa_id))
  with check (public.pode_escrever(empresa_id));

create policy execucoes_leitura on public.execucoes
  for select using (empresa_id in (select public.empresas_do_usuario()));

create policy logs_leitura on public.logs_execucao
  for select using (empresa_id in (select public.empresas_do_usuario()));

-- `automacao_segredos` fica sem policy de propósito: com RLS ligado e nenhuma
-- policy, todo acesso via chave anon/authenticated é negado. Só o executor,
-- usando service role (que ignora RLS), consegue ler os valores.

/* ------------------------------ Realtime --------------------------------- */

-- Alimenta o /historico e o dashboard sem polling: a tela recebe a execução
-- assim que o agendador grava o resultado.
alter publication supabase_realtime add table public.execucoes;
alter publication supabase_realtime add table public.logs_execucao;
