create or replace function privado.impede_remover_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if old.papel = 'admin' and old.status = 'ativo'
       and not exists (
         select 1 from public.perfis
         where papel = 'admin' and status = 'ativo' and id <> old.id
       )
    then
      raise exception 'Precisa haver ao menos um administrador ativo.';
    end if;
    return old;
  end if;

  if old.papel = 'admin' and old.status = 'ativo'
     and (new.papel <> 'admin' or new.status <> 'ativo')
     and not exists (
       select 1 from public.perfis
       where papel = 'admin' and status = 'ativo' and id <> old.id
     )
  then
    raise exception 'Precisa haver ao menos um administrador ativo.';
  end if;

  return new;
end;
$$;

create trigger impede_remover_ultimo_admin
  before update or delete on public.perfis
  for each row execute function privado.impede_remover_ultimo_admin();
