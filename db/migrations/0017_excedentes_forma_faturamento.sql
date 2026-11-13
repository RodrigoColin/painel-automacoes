-- Excedentes: roteamento OS × Contrato.
--
-- Clientes com dia de faturamento = 2 (cabecalho.nDiaFat do contrato) faturam
-- o excedente DENTRO do contrato recorrente (mesma NFS-e), não por OS. O motor
-- resolve o contrato de cada linha e roteia por nDiaFat; a prévia mostra, por
-- linha, a Forma (os|contrato) e — no caso de contrato — a ação sobre o item
-- (atualizar o valor do serviço de excedente que já está no contrato, ou
-- incluir o que falta). Validado contra a base de novembro em 2026-11-13.
alter table public.excedentes_linha
  add column forma_faturamento  text not null default 'os'
             check (forma_faturamento in ('os', 'contrato')),
  add column n_dia_fat          int,
  add column contrato_acao      text
             check (contrato_acao in ('atualizar', 'incluir')),
  add column contrato_valor_atual numeric;
