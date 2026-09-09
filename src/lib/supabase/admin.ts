/**
 * Cliente Supabase privilegiado — ignora o RLS.
 *
 * Dois motivos para existir: o agendador roda sem sessão de usuário e precisa
 * enxergar automações de todas as empresas; e criar um acesso com e-mail e
 * senha (`criarAcessoUsuario`, em `lib/acoes.ts`) é uma operação da Auth Admin
 * API do Supabase, que não existe pela chave anon/authenticated. Fora esses
 * dois casos, nenhum código de interface deve importar isto; use
 * `lib/supabase/server.ts`, que respeita o RLS.
 *
 * Usa uma **secret key** (`sb_secret_…`), não a `service_role` legada. A
 * diferença que importa: secret keys são revogadas e rotacionadas
 * individualmente, e o Supabase responde 401 se elas forem usadas a partir de
 * um navegador. A `service_role` nasce do JWT secret do projeto — rotacioná-la
 * derruba tudo junto, e ela funciona em qualquer lugar, inclusive onde não
 * deveria. As legadas seguem válidas até o fim de 2026.
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
  const chave = process.env.SUPABASE_SECRET_KEY;

  if (!url || !chave) {
    throw new Error(
      "SUPABASE_SECRET_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente — o agendador não roda sem elas.",
    );
  }

  cliente = createClient<Database>(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cliente;
}
