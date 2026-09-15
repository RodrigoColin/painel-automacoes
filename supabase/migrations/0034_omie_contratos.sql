-- Situação do contrato de serviço no Omie (ListarContratos, cCodSit):
-- "00" rascunho, "10" ativo, "90" suspenso, "99" cancelado.
--
-- É o único jeito de separar, na aba "Faturamento e recorrência", um cliente
-- que só ficou um mês sem faturar (contrato continua ativo lá) de quem de
-- fato saiu — o faturamento sincronizado sozinho não distingue os dois.
--
-- Troca a lista inteira a cada sincronização: contrato encerrado no Omie
-- precisa sumir daqui, não dá pra comparar com o que já tínhamos.
create table public.omie_contratos (
  empresa_id      uuid    not null references public.empresas (id) on delete cascade,
  codigo          bigint  not null,
  cliente_codigo  bigint  not null,
  situacao        text    not null,
  primary key (empresa_id, codigo)
);

alter table public.omie_contratos enable row level security;

create policy omie_contratos_leitura on public.omie_contratos
  for select
  using (empresa_id in (select privado.empresas_do_usuario()));
