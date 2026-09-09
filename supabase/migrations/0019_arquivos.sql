-- Seção de gerenciamento de arquivos: repositório geral de arquivos,
-- planilhas e documentos do painel, independente de automação. Guarda só o
-- metadado na tabela; o conteúdo em si fica no Storage.

create table public.arquivos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  caminho       text not null unique,
  tamanho_bytes bigint not null,
  tipo_mime     text,
  enviado_por   uuid references public.perfis(id) on delete set null,
  enviado_em    timestamptz not null default now()
);

create index arquivos_enviado_em_idx on public.arquivos (enviado_em desc);

alter table public.arquivos enable row level security;

-- Mesmo padrão de `automacoes`: leitura para qualquer pessoa ativa. Só quem
-- enviou (ou um admin) apaga; ninguém edita o metadado depois de enviado —
-- reenviar é a forma de substituir um arquivo.
create policy arquivos_leitura on public.arquivos
  for select using (privado.esta_ativo());

create policy arquivos_insercao on public.arquivos
  for insert with check (privado.esta_ativo() and enviado_por = auth.uid());

create policy arquivos_exclusao on public.arquivos
  for delete using (privado.eh_admin() or enviado_por = auth.uid());

-- Bucket privado — mesmo padrão de `automacao-uploads`: sem policy de leitura
-- para o cliente, só quem tem a service role (o handler de download/exclusão)
-- lê ou apaga o objeto. O metadado em `public.arquivos` é que autoriza a
-- operação antes de chamar o Storage com privilégio elevado.
insert into storage.buckets (id, name, public)
values ('arquivos', 'arquivos', false)
on conflict (id) do nothing;

create policy arquivos_bucket_insercao on storage.objects
  for insert to authenticated
  with check (bucket_id = 'arquivos' and privado.esta_ativo());
