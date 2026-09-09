alter type public.tipo_automacao add value 'upload';

alter table public.execucoes add column arquivo_path text;
alter table public.execucoes add column arquivo_nome text;

insert into storage.buckets (id, name, public)
values ('automacao-uploads', 'automacao-uploads', false)
on conflict (id) do nothing;

create policy automacao_uploads_insercao on storage.objects
  for insert to authenticated
  with check (bucket_id = 'automacao-uploads' and privado.esta_ativo());
