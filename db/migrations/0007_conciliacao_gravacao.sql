-- Gravação (escrita no Omie) da faixa automática de uma conciliação já rodada.
-- Fluxo em dois passos, por segurança: a conciliação (0006) é só leitura; só
-- quando o operador confirma na tela é que estas colunas entram em
-- 'na_fila' e o worker executa as baixas (LancarRecebimento etc.) na faixa
-- automática. gravacao_status nulo = nunca solicitada.

alter table public.conciliacao_execucao
  add column gravacao_status        text
    check (gravacao_status in ('na_fila', 'em_andamento', 'sucesso', 'erro')),
  add column gravacao_por           text,
  add column gravacao_solicitada_em timestamptz,
  add column gravacao_concluida_em  timestamptz,
  add column gravacao_log           text,
  add column gravacao_resultado     jsonb;

create index on public.conciliacao_execucao (gravacao_status)
  where gravacao_status in ('na_fila', 'em_andamento');
