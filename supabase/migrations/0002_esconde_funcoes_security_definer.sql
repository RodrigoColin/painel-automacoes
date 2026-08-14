-- As funções SECURITY DEFINER nasceram em `public`, que o PostgREST expõe —
-- ficavam chamáveis via /rest/v1/rpc/, inclusive `ao_criar_usuario()`, que é
-- função de trigger e não deveria ser invocável por ninguém.
--
-- A correção não é revogar EXECUTE dos helpers: policies de RLS são avaliadas
-- com o papel de quem consulta, então isso quebraria o próprio RLS. Mover para
-- um schema fora da API resolve — policies e triggers guardam o OID da função,
-- que o `alter ... set schema` preserva.

create schema if not exists privado;

alter function public.empresas_do_usuario() set schema privado;
alter function public.pode_escrever(uuid)   set schema privado;
alter function public.ao_criar_usuario()    set schema privado;

grant usage on schema privado to authenticated, service_role;

-- Tira o EXECUTE que toda função concede a PUBLIC por padrão.
revoke all on function privado.empresas_do_usuario() from public;
revoke all on function privado.pode_escrever(uuid)   from public;
revoke all on function privado.ao_criar_usuario()    from public;

-- Os helpers seguem executáveis por quem está logado, senão as policies param.
grant execute on function privado.empresas_do_usuario() to authenticated;
grant execute on function privado.pode_escrever(uuid)   to authenticated;

-- `ao_criar_usuario` não recebe grant nenhum: roda só pelo trigger, como
-- definer, e ninguém tem motivo para chamá-la diretamente.
