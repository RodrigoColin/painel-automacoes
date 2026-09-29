-- Tela "Fluxo de caixa" passa a ler o pacote diário gravado pelo container
-- `caixa` (proos-omie-mcp/caixa/) em vez de consultar o Omie ao vivo.
--
-- 1) fluxo_caixa_config ganha o que era regra fixa da Oystr no pipeline:
--
--   categorias_grupo  { "<nome exato da categoria no Omie>": "<grupo>" }
--                     Sobrepõe a classificação por palavra-chave. Grupos:
--                     rec (receita recorrente), rec1 (receita pontual),
--                     pes, imp, inf, com, fin, adm.
--   linhas_receita    [ { "nome": "RPA Recorrente", "termos": ["rpa recorrente"] } ]
--                     Linhas de receita do gráfico de faturamento por linha;
--                     categoria entra na primeira linha com termo contido no
--                     nome (sem diferenciar maiúscula). Vazio = só
--                     "Receita recorrente" x "Outras receitas".
--   historico_fixo    [ { "mes": "2025-01", "ent": 0, "sai": 0, "acum": 0 } ]
--                     Meses fechados que valem mais que o cálculo pelo Omie
--                     (ex.: a Oystr tem 2025 conferido contra o relatório
--                     nativo). Nulo = tudo calculado.
--
-- 2) caixa_execucao é a fila e o histórico das rodadas. O cron (10h e 16h) e o
--    botão "Atualizar agora" só inserem pedidos 'na_fila'; o container `caixa`
--    pega um por vez. Leitura: quem pertence à empresa. Escrita: só o
--    servidor e o container, pela conexão direta.

alter table public.fluxo_caixa_config
  add column categorias_grupo jsonb not null default '{}'::jsonb,
  add column linhas_receita   jsonb not null default '[]'::jsonb,
  add column historico_fixo   jsonb;

create table public.caixa_execucao (
  id           bigint generated always as identity primary key,
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  origem       text not null check (origem in ('agendado', 'manual')),
  status       text not null default 'na_fila'
               check (status in ('na_fila', 'em_andamento', 'sucesso', 'erro')),
  etapa        text,
  criada_em    timestamptz not null default now(),
  iniciada_em  timestamptz,
  concluida_em timestamptz,
  avisos       jsonb not null default '[]'::jsonb,
  erro         text,
  log          text
);

create index on public.caixa_execucao (empresa_id, criada_em desc);
create index on public.caixa_execucao (status) where status in ('na_fila', 'em_andamento');

alter table public.caixa_execucao enable row level security;

create policy caixa_execucao_leitura on public.caixa_execucao
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Oystr: o que estava fixo no código do pipeline vira configuração dela.
-- As 4 contas fora do caixa (perda/prejuízo e subcontas de cartão, que o Omie
-- devolve com flags de conta normal) e o limite de R$ 61.500 do Itaú
-- (1628924843) prevalecem sobre o que já estiver marcado para essas contas.
insert into public.fluxo_caixa_config (empresa_id)
select id from public.empresas where nome ilike '%oystr%' and not eh_plataforma
on conflict (empresa_id) do nothing;

update public.fluxo_caixa_config c
set contas = c.contas || jsonb_build_object(
      '1847900459', coalesce(c.contas -> '1847900459', '{}'::jsonb) || '{"entra": false}'::jsonb,
      '1860513751', coalesce(c.contas -> '1860513751', '{}'::jsonb) || '{"entra": false}'::jsonb,
      '2182599423', coalesce(c.contas -> '2182599423', '{}'::jsonb) || '{"entra": false}'::jsonb,
      '2263959487', coalesce(c.contas -> '2263959487', '{}'::jsonb) || '{"entra": false}'::jsonb,
      '1628924843', coalesce(c.contas -> '1628924843', '{}'::jsonb) || '{"limite": 61500}'::jsonb
    ),
    categorias_grupo = c.categorias_grupo || '{"RPA Excedentes": "rec", "Presto Excedentes": "rec"}'::jsonb,
    linhas_receita = '[
      {"nome": "RPA Recorrente", "termos": ["rpa recorrente"]},
      {"nome": "Presto Recorrente", "termos": ["presto recorrente"]},
      {"nome": "Excedentes", "termos": ["excedente"]},
      {"nome": "Projetos", "termos": ["execu", "desenvolv"]}
    ]'::jsonb,
    atualizado_em = now()
from public.empresas e
where e.id = c.empresa_id and e.nome ilike '%oystr%' and not e.eh_plataforma;
