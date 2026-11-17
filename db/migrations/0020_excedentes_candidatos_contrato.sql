-- Excedentes: candidatos de contrato da linha, gravados pelo plano como
-- [{"numero","n_cod_ctr","n_dia_fat"}]. O cartao de excecao usa para oferecer
-- "faturar no contrato X" quando o cliente tem MAIS de um contrato ativo
-- (regra 17/11: cliente com UM contrato ativo passa a vincular sozinho).
alter table public.excedentes_linha
  add column contratos_candidatos jsonb;
