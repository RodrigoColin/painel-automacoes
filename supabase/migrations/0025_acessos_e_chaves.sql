-- "Acessos e chaves": cofre de credenciais por empresa, para as automações
-- consumirem. Cada empresa cadastra e enxerga só as suas.
--
-- Divisão em duas tabelas, igual a `automacoes` / `automacao_segredos`: o
-- metadado (nome, descrição, quem cadastrou) é listável na tela; o valor fica
-- numa tabela sem policy de SELECT, então não volta pela API nem para quem
-- cadastrou. Quem lê o valor é o executor, com a secret key, que ignora RLS.
--
-- Passo seguinte previsto: espelhar estas chaves no Infisical, na pasta que
-- `infisical_caminhos_clientes` já define por empresa. Por isso `nome` é
-- único por empresa — ele é a referência estável do segredo.

create table public.acessos_chaves (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  nome          text not null,
  descricao     text not null default '',
  criado_por    uuid references public.perfis (id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- `lower(nome)`: "API_STRIPE" e "api_stripe" seriam a mesma referência para
-- quem consome, então não podem coexistir.
create unique index acessos_chaves_nome_por_empresa
    on public.acessos_chaves (empresa_id, lower(nome));

create index on public.acessos_chaves (empresa_id, criado_em desc);

-- `empresa_id` repetido aqui de propósito (como em `automacao_segredos`): a
-- policy precisa decidir sem consultar a tabela-mãe.
create table public.acessos_chaves_segredo (
  chave_id      uuid primary key references public.acessos_chaves (id) on delete cascade,
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.acessos_chaves         enable row level security;
alter table public.acessos_chaves_segredo enable row level security;

create policy acessos_chaves_leitura on public.acessos_chaves
  for select using (empresa_id in (select privado.empresas_do_usuario()));

create policy acessos_chaves_escrita on public.acessos_chaves
  for all using (privado.pode_escrever(empresa_id))
  with check (privado.pode_escrever(empresa_id));

-- Sem policy de SELECT, de propósito — o valor não volta pela API. Mas
-- INSERT/UPDATE precisam existir: RLS ligado sem policy nenhuma nega também a
-- escrita, e a própria tela não conseguiria gravar. Foi exatamente o bug que a
-- 0013 corrigiu nas integrações ("URL salva, mas a chave de API falhou").
create policy acessos_chaves_segredo_insercao on public.acessos_chaves_segredo
  for insert with check (privado.pode_escrever(empresa_id));

create policy acessos_chaves_segredo_atualizacao on public.acessos_chaves_segredo
  for update using (privado.pode_escrever(empresa_id))
  with check (privado.pode_escrever(empresa_id));
