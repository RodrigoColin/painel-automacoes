-- Variação (ponte) sob demanda: o usuário escolhe uma data-base livre na aba
-- "Variação" e o worker do container `caixa` calcula a comparação contra o
-- pacote atual com o MESMO motor Python das refs pré-calculadas (caixa/
-- variacao.py) — nada de duplicar o motor em TypeScript.
--
-- Uma linha por (empresa, data-base), reaproveitada como cache: vale enquanto
-- `data_pacote` (o "B" usado no cálculo) for o pacote mais recente; quando uma
-- rodada nova grava pacote, o app re-enfileira ao pedir de novo.
--
-- Sem policy (mesmo padrão de planos_*): leitura/escrita via conexão do app,
-- com checagem de empresa nas server actions.

create table if not exists public.caixa_variacao_dia (
  empresa_id    uuid not null,
  data_base     date not null,
  status        text not null default 'na_fila', -- na_fila | calculando | pronta | erro
  data_pacote   date,
  resultado     jsonb,
  erro          text,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  primary key (empresa_id, data_base)
);
