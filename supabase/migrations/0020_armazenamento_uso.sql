create function public.armazenamento_bytes_usados()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects
$$;

revoke all on function public.armazenamento_bytes_usados() from public;
grant execute on function public.armazenamento_bytes_usados() to authenticated;
