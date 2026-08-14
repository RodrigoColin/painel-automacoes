"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";

export type EstadoLogin = { erro?: string };

/** Só aceita caminho interno — `proximo` vem da URL e não é confiável. */
function destinoSeguro(valor: FormDataEntryValue | null) {
  const caminho = typeof valor === "string" ? valor : "";
  return caminho.startsWith("/") && !caminho.startsWith("//")
    ? caminho
    : "/dashboard";
}

export async function entrar(
  _estado: EstadoLogin,
  dados: FormData,
): Promise<EstadoLogin> {
  const email = String(dados.get("email") ?? "").trim();
  const senha = String(dados.get("senha") ?? "");

  if (!email || !senha) return { erro: "Informe e-mail e senha." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    // Mensagem genérica de propósito: distinguir "e-mail não existe" de "senha
    // errada" permitiria descobrir quem tem conta no painel.
    return { erro: "E-mail ou senha inválidos." };
  }

  revalidatePath("/", "layout");
  redirect(destinoSeguro(dados.get("proximo")));
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}
