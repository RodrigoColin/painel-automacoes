-- Snapshot mensal da conferência sombra do fluxo de caixa.
--
-- Na primeira rodada do caixa após virar o mês, o mês recém-fechado é
-- "congelado" aqui com os valores REALIZADOS por categoria lidos de
-- financas/mf/ListarMovimentos (a fonte independente da sombra, ver
-- proos-omie-mcp/caixa/sombra.py). Nas rodadas seguintes (2×/dia), a sombra
-- compara o Omie de agora com o congelado: qualquer diferença num mês já
-- fechado = alguém RECLASSIFICOU retroativamente no Omie — vira aviso na
-- rodada e detalhe no selo, no mesmo dia, sem depender de fechamento manual.
--
-- Append-only por desenho: insert com ON CONFLICT DO NOTHING — o congelado
-- não é sobrescrito nunca (é justamente a referência do "antes"). Se um dia
-- uma reclassificação for ACEITA como correta, o caminho é apagar a linha do
-- mês para a rodada seguinte recongelar com os valores novos.
--
-- Leitura: quem pertence à empresa (mesmo padrão de caixa_pacote_diario).
-- Escrita: nenhuma policy — só o servidor, com a connection string direta.
create table public.caixa_fechamento_mensal (
  empresa_id  uuid not null references public.empresas (id) on delete cascade,
  mes         date not null,          -- primeiro dia do mês congelado
  dados       jsonb not null,         -- {entPorCategoria, saiPorCategoria, totais, fonte, congeladoEm}
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, mes)
);

alter table public.caixa_fechamento_mensal enable row level security;

create policy caixa_fechamento_mensal_leitura on public.caixa_fechamento_mensal
  for select using (empresa_id in (select privado.empresas_do_usuario()));
