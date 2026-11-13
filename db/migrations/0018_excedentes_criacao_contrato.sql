-- Excedentes: permitir que criacao_status registre o desfecho das linhas que
-- faturam no contrato (não por OS). Até aqui o check só aceitava os desfechos
-- de OS; adiciona os de contrato.
alter table public.excedentes_linha
  drop constraint if exists excedentes_linha_criacao_status_check;

alter table public.excedentes_linha
  add constraint excedentes_linha_criacao_status_check
  check (criacao_status in (
    'criada', 'ja_existia', 'falha',
    'contrato_incluido', 'contrato_atualizado'
  ));
