-- Excedentes: acao "manter" — o item do contrato ja esta com o valor da base,
-- entao NADA e enviado ao Omie (nao gasta API nem reescreve a toa; pedido do
-- Rodrigo 17/11 ao ver "atualizar R$ X -> R$ X" no reprocesso de novembro).
-- "contrato_mantido" e o desfecho correspondente na fase criar.
alter table public.excedentes_linha
  drop constraint if exists excedentes_linha_contrato_acao_check;

alter table public.excedentes_linha
  add constraint excedentes_linha_contrato_acao_check
  check (contrato_acao in ('atualizar', 'incluir', 'manter'));

alter table public.excedentes_linha
  drop constraint if exists excedentes_linha_criacao_status_check;

alter table public.excedentes_linha
  add constraint excedentes_linha_criacao_status_check
  check (criacao_status in (
    'criada', 'ja_existia', 'falha',
    'contrato_incluido', 'contrato_atualizado', 'contrato_mantido'
  ));
