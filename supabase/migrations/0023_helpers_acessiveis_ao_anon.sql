-- Reaplica os grants da 0004, que a 0022 não replicou ao recriar os helpers.
--
-- Sem eles, uma consulta anônima a `membros` estoura "permission denied for
-- function eh_admin" (HTTP 401) em vez de devolver lista vazia, como as demais
-- tabelas fazem — a policy `membros_admin` chama `eh_admin(uuid)`, e o papel
-- `anon` precisa poder executá-la só para a checagem retornar falso.
--
-- Não há custo de segurança: as funções filtram por `auth.uid()`, que é nulo
-- no papel anônimo, então todas retornam falso/vazio. E seguem fora do schema
-- exposto pelo PostgREST, logo continuam não chamáveis via /rest/v1/rpc/.

grant usage on schema privado to anon;

grant execute on function privado.eh_admin(uuid)      to anon;
grant execute on function privado.pode_escrever(uuid) to anon;
