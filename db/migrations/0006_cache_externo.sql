-- Cache das consultas a serviços externos (Omie) que as telas fazem ao abrir.
--
-- Uma linha por empresa e tipo de dado (`chave`, ex.: 'omie:resumo',
-- 'omie:contas'). Vale 24 horas e é renovado às 10h e às 16h pelo cron
-- (/api/sincronizar-omie); o botão "Atualizar" da tela também renova. Se a
-- renovação falhar, a tela segue com o último valor bom até a próxima.
--
-- Nunca guarda segredo: as chaves do Omie continuam só no Infisical (e em
-- memória no servidor). Leitura: quem pertence à empresa. Escrita: só o
-- servidor, pela conexão direta.
create table public.cache_externo (
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  chave         text not null,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, chave)
);

alter table public.cache_externo enable row level security;

create policy cache_externo_leitura on public.cache_externo
  for select using (empresa_id in (select privado.empresas_do_usuario()));
