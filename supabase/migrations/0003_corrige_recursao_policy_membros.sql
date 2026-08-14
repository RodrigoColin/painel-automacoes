-- Corrige recursão infinita nas policies.
--
-- `membros_admin` e `empresas_escrita` consultavam `public.membros` inline.
-- Como `membros_admin` é `for all`, qualquer SELECT em `membros` reavaliava a
-- própria policy, que consultava `membros` de novo — laço infinito. E como
-- `perfis_leitura` também alcança `membros`, a falha derrubava aquela tabela
-- junto.
--
-- A migração 0002 tinha resolvido isso só para os helpers; faltavam estas duas
-- policies, que faziam a checagem inline. Mover para SECURITY DEFINER quebra o
-- ciclo: dentro da função o RLS não é reaplicado.
--
-- O sintoma só apareceu em requisição real — o build passava normalmente.

create function privado.eh_admin(alvo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membros
    where user_id = auth.uid()
      and empresa_id = alvo
      and status = 'ativo'
      and papel = 'admin'
  )
$$;

revoke all on function privado.eh_admin(uuid) from public;
grant execute on function privado.eh_admin(uuid) to authenticated;

drop policy membros_admin on public.membros;
create policy membros_admin on public.membros
  for all using (privado.eh_admin(empresa_id))
  with check (privado.eh_admin(empresa_id));

drop policy empresas_escrita on public.empresas;
create policy empresas_escrita on public.empresas
  for update using (privado.eh_admin(id))
  with check (privado.eh_admin(id));
