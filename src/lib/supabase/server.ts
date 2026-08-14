/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * Cada requisição precisa do seu próprio cliente — ele carrega os cookies de
 * sessão daquele usuário. Guardar num módulo compartilhado vazaria a sessão de
 * uma pessoa para outra.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/tipos-banco";

export async function criarClienteServidor() {
  const armazenamento = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return armazenamento.getAll();
        },
        setAll(cookiesParaGravar) {
          try {
            for (const { name, value, options } of cookiesParaGravar) {
              armazenamento.set(name, value, options);
            }
          } catch {
            // Server Components não podem gravar cookies. Quem renova a sessão
            // é o `proxy.ts`, então ignorar aqui é seguro.
          }
        },
      },
    },
  );
}
