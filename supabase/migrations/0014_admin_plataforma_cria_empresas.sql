-- `empresas` nunca teve policy de INSERT: com RLS ligado e nenhuma policy
-- para a operação, o Postgres nega por padrão. "Cadastrar empresa" estava
-- quebrado para todo mundo, admin de plataforma incluído.
--
-- Corrige e, de propósito, restringe a operação a admin da plataforma — só a
-- Admin cria novas empresas clientes; uma empresa cliente não pode criar
-- outra. `membros_admin` (`privado.eh_admin`, que já inclui
-- `eh_admin_plataforma()` desde a 0012) segue liberando o INSERT do primeiro
-- membro sem migração adicional.
create policy empresas_insercao on public.empresas
  for insert
  with check (privado.eh_admin_plataforma());
