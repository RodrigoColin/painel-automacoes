/**
 * Cliente Supabase com service role — ignora o RLS.
 *
 * Existe por um motivo só: o agendador roda sem sessão de usuário e precisa
 * enxergar automações de todas as empresas. Nenhum código de interface deve
 * importar isto; use `lib/supabase/server.ts`, que respeita o RLS.
 *
 * A chave nunca pode chegar ao navegador — daí o nome sem `NEXT_PUBLIC_`.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-banco";

/**
 * Inicialização preguiçosa: o Next avalia o topo dos módulos durante o build,
 * e ali a variável ainda não existe. Criar o cliente no import quebraria o
 * `next build`.
 */
let cliente: ReturnType<typeof createClient<Database>> | null = null;

export function clienteAdmin() {
  if (cliente) return cliente;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente — o agendador não roda sem elas.",
    );
  }

  cliente = createClient<Database>(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cliente;
}
