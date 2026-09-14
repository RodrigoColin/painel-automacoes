-- Automação Python passa a executar um arquivo enviado na criação, e não um
-- caminho dentro de `scripts/` do repositório. O arquivo mora aqui.
--
-- Bucket privado. O caminho é `<automacao_id>/<arquivo>.py`, sem a empresa:
-- vincular a automação a outra empresa não mexe no arquivo.
--
-- O limite de 1 MB fica também no bucket, não só no app — é o teto do corpo
-- que o executor Python aceita.

insert into storage.buckets (id, name, public, file_size_limit)
values ('automacao-scripts', 'automacao-scripts', false, 1048576)
on conflict (id) do nothing;

-- Mesma regra de `automacoes_escrita`: só admin da Proos cria e exclui
-- automação, então só ele envia, lê e apaga o script. Assim a tela usa o
-- cliente da sessão, sujeito ao RLS; a secret key fica restrita ao agendador,
-- que baixa o arquivo para executar. A leitura entra porque o Storage exige
-- SELECT para apagar um objeto. Sem UPDATE: script não se substitui no lugar.
create policy automacao_scripts_insercao on storage.objects
  for insert to authenticated
  with check (bucket_id = 'automacao-scripts' and privado.eh_admin_plataforma());

create policy automacao_scripts_leitura on storage.objects
  for select to authenticated
  using (bucket_id = 'automacao-scripts' and privado.eh_admin_plataforma());

create policy automacao_scripts_exclusao on storage.objects
  for delete to authenticated
  using (bucket_id = 'automacao-scripts' and privado.eh_admin_plataforma());
