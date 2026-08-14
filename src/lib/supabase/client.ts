/**
 * Cliente Supabase para componentes do navegador.
 *
 * Usa a chave publishable, que é pública por natureza — o que protege os dados
 * é o RLS no banco, não o segredo da chave.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/tipos-banco";

export function criarClienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
