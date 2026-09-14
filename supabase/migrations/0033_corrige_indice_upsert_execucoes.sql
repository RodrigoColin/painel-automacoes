-- A sincronização do n8n nunca gravou uma execução sequer: todo upsert morria
-- com "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- O índice de 0007 é parcial (`where externo_id is not null`). O Postgres só
-- aceita um índice parcial na inferência do ON CONFLICT quando o comando
-- repete o mesmo predicado, e o PostgREST — que é por onde o app fala — não
-- tem como expressar isso: o `onConflict` do supabase-js manda só a lista de
-- colunas. Resultado: o índice existia e ainda assim o comando era recusado.
--
-- O predicado não fazia falta. Num índice único comum, NULL não conflita com
-- NULL, então as execuções gravadas pelo dispatcher (sem `externo_id`)
-- continuam entrando à vontade, quantas forem. A garantia que importa —
-- uma linha por execução do n8n — é a mesma.

drop index if exists public.execucoes_externo_id_unico;

create unique index execucoes_externo_id_unico
  on public.execucoes (automacao_id, externo_id);
