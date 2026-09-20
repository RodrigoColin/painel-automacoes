-- Categorias dos itens de cada contrato de serviço (ListarContratos,
-- itensContrato[].itemCabecalho.cCodCategItem).
--
-- Sem isso, um contrato ativo no Omie mas de categoria não recorrente (ex.:
-- um serviço avulso cadastrado como "Contrato de Serviço" por conveniência)
-- entrava nas telas de recorrência como se fosse um cliente recorrente sem
-- faturar — a categoria é o que decide se o contrato interessa pra lá.
alter table public.omie_contratos
  add column categorias text[] not null default '{}';
