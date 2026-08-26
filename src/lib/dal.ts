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

/** Empresas em que a pessoa é membro ativa — alimenta o `empresa-switcher`. */
export const empresasDoUsuario = cache(async () => {
  await verificarSessao();
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("membros")
    .select("papel, empresas (id, nome, cnpj, email, eh_plataforma)")
    .eq("status", "ativo");

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    ...(linha.empresas as unknown as {
      id: string;
      nome: string;
      cnpj: string | null;
      email: string | null;
      eh_plataforma: boolean;
    }),
    papel: linha.papel as "admin" | "editor" | "leitor",
  }));
});

/**
 * A Broad é a única empresa marcada `eh_plataforma` — quem administra ela
 * administra a conexão compartilhada de n8n e Infisical, usada por todos os
 * clientes. Um admin de empresa cliente (Scopo, Oystr, ...) não passa aqui.
 */
export const souAdminPlataforma = cache(async () => {
  const empresas = await empresasDoUsuario();
  return empresas.some((empresa) => empresa.eh_plataforma && empresa.papel === "admin");
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

/** Garante que a pessoa pode alterar dados da empresa, não só lê-los. */
export async function exigirPermissaoDeEscrita(empresaId: string) {
  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === empresaId);

  if (!empresa || empresa.papel === "leitor") {
    throw new Error("Sem permissão para alterar dados desta empresa.");
  }

  return empresa;
}
