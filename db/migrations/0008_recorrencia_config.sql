-- Categorias de receita recorrente por empresa.
--
-- Até aqui "o que é recorrente" era decidido só pelo nome da categoria conter
-- "Recorrente" (RPA Recorrente, Presto Recorrente) — calibrado para Proos/Oystr.
-- Cliente novo que nomeia diferente (ex.: Startlaw: "Mensalidade", "Honorários")
-- não casava com o heurístico e toda a seção de recorrência (MRR, churn, novos,
-- não-faturados) zerava, enquanto o faturamento bruto do topo aparecia normal.
--
-- Aqui a Proos marca explicitamente quais categorias contam como recorrentes
-- para a empresa. Sem linha (ou lista vazia) → cai de volta no heurístico de
-- nome, então Proos/Oystr seguem funcionando sem precisar configurar nada.
--
-- Leitura: quem pertence à empresa (mesmo padrão de fluxo_caixa_config).
-- Escrita: nenhuma policy — só o servidor, com a connection string direta.
create table public.recorrencia_config (
  empresa_id         uuid primary key references public.empresas (id) on delete cascade,
  categoria_codigos  text[] not null default '{}',
  atualizado_em      timestamptz not null default now()
);

alter table public.recorrencia_config enable row level security;

create policy recorrencia_config_leitura on public.recorrencia_config
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Sem grant explícito: `alter default privileges` de 0001_base.sql já cobre
-- toda tabela nova criada em `public` pelo mesmo papel que roda as migrações.
