/**
 * Camada de acesso a dados (DAL).
 *
 * É aqui que a autorização acontece de fato — o mais perto possível dos dados,
 * como recomenda o guia de autenticação do Next. O `proxy.ts` só faz a triagem
 * otimista; sozinho ele não protege nada, porque não roda em Server Actions
 * nem em Route Handlers chamados diretamente.
 *
 * Há duas barreiras, de propósito: estas funções filtram por empresa, e o RLS
 * no Postgres recusa a linha mesmo que uma consulta aqui esqueça o filtro.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { lerSessao } from "@/lib/auth/sessao";
import { comoUsuario, type Executor } from "@/lib/db";
import { empresas, membros, telasBloqueadas } from "@/lib/db/schema";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { TELAS, type ChaveTela } from "@/lib/telas";

/**
 * `cache` memoiza por render: várias chamadas na mesma página validam a sessão
 * uma vez só, em vez de uma vez por componente.
 */
export const verificarSessao = cache(async () => {
  // Confere o token no banco a cada requisição — o cookie sozinho não prova
  // nada, e sessão encerrada ou conta apagada precisam valer na hora.
  const sessao = await lerSessao();
  if (!sessao) redirect("/login");

  return sessao;
});

/**
 * Consulta em nome de quem está logado, com o RLS valendo — o equivalente ao
 * antigo cliente Supabase da sessão. Cada chamada é uma transação.
 */
export async function naSessao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  const { userId } = await verificarSessao();
  return comoUsuario(userId, fn);
}

type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  email: string | null;
  logo_url: string | null;
  eh_plataforma: boolean;
};

/**
 * A Admin é a única empresa marcada `eh_plataforma`. Quem a administra é
 * admin de plataforma — e, por `privado.eh_admin_plataforma()` no banco, tem
 * acesso de admin a todas as outras empresas, não só à própria. Consulta
 * independente de `empresasDoUsuario` de propósito: essa função decide o
 * formato da consulta abaixo com base nesta.
 */
export const souAdminPlataforma = cache(async () => {
  const { userId } = await verificarSessao();

  const linhas = await naSessao((tx) =>
    tx
      .select({ id: empresas.id })
      .from(membros)
      .innerJoin(empresas, eq(empresas.id, membros.empresa_id))
      .where(
        and(
          eq(membros.user_id, userId),
          eq(membros.status, "ativo"),
          eq(membros.papel, "admin"),
          eq(empresas.eh_plataforma, true),
        ),
      )
      .limit(1),
  );

  return linhas.length > 0;
});

/**
 * Empresas em que a pessoa tem acesso — alimenta o `empresa-switcher`.
 *
 * Admin de plataforma vê e administra todas; RLS (`empresas_do_usuario`) já
 * libera isso, então basta consultar `empresas` direto em vez de passar por
 * `membros` (que só teria linha para as empresas onde a pessoa é membro
 * explícito). Para todo mundo, a consulta continua partindo de `membros`,
 * com filtro explícito por `user_id` — não pode depender só do RLS: quem é
 * admin de uma empresa enxerga, pela policy `membros_admin`, a linha de
 * *todo mundo* que trabalha lá, não só a própria; sem este filtro, um admin
 * de uma empresa com N membros veria a mesma empresa N vezes no seletor.
 */
const colunasEmpresa = {
  id: empresas.id,
  nome: empresas.nome,
  cnpj: empresas.cnpj,
  email: empresas.email,
  logo_url: empresas.logo_url,
  eh_plataforma: empresas.eh_plataforma,
};

export const empresasDoUsuario = cache(async () => {
  const { userId } = await verificarSessao();

  if (await souAdminPlataforma()) {
    const linhas: Empresa[] = await naSessao((tx) =>
      tx.select(colunasEmpresa).from(empresas).orderBy(asc(empresas.criada_em)),
    );

    return linhas.map((empresa) => ({ ...empresa, papel: "admin" as const }));
  }

  const linhas = await naSessao((tx) =>
    tx
      .select({ ...colunasEmpresa, papel: membros.papel })
      .from(membros)
      .innerJoin(empresas, eq(empresas.id, membros.empresa_id))
      .where(and(eq(membros.user_id, userId), eq(membros.status, "ativo"))),
  );

  return linhas;
});

/**
 * Resolve a empresa em uso e confirma que a pessoa pertence a ela.
 *
 * O `empresa-switcher` manda um id vindo do cliente, que não pode ser aceito
 * de bom grado: sem esta checagem, trocar o id na requisição daria acesso a
 * outra empresa. Quando o id não confere, cai na primeira empresa da pessoa.
 */
export const empresaAtual = cache(async (idSolicitado?: string) => {
  const empresas = await empresasDoUsuario();
  if (empresas.length === 0) return null;

  const escolhida = idSolicitado
    ? empresas.find((empresa) => empresa.id === idSolicitado)
    : undefined;

  return escolhida ?? empresas[0];
});

/**
 * Automação é privilégio da Proos: empresa cliente apenas acompanha as que já
 * existem — não cria, não pausa, não exclui.
 *
 * A mesma regra vale no banco, na policy `automacoes_escrita`. Aqui é a
 * barreira que produz mensagem legível; lá é a que segura de verdade se
 * alguma chamada esquecer de passar por aqui.
 */
export async function exigirAdminPlataforma() {
  if (!(await souAdminPlataforma())) {
    throw new Error("Só administradores da Proos podem gerenciar automações.");
  }
}

/**
 * Garante que a pessoa pode alterar dados da empresa, não só lê-los.
 *
 * Diferente de `exigirAdminPlataforma`: aqui cada empresa manda na própria
 * casa — é o que vale para "Acessos e chaves", onde o cliente cadastra as
 * credenciais dele. Admin de plataforma passa em qualquer empresa, porque
 * `empresasDoUsuario` já o devolve como admin de todas.
 */
export async function exigirPermissaoDeEscrita(empresaId: string) {
  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === empresaId);

  if (!empresa || empresa.papel === "leitor") {
    throw new Error("Sem permissão para alterar dados desta empresa.");
  }

  return empresa;
}

/**
 * Telas escondidas de QUEM está olhando, nesta empresa. A configuração é por
 * pessoa (edição do usuário); admin da plataforma enxerga sempre tudo.
 */
export const telasDesabilitadas = cache(async (empresaId: string) => {
  if (await souAdminPlataforma()) return new Set<string>();

  const { userId } = await verificarSessao();
  const linhas = await naSessao((tx) =>
    tx
      .select({ tela: telasBloqueadas.tela })
      .from(telasBloqueadas)
      .where(and(eq(telasBloqueadas.empresa_id, empresaId), eq(telasBloqueadas.user_id, userId))),
  );
  return new Set(linhas.map((linha) => linha.tela));
});

/**
 * Barra a página quando esta tela foi desligada para quem acessa. O menu já esconde o link, mas quem digita a URL cai aqui.
 */
export async function exigirTela(chave: ChaveTela) {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa) return;

  const desligadas = await telasDesabilitadas(empresa.id);
  if (!desligadas.has(chave)) return;

  const destino = TELAS.find((tela) => !desligadas.has(tela.chave));
  redirect(destino?.href ?? "/configuracoes");
}
