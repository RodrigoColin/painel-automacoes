-- As credenciais do Infisical saem do banco e vão para as variáveis de
-- ambiente da aplicação (INFISICAL_SITE_URL, INFISICAL_CLIENT_ID,
-- INFISICAL_CLIENT_SECRET). O Client Secret deixa de passar pela tela e de
-- ficar gravado no Postgres — quem tem acesso ao deploy é quem controla a
-- chave, e rotacioná-la é trocar a variável.
--
-- Na tabela fica só o que o admin da Proos ajusta pela tela: projeto,
-- ambiente, a pasta raiz onde o app cria uma pasta por cliente e as
-- preferências de uso nas execuções.
--
-- As duas tabelas estavam vazias quando isto foi aplicado: não há conexão
-- salva a migrar.

drop table public.integracao_infisical_plataforma_segredo;

alter table public.integracao_infisical_plataforma
  drop column site_url,
  drop column client_id,
  add column pasta_raiz text not null default '/clientes'
    check (pasta_raiz ~ '^/[A-Za-z0-9_/-]*$');

-- Leitura para qualquer pessoa com empresa: projeto, ambiente e pasta raiz
-- não são segredo, e a tela "Resumo Omie" de um cliente precisa deles para
-- achar as chaves na pasta dele. Sem isso a tela dependeria da secret key do
-- Supabase só para ler três campos de configuração. Escrita segue só com a
-- Proos (`integracao_infisical_plataforma_gestao`).
create policy integracao_infisical_plataforma_leitura on public.integracao_infisical_plataforma
  for select using (exists (select 1 from privado.empresas_do_usuario()));
