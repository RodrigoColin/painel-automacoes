"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { conferirCredenciais, encerrarSessao, iniciarSessao } from "@/lib/auth/sessao";

export type EstadoLogin = { erro?: string };

/**
 * Só aceita caminho interno — `proximo` vem da URL e não é confiável.
 *
 * Resolve contra uma origem fictícia e confere a origem final, em vez de
 * tentar bloquear padrões: "/\evil.com" passa num filtro que só barra "//"
 * no início, mas o parser de URL trata "\" como "/" e troca de host.
 */
function destinoSeguro(valor: FormDataEntryValue | null) {
  const origem = "http://painel.interno";
  if (typeof valor !== "string" || !valor) return "/dashboard";
  try {
    const destino = new URL(valor, origem);
    return destino.origin === origem
      ? `${destino.pathname}${destino.search}${destino.hash}`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export async function entrar(
  _estado: EstadoLogin,
  dados: FormData,
): Promise<EstadoLogin> {
  const email = String(dados.get("email") ?? "").trim();
  const senha = String(dados.get("senha") ?? "");

  if (!email || !senha) return { erro: "Informe e-mail e senha." };

  const usuarioId = await conferirCredenciais(email, senha);

  if (!usuarioId) {
    // Mensagem genérica de propósito: distinguir "e-mail não existe" de "senha
    // errada" permitiria descobrir quem tem conta no painel.
    return { erro: "E-mail ou senha inválidos." };
  }

  await iniciarSessao(usuarioId);

  revalidatePath("/", "layout");
  redirect(destinoSeguro(dados.get("proximo")));
}

export async function sair() {
  await encerrarSessao();

  revalidatePath("/", "layout");
  redirect("/login");
}
