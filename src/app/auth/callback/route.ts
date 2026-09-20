/**
 * Alvo do link de e-mail (confirmação de cadastro, redefinição de senha).
 * Troca o `code` do fluxo PKCE pela sessão e grava o cookie antes de
 * redirecionar — sem isso a próxima página carrega sem usuário autenticado.
 */

import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

// Resolve contra `origem` e confere a origem final, em vez de tentar bloquear
// padrões (ex.: "/\evil.com" passa num filtro que só barra "//" no início,
// mas o parser de URL trata "\" como "/" e troca de host).
function destinoSeguro(valor: string | null, origem: string) {
  if (!valor) return "/dashboard";
  try {
    const destino = new URL(valor, origem);
    return destino.origin === origem ? `${destino.pathname}${destino.search}${destino.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const proximo = destinoSeguro(url.searchParams.get("next"), url.origin);

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
