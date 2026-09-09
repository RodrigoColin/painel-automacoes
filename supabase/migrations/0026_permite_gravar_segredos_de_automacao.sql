-- Bug: `automacao_segredos` foi criada na 0001 sem policy nenhuma, com o
-- comentário "nenhuma policy concede leitura ao cliente, só o executor
-- enxerga". A intenção estava certa para o SELECT, mas RLS ligado sem policy
-- nega TODO comando — inclusive o INSERT que `criarAutomacao` faz ao salvar as
-- variáveis de ambiente de uma automação Python. O sintoma era "Automação
-- criada, mas as variáveis falharam", com a automação já gravada.
--
-- É o mesmo erro que a 0013 corrigiu nas tabelas de segredo das integrações.
--
-- Adiciona só INSERT, restrito a admin de plataforma — a mesma regra de
-- `automacoes_escrita` desde a 0024. Sem policy de SELECT: o valor continua
-- ilegível pela API, e só o agendador (secret key, que ignora RLS) o lê.
-- Sem UPDATE e sem DELETE de propósito: não existe edição de automação hoje, e
-- a exclusão vem em cascata pela FK, que não passa por RLS.

create policy automacao_segredos_insercao on public.automacao_segredos
  for insert with check (privado.eh_admin_plataforma());
