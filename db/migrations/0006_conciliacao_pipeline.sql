-- Conciliação bancária server-side: fila + histórico, no mesmo molde da
-- caixa_execucao (0005). O painel insere um pedido 'na_fila' quando o
-- operador sobe um OFX; o container de conciliação pega um por vez, roda o
-- motor (títulos e recebimentos buscados ao vivo no Omie) e grava o
-- resultado no próprio row. O OFX viaja em base64 no row (≤10 MB no upload).
-- Leitura: quem pertence à empresa. Escrita: só o servidor e o container,
-- pela conexão direta.

create table public.conciliacao_execucao (
  id           bigint generated always as identity primary key,
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  origem       text not null default 'manual' check (origem in ('manual', 'agendado')),
  conta_omie   text,
  ofx_nome     text,
  ofx_b64      text not null,
  status       text not null default 'na_fila'
               check (status in ('na_fila', 'em_andamento', 'sucesso', 'erro')),
  etapa        text,
  criada_em    timestamptz not null default now(),
  iniciada_em  timestamptz,
  concluida_em timestamptz,
  resultado    jsonb,
  erro         text,
  log          text
);

create index on public.conciliacao_execucao (empresa_id, criada_em desc);
create index on public.conciliacao_execucao (status) where status in ('na_fila', 'em_andamento');

alter table public.conciliacao_execucao enable row level security;

create policy conciliacao_execucao_leitura on public.conciliacao_execucao
  for select using (empresa_id in (select privado.empresas_do_usuario()));
