/**
 * Proxy — no Next 16 é o que antes se chamava middleware.
 *
 * Faz duas coisas, ambas baratas: renova o cookie de sessão do Supabase e
 * redireciona quem não está logado. A autorização de verdade NÃO mora aqui —
 * o proxy roda em toda requisição, inclusive em rotas pré-carregadas, então
 * consulta a banco aqui sairia caro. Quem decide o que cada pessoa pode ver é
 * a camada de acesso a dados (`lib/dal.ts`), com o RLS como segunda barreira.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Rotas que respondem sem sessão. O resto exige login. */
const ROTAS_PUBLICAS = ["/login", "/esqueci-senha", "/auth"];

export async function proxy(request: NextRequest) {
  // Precisa ser este objeto que segue adiante: é nele que o Supabase grava os
  // cookies renovados. Criar outro `NextResponse` depois descarta a sessão.
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesParaGravar) {
          for (const { name, value } of cookiesParaGravar) {
            request.cookies.set(name, value);
          }
          resposta = NextResponse.next({ request });
          for (const { name, value, options } of cookiesParaGravar) {
            resposta.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // `getClaims` valida o JWT em vez de acreditar no cookie — `getSession` não
  // serve aqui, porque o conteúdo do cookie pode ter sido forjado.
  const { data } = await supabase.auth.getClaims();

  const caminho = request.nextUrl.pathname;
  const ehPublica = ROTAS_PUBLICAS.some(
    (rota) => caminho === rota || caminho.startsWith(`${rota}/`),
  );

  if (!data?.claims && !ehPublica) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    // Preserva para onde a pessoa queria ir, para voltar depois do login.
    destino.searchParams.set("proximo", caminho);
    return NextResponse.redirect(destino);
  }

  if (data?.claims && caminho === "/login") {
    const destino = request.nextUrl.clone();
    destino.pathname = "/dashboard";
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  return resposta;
}

export const config = {
  matcher: [
    /*
     * Tudo, menos:
     * - arquivos estáticos e imagens, que não têm sessão a renovar;
     * - `/api`, que se autentica sozinho. O agendador é chamado pelo Vercel
     *   Cron, sem cookie de sessão — passar pelo proxy o mandaria para o
     *   /login e a automação nunca rodaria.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
