-- Vincular uma automação a outra empresa move o dono dela e de tudo que
-- pendura: execuções, logs e segredos. São quatro tabelas, e a operação
-- precisa ser tudo-ou-nada — pela metade, o histórico ficaria apontando para
-- uma empresa e a automação para outra, e o RLS esconderia partes do registro
-- de ambos os lados.
--
-- Por isso vive no banco, e não como três updates no app.
--
-- SECURITY DEFINER com checagem explícita dentro: a função precisa alcançar
-- linhas de qualquer empresa, então não pode depender do RLS de quem chama —
-- mas só admin da Proos pode executá-la, mesma regra de `automacoes_escrita`.

create function public.vincular_automacao(automacao uuid, empresa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not privado.eh_admin_plataforma() then
    raise exception 'Só administradores da Proos podem vincular automações.';
  end if;

  if not exists (select 1 from public.empresas where id = empresa) then
    raise exception 'Empresa inexistente.';
  end if;

  -- Logs primeiro: o filtro depende de `execucoes` ainda apontar para o dono
  -- antigo? Não — a junção é por `execucao_id`, então a ordem não importa
  -- para a correção; fica assim só para agrupar o que é histórico.
  update public.logs_execucao l
     set empresa_id = empresa
    from public.execucoes e
   where e.id = l.execucao_id
     and e.automacao_id = automacao;

  update public.execucoes
     set empresa_id = empresa
   where automacao_id = automacao;

  update public.automacao_segredos
     set empresa_id = empresa
   where automacao_id = automacao;

  update public.automacoes
     set empresa_id = empresa,
         atualizada_em = now()
   where id = automacao;
end;
$$;

revoke all on function public.vincular_automacao(uuid, uuid) from public, anon;
grant execute on function public.vincular_automacao(uuid, uuid) to authenticated;
