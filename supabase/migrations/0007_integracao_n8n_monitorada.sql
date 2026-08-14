-- Vincula workflows que já rodam numa instância n8n, em modo monitorado: o
-- n8n continua agendando e executando; o painel só espelha o histórico.
--
-- Por que monitorar em vez de disparar: os workflows existentes usam Schedule
-- Trigger. Fazê-los responder ao painel exigiria trocar o gatilho por um
-- Webhook — editar automação de conciliação financeira que já funciona em
-- produção. O ganho não compensa o risco.

-- Conexão com a instância, por empresa. Cada empresa pode ter a sua.
create table public.integracoes_n8n (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  instancia_url text not null,
  criada_em     timestamptz not null default now()
);

-- Mesmo padrão de `automacao_segredos`: tabela separada, sem policy nenhuma,
-- para a chave de API jamais ser legível pelo cliente.
create table public.integracoes_n8n_segredos (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  api_key       text not null,
  atualizado_em timestamptz not null default now()
);

-- Id da execução no n8n. É o que torna a sincronização idempotente: rodar duas
-- vezes não duplica linhas.
alter table public.execucoes add column externo_id text;

create unique index execucoes_externo_id_unico
    on public.execucoes (automacao_id, externo_id)
 where externo_id is not null;

-- Marca até onde cada automação já foi sincronizada, para não varrer todo o
-- histórico do n8n a cada rodada.
alter table public.automacoes add column sincronizado_ate timestamptz;

alter table public.integracoes_n8n          enable row level security;
alter table public.integracoes_n8n_segredos enable row level security;

create policy integracoes_leitura on public.integracoes_n8n
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy integracoes_escrita on public.integracoes_n8n
  for all using (privado.eh_admin(empresa_id))
  with check (privado.eh_admin(empresa_id));

-- `integracoes_n8n_segredos` fica sem policy de propósito: só o sincronizador,
-- usando a secret key, enxerga a chave de API.
