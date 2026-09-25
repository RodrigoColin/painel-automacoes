-- Telas liberadas por empresa cliente, separadas por nível de quem acessa.
--
--   interno  equipe da Proos (admin da plataforma) olhando esta empresa
--   externo  pessoas da própria empresa cliente
--
-- Sem linha = tela liberada para os dois níveis; só o que a Proos desliga vira
-- registro. Leitura: quem pertence à empresa (o painel esconde o menu e barra a
-- página). Escrita: nenhuma policy — só o servidor (`db`, fora do RLS), depois
-- de conferir que a pessoa é admin da plataforma, mesmo padrão de
-- fluxo_caixa_config.
create table public.telas_empresa (
  empresa_id    uuid not null references public.empresas (id) on delete cascade,
  tela          text not null,
  interno       boolean not null default true,
  externo       boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, tela)
);

alter table public.telas_empresa enable row level security;

create policy telas_empresa_leitura on public.telas_empresa
  for select using (empresa_id in (select privado.empresas_do_usuario()));
