-- Bug real: `integracao_n8n_plataforma_segredo` e
-- `integracao_infisical_plataforma_segredo` foram criadas de propósito sem
-- nenhuma policy — "só o executor, com a secret key do Supabase, enxerga o
-- segredo". Isso bloqueia LEITURA corretamente, mas também bloqueia a
-- ESCRITA que a própria tela de Configurações precisa fazer para salvar a
-- chave pela primeira vez: RLS habilitado sem nenhuma policy nega todo
-- comando para quem não é dono da tabela, incluindo INSERT/UPDATE feitos
-- pelo admin de plataforma logado. Resultado visto em produção: "URL salva,
-- mas a chave de API falhou".
--
-- A correção é adicionar policy só para INSERT/UPDATE, restrita a admin de
-- plataforma — sem policy de SELECT, então o segredo continua ilegível via
-- API/cliente normal mesmo depois de salvo. Só o `clienteAdmin()` (secret
-- key do Supabase, que ignora RLS) consegue ler.

create policy integracao_n8n_plataforma_segredo_insercao
  on public.integracao_n8n_plataforma_segredo
  for insert
  with check (privado.eh_admin_plataforma());

create policy integracao_n8n_plataforma_segredo_atualizacao
  on public.integracao_n8n_plataforma_segredo
  for update
  using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_segredo_insercao
  on public.integracao_infisical_plataforma_segredo
  for insert
  with check (privado.eh_admin_plataforma());

create policy integracao_infisical_plataforma_segredo_atualizacao
  on public.integracao_infisical_plataforma_segredo
  for update
  using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());
