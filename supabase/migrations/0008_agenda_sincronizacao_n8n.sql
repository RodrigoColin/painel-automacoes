-- A sincronização com o n8n roda a cada 5 minutos, não a cada minuto: os
-- workflows monitorados executam uma vez por dia, então varrer com mais
-- frequência só gastaria chamadas sem ganho nenhum.
--
-- Reaproveita o mesmo Bearer do agendador — as duas rotas exigem o CRON_SECRET.
--
-- PRÉ-REQUISITO: o segredo `sincronizador_url` no Vault, com a URL de
-- /api/sincronizar-n8n. Não fica neste arquivo para a migração poder ser
-- versionada junto com os demais segredos do agendador:
--
--   select vault.create_secret('https://<host>/api/sincronizar-n8n', 'sincronizador_url', '...');

create or replace function privado.acionar_sincronizador()
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
    from vault.decrypted_secrets where name = 'sincronizador_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'agendador_cron_secret';

  if destino is null or token is null then
    raise warning 'Segredos do sincronizador ausentes no Vault; disparo ignorado.';
    return;
  end if;

  perform net.http_get(
    url     := destino,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function privado.acionar_sincronizador() from public, anon, authenticated;

select cron.schedule(
  'sincronizador-n8n',
  '*/5 * * * *',
  $$select privado.acionar_sincronizador()$$
);
