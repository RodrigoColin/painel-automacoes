-- Configuração do módulo de Excedentes por empresa.
--
-- n_cod_cc_padrao: conta corrente (nCodCC) usada quando a OS NÃO tem contrato
-- de onde herdar essa conta — o Omie EXIGE nCodCC na inclusão (IncluirOS), e
-- a OS sem contrato (ex.: cliente só com "Execução Única", ou contrato não
-- identificado que o analista decide criar avulso) não tem de onde tirar.
-- Achado real 13/11/2026: sem este campo, a inclusão falha com "É obrigatório
-- informar o código da Conta Corrente, tag [nCodCC]".
--
-- Leitura: quem pertence à empresa. Escrita: só o servidor (connection direta).
create table public.excedentes_config (
  empresa_id       uuid primary key references public.empresas (id) on delete cascade,
  n_cod_cc_padrao  bigint,
  atualizado_em    timestamptz not null default now()
);

alter table public.excedentes_config enable row level security;

create policy excedentes_config_leitura on public.excedentes_config
  for select using (empresa_id in (select privado.empresas_do_usuario()));

-- Semeia a Oystr com a conta que as OSs de excedentes já usam (1628924843,
-- confirmada nas OSs reais de novembro/2026). Resolve a empresa pelo nome; se
-- não houver Oystr neste banco, não insere nada.
insert into public.excedentes_config (empresa_id, n_cod_cc_padrao)
select id, 1628924843
from public.empresas
where nome ilike '%oystr%'
on conflict (empresa_id) do nothing;
