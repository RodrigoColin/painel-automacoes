-- Remove o conceito de "responsável" da automação.
--
-- A coluna guardava quem criou a automação e alimentava uma coluna na
-- listagem. Não é informação que o painel use para decidir nada — quem opera é
-- a Proos, e a autoria de uma automação n8n vive no próprio n8n. Deixar a
-- coluna sem nenhum código lendo ou gravando só convidaria alguém a religar o
-- conceito depois.
--
-- Sem perda: a tabela está vazia. O `drop column` leva junto a FK
-- automacoes_responsavel_id_fkey.

alter table public.automacoes drop column responsavel_id;
