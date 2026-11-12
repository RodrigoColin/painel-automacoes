-- Excedentes OYSTR: fila + plano + De/Para, no molde da conciliacao (0006).
-- O analista sobe a planilha mensal de excedentes; o worker monta o PLANO
-- (so leitura no Omie) e grava uma linha por item processavel. O analista
-- resolve excecoes e aprova; so entao o worker cria as OSs no Omie (etapa
-- Faturar, nunca fatura). Idempotencia pelo cCodIntOS (EXC-AAAAMM-<contrato>).
-- A planilha viaja em base64 no row (<=10 MB no upload).
-- Leitura: quem pertence a empresa. Escrita: so o servidor e o container.

create table public.excedentes_lote (
  id             bigint generated always as identity primary key,
  empresa_id     uuid not null references public.empresas (id) on delete cascade,
  competencia    text not null,          -- AAAAMM do cCodIntOS (mes corrente no upload)
  planilha_nome  text,
  planilha_b64   text not null,
  status         text not null default 'na_fila'
                 check (status in ('na_fila', 'planejando', 'aguardando_aprovacao',
                                   'aprovado', 'criando', 'concluido', 'erro')),
  etapa          text,
  enviado_por    text not null,          -- email do analista
  criado_em      timestamptz not null default now(),
  planejado_em   timestamptz,
  aprovado_por   text,
  aprovado_em    timestamptz,
  concluido_em   timestamptz,
  resumo         jsonb,                  -- totais do plano e, depois, do relatorio final
  erro           text,
  log            text
);

create index on public.excedentes_lote (empresa_id, criado_em desc);
create index on public.excedentes_lote (status)
  where status in ('na_fila', 'planejando', 'aprovado', 'criando');

alter table public.excedentes_lote enable row level security;

create policy excedentes_lote_leitura on public.excedentes_lote
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Uma linha processavel da planilha (coluna R vazia). Linhas do mesmo
-- contrato viram itens da mesma OS na criacao.
create table public.excedentes_linha (
  id               bigint generated always as identity primary key,
  lote_id          bigint not null references public.excedentes_lote (id) on delete cascade,
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  linha_planilha   int not null,

  -- como veio na planilha
  cliente          text,
  cnpj             text,
  descricao        text,
  cod_recorrente   text,
  categoria_plan   text,                 -- "RPA Recorrente" / "Presto Recorrente" / "Execução Unica"
  liquido          numeric,
  franquia         numeric,
  consumo          numeric,
  excedentes       numeric,
  valor_unit       numeric,
  valor_total      numeric not null,     -- "Valor total excedentes": nunca recalcular

  -- resolucao (fase planejar)
  n_cod_cli        bigint,
  numero_contrato  text,                 -- numero humano (cNumCtr)
  n_cod_ctr        bigint,
  cod_excedente    text,
  n_cod_serv       bigint,
  desc_excedente   text,
  categoria        text,                 -- cCodCateg do servico excedente
  n_cod_cc         bigint,
  cidade_prest     text,
  venc_contrato    date,
  venc_final       date,
  regra_venc       text,
  email_envio      text,

  status           text not null default 'pendente'
                   check (status in ('pendente', 'ok', 'ja_existe', 'excecao',
                                     'resolvida', 'ignorada')),
  avisos           jsonb,                -- ex.: liquido difere do item do contrato
  excecao_motivo   text,
  resolucao        jsonb,                -- decisao do analista (servico escolhido, sem_contrato)
  resolvida_por    text,
  resolvida_em     timestamptz,

  -- criacao (fase criar)
  c_cod_int_os     text,
  n_cod_os         bigint,
  numero_os        text,
  criacao_status   text check (criacao_status in ('criada', 'ja_existia', 'falha')),
  criacao_erro     text,
  criada_em        timestamptz
);

create index on public.excedentes_linha (lote_id);
create index on public.excedentes_linha (empresa_id);

alter table public.excedentes_linha enable row level security;

create policy excedentes_linha_leitura on public.excedentes_linha
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- De/Para servico recorrente -> servico excedente. O banco e a fonte da
-- verdade (o xlsx do SharePoint passa a ser copia exportada). Edicao so por
-- editor/admin, com historico de quem mudou o que e quando.
create table public.excedentes_de_para (
  id                     bigint generated always as identity primary key,
  empresa_id             uuid not null references public.empresas (id) on delete cascade,
  cod_recorrente         text not null,
  descricao_recorrente   text,
  n_cod_serv_recorrente  bigint,
  cod_excedente          text,
  descricao_excedente    text,
  n_cod_serv_excedente   bigint,
  categoria_excedente    text,
  origem                 text,
  status                 text not null default 'automatico'
                         check (status in ('automatico', 'confirmado', 'confirmar', 'revisar')),
  atualizado_por         text,
  atualizado_em          timestamptz not null default now(),
  unique (empresa_id, cod_recorrente)
);

create index on public.excedentes_de_para (empresa_id);

alter table public.excedentes_de_para enable row level security;

create policy excedentes_de_para_leitura on public.excedentes_de_para
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create table public.excedentes_de_para_hist (
  id           bigint generated always as identity primary key,
  de_para_id   bigint not null references public.excedentes_de_para (id) on delete cascade,
  empresa_id   uuid not null references public.empresas (id) on delete cascade,
  alterado_por text not null,
  alterado_em  timestamptz not null default now(),
  antes        jsonb,
  depois       jsonb
);

create index on public.excedentes_de_para_hist (de_para_id, alterado_em desc);

alter table public.excedentes_de_para_hist enable row level security;

create policy excedentes_de_para_hist_leitura on public.excedentes_de_para_hist
  for select using (empresa_id in (select privado.empresas_do_usuario()));
