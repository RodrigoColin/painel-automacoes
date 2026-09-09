-- Automação passa a ser privilégio exclusivo da Proos: empresa cliente apenas
-- acompanha as que já existem.
--
-- Antes, `pode_escrever(empresa_id)` deixava admin e editor de qualquer
-- empresa criar, pausar e excluir automação da própria empresa. A regra agora
-- é outra — só admin da empresa de plataforma mexe, em qualquer empresa.
--
-- A leitura não muda: `automacoes_leitura` continua liberando SELECT para
-- todo membro da empresa, e policies permissivas se somam (OR), então trocar
-- só a de escrita não tira a visibilidade de ninguém.

drop policy automacoes_escrita on public.automacoes;

create policy automacoes_escrita on public.automacoes
  for all using (privado.eh_admin_plataforma())
  with check (privado.eh_admin_plataforma());
