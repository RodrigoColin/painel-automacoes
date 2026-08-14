-- Aciona /api/agendador a cada minuto.
--
-- O plano Hobby da Vercel só permite cron diário, o que não serve para
-- automações de 15 em 15 minutos. Como a agenda já vive neste banco, é
-- coerente que o disparo saia daqui também — e não exige infra nova.
--
-- PRÉ-REQUISITO: os dois segredos precisam existir no Vault. Eles não ficam
-- neste arquivo de propósito, para a migração poder ser versionada:
--
--   select vault.create_secret('<CRON_SECRET da Vercel>', 'agendador_cron_secret', '...');
--   select vault.create_secret('https://<host>/api/agendador', 'agendador_url', '...');
--
-- Se a URL de produção mudar, atualize `agendador_url` no Vault — não aqui.

create or replace function privado.acionar_agendador()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  destino text;
  token   text;
begin
  select decrypted_secret into destino
    from vault.decrypted_secrets where name = 'agendador_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'agendador_cron_secret';

  if destino is null or token is null then
    raise warning 'Segredos do agendador ausentes no Vault; disparo ignorado.';
    return;
  end if;

  -- Disparo assíncrono: o pg_net enfileira e não segura a transação do cron.
  -- A resposta não interessa aqui — quem registra o resultado de cada
  -- automação é o próprio dispatcher, gravando em `execucoes`.
  perform net.http_get(
    url     := destino,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function privado.acionar_agendador() from public, anon, authenticated;

select cron.schedule(
  'dispatcher-automacoes',
  '* * * * *',
  $$select privado.acionar_agendador()$$
);

-- Para inspecionar depois:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select status_code, error_msg, created from net._http_response order by created desc limit 10;
