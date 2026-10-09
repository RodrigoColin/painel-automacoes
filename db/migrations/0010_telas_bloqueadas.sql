-- Telas escondidas por usuário, dentro de cada empresa.
--
-- Substitui `telas_empresa` (0003), que liberava por empresa e por nível
-- (interno/externo). Agora a escolha é por pessoa, feita na edição do usuário:
-- uma linha aqui = aquela tela está desligada para aquela pessoa naquela
-- empresa. Sem linha = tela liberada. Admin da plataforma enxerga tudo, com ou
-- sem linha — quem aplica isso é o painel (`telasDesabilitadas`).
--
-- Presa ao vínculo em `membros`: tirar o acesso da pessoa à empresa leva a
-- configuração junto.
--
-- Leitura: a própria pessoa (o painel esconde o menu e barra a página) e quem
-- administra a empresa (para montar os interruptores). Escrita: nenhuma policy
-- — só o servidor (`db`, fora do RLS), depois de conferir que quem chamou
-- administra a empresa, mesmo padrão de fluxo_caixa_config.
create table public.telas_bloqueadas (
  empresa_id    uuid not null,
  user_id       uuid not null,
  tela          text not null,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, user_id, tela),
  foreign key (empresa_id, user_id)
    references public.membros (empresa_id, user_id) on delete cascade
);

alter table public.telas_bloqueadas enable row level security;

create policy telas_bloqueadas_leitura on public.telas_bloqueadas
  for select using (user_id = auth.uid() or privado.eh_admin(empresa_id));

-- Ninguém ganha tela no deploy: o que estava desligado para o nível externo
-- da empresa vira bloqueio de cada pessoa que hoje pertence a ela. O nível
-- interno não tem equivalente (a equipe da Proos passa a ver tudo).
insert into public.telas_bloqueadas (empresa_id, user_id, tela)
select t.empresa_id, m.user_id, t.tela
  from public.telas_empresa t
  join public.membros m on m.empresa_id = t.empresa_id
 where not t.externo;

-- `telas_empresa` fica no banco, sem uso, até alguém decidir apagá-la: a
-- conversão acima não guarda o nível interno, e um `drop` aqui não teria volta.

-- Sem grant explícito: `alter default privileges` de 0001_base.sql já cobre
-- toda tabela nova criada em `public` pelo mesmo papel que roda as migrações.
