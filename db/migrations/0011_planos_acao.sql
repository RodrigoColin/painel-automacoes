-- Planos de ação: cards que percorrem etapas, cada um com tarefas e histórico.
--
-- A primeira origem automática é a inadimplência: cliente que passa dos
-- limites de `planos_config` vira card sozinho (ver
-- src/lib/planos-acao/sincronizacao.ts, que lê `caixa_pacote_diario`). O
-- modelo é genérico — `origem = 'manual'` serve para qualquer assunto.
--
-- As etapas são fixas nesta versão e vivem no check de `planos_cards.etapa`;
-- a lista espelha src/lib/planos-acao/etapas.ts.
--
-- Leitura: quem pertence à empresa. Escrita: nenhuma policy — só o servidor
-- (`db`, fora do RLS), depois de conferir a permissão de escrita, mesmo
-- padrão de fluxo_caixa_config.

-- Limites da criação automática, por empresa. Sem linha valem os padrões.
create table public.planos_config (
  empresa_id             uuid primary key references public.empresas (id) on delete cascade,
  auto_inadimplencia     boolean not null default true,
  atraso_minimo_dias     integer not null default 7 check (atraso_minimo_dias >= 0),
  valor_minimo           numeric(14, 2) not null default 0 check (valor_minimo >= 0),
  -- `atualizado_em` do último pacote do fluxo de caixa já processado: a
  -- sincronização sai cedo enquanto não chegar pacote mais novo.
  sincronizado_pacote_em timestamptz,
  atualizado_em          timestamptz not null default now()
);

create table public.planos_cards (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas (id) on delete cascade,
  titulo          text not null,
  descricao       text not null default '',
  etapa           text not null default 'a_tratar'
    check (etapa in ('a_tratar', 'em_contato', 'em_negociacao', 'acordo_firmado', 'concluido')),
  origem          text not null default 'manual' check (origem in ('inadimplencia', 'manual')),
  -- Razão social como vem no pacote: ele não traz o código do Omie.
  cliente_nome    text,
  -- Retrato do vencido na última sincronização (valor, títulos, maior atraso…).
  dados           jsonb not null default '{}',
  responsavel_id  uuid references public.perfis (id) on delete set null,
  prazo           date,
  -- Quando o cliente saiu da lista de inadimplentes. Card concluído à mão sem
  -- isto ainda "segura" o cliente: a sincronização não abre outro por cima.
  regularizado_em timestamptz,
  concluido_em    timestamptz,
  criado_por      uuid references public.perfis (id) on delete set null,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

create index planos_cards_empresa_idx on public.planos_cards (empresa_id, etapa);

-- No máximo um card aberto por cliente inadimplente.
create unique index planos_cards_inadimplente_aberto
  on public.planos_cards (empresa_id, cliente_nome)
  where origem = 'inadimplencia' and etapa <> 'concluido';

create table public.planos_tarefas (
  id             uuid primary key default gen_random_uuid(),
  card_id        uuid not null references public.planos_cards (id) on delete cascade,
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  titulo         text not null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  prazo          date,
  concluida_em   timestamptz,
  concluida_por  uuid references public.perfis (id) on delete set null,
  criado_em      timestamptz not null default now()
);

create index planos_tarefas_card_idx on public.planos_tarefas (card_id);
create index planos_tarefas_empresa_idx on public.planos_tarefas (empresa_id) where concluida_em is null;

-- Linha do tempo do card: comentários das pessoas e registros automáticos.
-- `autor_id` nulo = sistema (a sincronização).
create table public.planos_eventos (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null references public.planos_cards (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo       text not null check (tipo in ('criado', 'comentario', 'etapa', 'regularizado', 'tarefa')),
  autor_id   uuid references public.perfis (id) on delete set null,
  texto      text not null default '',
  criado_em  timestamptz not null default now()
);

create index planos_eventos_card_idx on public.planos_eventos (card_id, criado_em);

alter table public.planos_config  enable row level security;
alter table public.planos_cards   enable row level security;
alter table public.planos_tarefas enable row level security;
alter table public.planos_eventos enable row level security;

create policy planos_config_leitura on public.planos_config
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy planos_cards_leitura on public.planos_cards
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy planos_tarefas_leitura on public.planos_tarefas
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy planos_eventos_leitura on public.planos_eventos
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Sem grant explícito: `alter default privileges` de 0001_base.sql já cobre
-- toda tabela nova criada em `public` pelo mesmo papel que roda as migrações.
