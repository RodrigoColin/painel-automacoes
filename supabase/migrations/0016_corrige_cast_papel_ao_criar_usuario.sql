create or replace function privado.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    case when exists (select 1 from public.perfis)
      then 'usuario'::public.papel_usuario
      else 'admin'::public.papel_usuario
    end
  );
  return new;
end;
$$;
