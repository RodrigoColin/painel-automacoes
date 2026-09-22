/**
 * Proxy — no Next 16 é o que antes se chamava middleware.
 *
 * Só triagem otimista: redireciona quem nem tem cookie de sessão. Não
 * consulta o banco — o proxy roda em toda requisição, inclusive em rotas
 * pré-carregadas. Quem valida a sessão de verdade (token no banco, não
 * vencido) e decide o que cada pessoa pode ver é a camada de acesso a dados
 * (`lib/dal.ts`), com o RLS como segunda barreira. Cookie forjado passa por
 * aqui e morre no DAL.
 */

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO } from "@/lib/auth/constantes";

/** Rotas que respondem sem sessão. O resto exige login. */
const ROTAS_PUBLICAS = ["/login"];

export function proxy(request: NextRequest) {
  const temSessao = request.cookies.has(COOKIE_SESSAO);

  const caminho = request.nextUrl.pathname;
  const ehPublica = ROTAS_PUBLICAS.some(
    (rota) => caminho === rota || caminho.startsWith(`${rota}/`),
  );

  if (!temSessao && !ehPublica) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    // Preserva para onde a pessoa queria ir, para voltar depois do login.
    destino.searchParams.set("proximo", caminho);
    return NextResponse.redirect(destino);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Tudo, menos:
     * - arquivos estáticos e imagens, que não têm sessão a conferir;
     * - `/api`, que se autentica sozinho. O agendador é chamado pelo container
     *   de cron, sem cookie de sessão — passar pelo proxy o mandaria para o
     *   /login e a automação nunca rodaria;
     * - `/arquivos-publicos`, as logos das empresas, que o navegador pede sem
     *   precisar de sessão.
     */
    "/((?!api|arquivos-publicos|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
