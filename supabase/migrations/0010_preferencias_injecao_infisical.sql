-- Preferências por empresa de como os segredos do Infisical são usados nas
-- execuções. Ficam na mesma tabela da conexão (legível pelos membros) — não
-- são segredo, só comportamento.

alter table public.integracoes_infisical
  add column injetar_segredos boolean not null default true,
  add column mascarar_valores boolean not null default true;
