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
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * `cache` memoiza por render: várias chamadas na mesma página validam a sessão
 * uma vez só, em vez de uma vez por componente.
 */
export const verificarSessao = cache(async () => {
  const supabase = await criarClienteServidor();

  // `getClaims` valida a assinatura do JWT. `getSession` leria o cookie sem
  // verificar, o que não serve como base de autorização.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) redirect("/login");

  return { userId: claims.sub as string, email: claims.email as string };
});

type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  email: string | null;
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
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("membros")
    .select("papel, empresas (eh_plataforma)")
    .eq("user_id", userId)
    .eq("status", "ativo")
    .eq("papel", "admin");

  if (error) throw error;

  return (data ?? []).some(
    (linha) => (linha.empresas as unknown as { eh_plataforma: boolean } | null)?.eh_plataforma,
  );
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
export const empresasDoUsuario = cache(async () => {
  const { userId } = await verificarSessao();
  const supabase = await criarClienteServidor();

  if (await souAdminPlataforma()) {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, nome, cnpj, email, eh_plataforma")
      .order("criada_em");

    if (error) throw error;

    return (data ?? []).map((empresa) => ({
      ...(empresa as Empresa),
      papel: "admin" as const,
    }));
  }

  const { data, error } = await supabase
    .from("membros")
    .select("papel, empresas (id, nome, cnpj, email, eh_plataforma)")
    .eq("user_id", userId)
    .eq("status", "ativo");

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    ...(linha.empresas as unknown as Empresa),
    papel: linha.papel as "admin" | "editor" | "leitor",
  }));
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
