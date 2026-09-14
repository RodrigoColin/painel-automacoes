-- Faturamento do Omie sincronizado no banco, para a aba "Faturamento e
-- recorrência" do Resumo Omie.
--
-- Por que gravar em vez de consultar ao vivo: a base é a lista de OS
-- faturadas (ListarOS), que o Omie devolve 100 por página, ~2,4 s cada. Um
-- cliente com ~500 OS/mês dá dezenas de páginas por ano — mais de um minuto
-- por abertura de tela, e bem acima do limite de chamadas do Omie. A tela lê
-- estas tabelas; a sincronização (botão Atualizar e cron diário) refaz só os
-- meses que ainda mudam.
--
-- Leitura: quem pertence à empresa. Escrita: nenhuma policy — só o servidor,
-- com a secret key, depois de conferir o acesso da pessoa.

-- Um valor por competência × cliente × categoria. `valor` já é a soma das OS
-- faturadas no mês, com o total de cada OS rateado entre as categorias dos
-- itens dela.
create table public.omie_faturamento_mensal (
  empresa_id       uuid    not null references public.empresas (id) on delete cascade,
  competencia      date    not null check (extract(day from competencia) = 1),
  cliente_codigo   bigint  not null,
  categoria_codigo text    not null,
  valor            numeric(14, 2) not null,
  quantidade_os    integer not null default 0,
  primary key (empresa_id, competencia, cliente_codigo, categoria_codigo)
);

create table public.omie_clientes (
  empresa_id uuid   not null references public.empresas (id) on delete cascade,
  codigo     bigint not null,
  nome       text   not null,
  primary key (empresa_id, codigo)
);

create table public.omie_categorias (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  codigo     text not null,
  descricao  text not null,
  primary key (empresa_id, codigo)
);

-- Estado da sincronização por empresa: quando rodou, até que competência os
-- dados estão completos e o erro da última tentativa, se houve.
create table public.omie_sincronizacao (
  empresa_id           uuid primary key references public.empresas (id) on delete cascade,
  iniciada_em          timestamptz,
  concluida_em         timestamptz,
  primeira_competencia date,
  erro                 text
);

alter table public.omie_faturamento_mensal enable row level security;
alter table public.omie_clientes           enable row level security;
alter table public.omie_categorias         enable row level security;
alter table public.omie_sincronizacao      enable row level security;

create policy omie_faturamento_leitura on public.omie_faturamento_mensal
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_clientes_leitura on public.omie_clientes
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_categorias_leitura on public.omie_categorias
  for select using (empresa_id in (select privado.empresas_do_usuario()));
create policy omie_sincronizacao_leitura on public.omie_sincronizacao
  for select using (empresa_id in (select privado.empresas_do_usuario()));

/* ------------------------------ Cron diário ------------------------------ */

-- Mesmo desenho do sincronizador do n8n (0008): pg_cron chama a rota com o
-- Bearer do agendador. Diário, 06:00 de Brasília (09:00 UTC): refaz o mês
-- corrente e o anterior de cada empresa com chaves do Omie.
--
-- PRÉ-REQUISITO: o segredo `omie_sincronizador_url` no Vault, com a URL de
-- /api/sincronizar-omie:
--
--   select vault.create_secret('https://<host>/api/sincronizar-omie', 'omie_sincronizador_url', '...');

create or replace function privado.acionar_sincronizador_omie()
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
    from vault.decrypted_secrets where name = 'omie_sincronizador_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'agendador_cron_secret';

  if destino is null or token is null then
    raise warning 'Segredos do sincronizador do Omie ausentes no Vault; disparo ignorado.';
    return;
  end if;

  perform net.http_get(
    url     := destino,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 300000
  );
end;
$$;

revoke all on function privado.acionar_sincronizador_omie() from public, anon, authenticated;

select cron.schedule(
  'sincronizador-omie',
  '0 9 * * *',
  $$select privado.acionar_sincronizador_omie()$$
);
