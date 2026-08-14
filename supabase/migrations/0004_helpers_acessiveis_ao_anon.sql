-- Sem estes grants, uma consulta anônima a `membros` estourava
-- "permission denied for function eh_admin" em vez de simplesmente devolver
-- lista vazia, como as demais tabelas fazem.
--
-- Não há custo de segurança: as três funções filtram por `auth.uid()`, que é
-- nulo no papel anônimo, então todas retornam falso/vazio. E elas seguem fora
-- do schema exposto pelo PostgREST, logo continuam não sendo chamáveis via
-- /rest/v1/rpc/ (verificado: retorna 404).

grant usage on schema privado to anon;

grant execute on function privado.empresas_do_usuario() to anon;
grant execute on function privado.pode_escrever(uuid)   to anon;
grant execute on function privado.eh_admin(uuid)        to anon;
