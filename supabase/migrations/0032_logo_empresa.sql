-- Logo da empresa: aparece no seletor da barra lateral no lugar das iniciais.
--
-- O arquivo mora num bucket público — a logo é mostrada em toda tela do
-- painel e não tem nada de sigiloso, então não vale pagar URL assinada a cada
-- render. `empresas.logo_url` guarda a URL pública pronta; quem lê a empresa
-- já lê a logo junto, sem passar pelo Storage.

alter table public.empresas add column if not exists logo_url text;

-- 512 KB é folgado para uma logo e segura o custo de servir a imagem em toda
-- página. Os tipos são fechados na definição do bucket, não só no app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'logos-empresa',
  'logos-empresa',
  true,
  524288,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

-- O caminho é `<empresa_id>/<arquivo>`, então a dona do objeto sai da
-- primeira pasta. `split_part` devolve string vazia quando não há barra, e o
-- cast direto derrubaria o comando inteiro — daí o guard antes de converter.
create or replace function privado.empresa_da_logo(caminho text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(caminho, '/', 1), '')::uuid
  where split_part(caminho, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

revoke all on function privado.empresa_da_logo(text) from public;
grant execute on function privado.empresa_da_logo(text) to authenticated;

-- Quem pode alterar dados da empresa (`pode_escrever`: admin da plataforma,
-- admin e editor da própria) troca a logo dela — e só a dela, pela pasta.
-- Sem UPDATE: cada envio grava um nome novo e apaga o anterior, porque
-- reaproveitar o mesmo caminho deixaria a imagem velha no cache da CDN.
create policy logos_empresa_insercao on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos-empresa'
    and privado.pode_escrever(privado.empresa_da_logo(name))
  );

-- Bucket público: a leitura da imagem em si não passa por aqui. Esta policy
-- existe porque o Storage exige SELECT para apagar um objeto.
create policy logos_empresa_leitura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos-empresa'
    and privado.pode_escrever(privado.empresa_da_logo(name))
  );

create policy logos_empresa_exclusao on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos-empresa'
    and privado.pode_escrever(privado.empresa_da_logo(name))
  );
