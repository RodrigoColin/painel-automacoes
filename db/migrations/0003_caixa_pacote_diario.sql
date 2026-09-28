-- Pacote diário do painel "Fluxo de caixa" — dados do Omie que hoje viram
-- JSON em disco (proos-omie-mcp/dados/oystr/AAAA-MM-DD/), agora no banco
-- pra alimentar a atualização automática (n8n) e, futuramente, uma tela
-- dentro do painel.proos.com.br.
--
-- Upsert por empresa+dia: reprocessar um dia sobrescreve, nunca duplica.
-- JSONB por bloco (em vez de tabelas normalizadas) porque o formato de
-- cada base já é o que o Omie devolve — normalizar agora seria trabalho
-- sem benefício antes de existir uma segunda tela consumindo isso além
-- do artefato.
--
-- Leitura: quem pertence à empresa (mesmo padrão de fluxo_caixa_config e
-- validacao_saldo_diario). Escrita: nenhuma policy — só o servidor, com a
-- connection string direta.
create table public.caixa_pacote_diario (
  empresa_id                uuid not null references public.empresas (id) on delete cascade,
  data                      date not null,
  manifesto                 jsonb not null,
  recebimentos              jsonb not null default '[]'::jsonb,
  pagamentos                jsonb not null default '[]'::jsonb,
  receber_aberto            jsonb not null default '[]'::jsonb,
  pagar_aberto              jsonb not null default '[]'::jsonb,
  contratos_nao_faturados   jsonb not null default '[]'::jsonb,
  os_nao_faturadas          jsonb not null default '[]'::jsonb,
  status_contratos          jsonb not null default '[]'::jsonb,
  extrato                   jsonb,
  extra                     jsonb,
  checagem                  jsonb,
  atualizado_em             timestamptz not null default now(),
  primary key (empresa_id, data)
);

create index on public.caixa_pacote_diario (empresa_id, data desc);

alter table public.caixa_pacote_diario enable row level security;

create policy caixa_pacote_diario_leitura on public.caixa_pacote_diario
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Sem grant explícito: `alter default privileges` de 0001_base.sql já cobre
-- toda tabela nova criada em `public` pelo mesmo papel que roda as migrações.
