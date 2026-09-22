-- Fluxo de caixa e validação de saldo diário, portados das migrações
-- 0036-0039 do Supabase (schema antigo) para o Postgres próprio da VPS.
-- Estado final já consolidado numa migração só — a granularidade histórica
-- (a correção do coalesce em 0038, a coluna de movimento em 0039) não
-- precisa sobreviver na estrutura nova.

-- Marcações da Proos para a tela "Fluxo de caixa" de cada empresa.
--
-- O fluxo em si não é gravado: a tela lê o extrato do Omie (ListarExtrato) ao
-- vivo, com cache de alguns minutos. O que precisa de memória é o que a Proos
-- decide na implantação e o Omie não sabe dizer:
--
--   saldo_minimo  piso de caixa da empresa, definido pela Proos (não pelo
--                 cliente). Nulo = sem alerta de saldo mínimo.
--   contas        por código de conta corrente do Omie (nCodCC, como texto):
--                   { "entra": bool,             -- participa do fluxo
--                     "tipo": "corrente" | "aplicacao" | "garantida",
--                     "liquidezImediata": bool,  -- aplicação que soma no caixa
--                     "limite": number }         -- limite da conta garantida
--                 Conta sem marcação segue o padrão do código (flags do Omie e
--                 nome da conta). Conta garantida é dívida: nunca soma no caixa
--                 próprio, aparece como limite livre.
--
-- Leitura: quem pertence à empresa. Escrita: nenhuma policy — só o servidor
-- (`db`, fora do RLS), depois de conferir que a pessoa é admin da plataforma.
create table public.fluxo_caixa_config (
  empresa_id    uuid primary key references public.empresas (id) on delete cascade,
  saldo_minimo  numeric(14, 2) check (saldo_minimo is null or saldo_minimo >= 0),
  contas        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.fluxo_caixa_config enable row level security;

create policy fluxo_caixa_config_leitura on public.fluxo_caixa_config
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Validação de saldo diário: banco (extrato OFX, subido manualmente) x Omie
-- (ListarExtrato), conta corrente por conta corrente. Objetivo: manter no
-- radar QUAL DIA faltou lançar algo no Omie — não só o saldo final, porque
-- um saldo final batendo pode esconder dois erros que se cancelam.
--
-- Duas visões (pedido do usuário, 2026-09-21):
--   saldo_banco/saldo_omie/diferenca       saldo ACUMULADO — útil pra ver
--                                           que algo está errado.
--   movimento_banco/movimento_omie/        variação do PRÓPRIO dia (entrou -
--   diferenca_movimento                    saiu, sem acumular) — útil pra
--                                           achar EM QUE DIA o problema
--                                           começou, porque uma diferença
--                                           acumulada antiga persiste em todo
--                                           saldo seguinte e esconde quando um
--                                           dia novo diverge de verdade.
--
-- `diferenca`/`diferenca_movimento` usam subtração direta (sem coalesce):
-- NULL de um lado já vira NULL, que é o que se quer — só há diferença quando
-- os dois lados têm dado pra comparar (fim de semana, feriado e período sem
-- extrato não viram divergência falsa).
--
-- Quem grava: só o script scripts/validar_saldo_diario.py (proos-omie-mcp),
-- rodado manualmente pelo operador quando sobe um extrato novo — não há
-- sincronização automática. Por isso não existe rodada_id/lote aqui como em
-- titulos_movimento: é upsert por conta+dia, reprocessar um período
-- sobrescreve o valor anterior daquele dia.
--
-- Leitura: quem pertence à empresa. Escrita: nenhuma policy — só o servidor,
-- com a connection string direta, mesmo padrão de fluxo_caixa_config.
create table public.validacao_saldo_diario (
  empresa_id           uuid    not null references public.empresas (id) on delete cascade,
  conta_id             text    not null,  -- nCodCC do Omie, como texto
  conta_descricao      text,
  data                 date    not null,
  saldo_banco          numeric(14, 2),
  saldo_omie           numeric(14, 2),
  diferenca            numeric(14, 2) generated always as (saldo_banco - saldo_omie) stored,
  movimento_banco      numeric(14, 2),
  movimento_omie       numeric(14, 2),
  diferenca_movimento  numeric(14, 2) generated always as (movimento_banco - movimento_omie) stored,
  fonte_extrato        text,   -- nome do arquivo OFX usado, para auditoria
  atualizado_em        timestamptz not null default now(),
  primary key (empresa_id, conta_id, data)
);

create index on public.validacao_saldo_diario (empresa_id, data desc);

alter table public.validacao_saldo_diario enable row level security;

create policy validacao_saldo_diario_leitura on public.validacao_saldo_diario
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Sem grant explícito: `alter default privileges` de 0001_base.sql já cobre
-- toda tabela nova criada em `public` pelo mesmo papel que roda as migrações.
