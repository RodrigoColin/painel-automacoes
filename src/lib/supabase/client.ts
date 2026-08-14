/**
 * Cliente Supabase para componentes do navegador.
 *
 * Usa a chave publishable, que é pública por natureza — o que protege os dados
 * é o RLS no banco, não o segredo da chave.
 */

import { createBrowserClient } from "@supabase/ssr";

export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
