"use server";

import { headers } from "next/headers";
import { criarClienteServidor } from "@/lib/supabase/server";

export type EstadoEsqueciSenha = { erro?: string; enviado?: boolean };

async function origemAtual() {
  const cabecalhos = await headers();
  const proto = cabecalhos.get("x-forwarded-proto") ?? "https";
  const host = cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host");
  return `${proto}://${host}`;
}

export async function solicitarRedefinicao(
  _estado: EstadoEsqueciSenha,
  dados: FormData,
): Promise<EstadoEsqueciSenha> {
  const email = String(dados.get("email") ?? "").trim();
  if (!email) return { erro: "Informe seu e-mail." };

  const supabase = await criarClienteServidor();
  const origem = await origemAtual();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origem}/auth/callback?next=/atualizar-senha`,
  });

  // Sempre retorna sucesso, exista ou não a conta — do contrário o formulário
  // vira uma forma de descobrir quais e-mails têm cadastro no painel.
  return { enviado: true };
}
