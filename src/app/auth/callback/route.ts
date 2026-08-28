/**
 * Alvo do link de e-mail (confirmação de cadastro, redefinição de senha).
 * Troca o `code` do fluxo PKCE pela sessão e grava o cookie antes de
 * redirecionar — sem isso a próxima página carrega sem usuário autenticado.
 */

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

function destinoSeguro(valor: string | null) {
  return valor && valor.startsWith("/") && !valor.startsWith("//")
    ? valor
    : "/dashboard";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const proximo = destinoSeguro(url.searchParams.get("next"));

  if (code) {
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(proximo, url.origin));
    }
  }

  const destino = new URL("/login", url.origin);
  destino.searchParams.set("erro", "link-invalido");
  return NextResponse.redirect(destino);
}
