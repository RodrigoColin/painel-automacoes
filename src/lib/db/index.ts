/**
 * Acesso ao Postgres.
 *
 * Duas portas, com o mesmo contrato que o Supabase tinha:
 *
 * - `db`: conexão do app (`painel_app`, com BYPASSRLS) — ignora o RLS. É o que
 *   era o `clienteAdmin()` com a secret key: agendador, sincronizações e as
 *   operações de conta, que rodam sem sessão ou atravessam empresas. Nenhum
 *   código de interface deve consultar por aqui sem ter conferido o acesso
 *   antes no DAL.
 *
 * - `comoUsuario(userId, fn)`: abre uma transação, troca para o papel
 *   `authenticated` e grava o id da pessoa em `painel.usuario_id`, que é o que
 *   `auth.uid()` lê. Dentro dela todas as policies valem — é a segunda
 *   barreira atrás do DAL, como era com o cliente da sessão do Supabase.
 *
 * Só pode ser importado no servidor.
 */

import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

export type Banco = PostgresJsDatabase<typeof schema>;
/** Transação ou conexão — o que as funções que só consultam aceitam. */
export type Executor = Banco | Parameters<Parameters<Banco["transaction"]>[0]>[0];

/**
 * Uma instância por processo. Em desenvolvimento o Next recarrega módulos a
 * cada edição; guardar no `globalThis` evita abrir um pool novo a cada vez até
 * esgotar as conexões do Postgres.
 */
const global = globalThis as unknown as { __painelBanco?: Banco };

function conectar(): Banco {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente no ambiente do servidor.");

  // `max` baixo de propósito: a VPS divide 2 GB de RAM com o n8n, e cada
  // conexão do Postgres custa memória própria.
  const cliente = postgres(url, { max: 10, idle_timeout: 30, onnotice: () => {} });
  return drizzle(cliente, { schema });
}

/**
 * Inicialização preguiçosa: o Next avalia o topo dos módulos no `next build`,
 * quando `DATABASE_URL` ainda não existe. Conectar no import quebraria o build.
 */
export const db: Banco = new Proxy({} as Banco, {
  get(_alvo, propriedade) {
    global.__painelBanco ??= conectar();
    const valor = Reflect.get(global.__painelBanco, propriedade);
    return typeof valor === "function" ? valor.bind(global.__painelBanco) : valor;
  },
});

export async function comoUsuario<T>(userId: string, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // `set local` e `set_config(..., true)` valem só até o fim da transação:
    // a conexão volta ao pool sem carregar a identidade de ninguém.
    // Um comando só (era dois): cada ida ao banco conta em toda consulta.
    await tx.execute(
      sql`select set_config('role', 'authenticated', true), set_config('painel.usuario_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/** Código de erro do Postgres (`23505` = unique_violation), se houver. */
export function codigoErro(erro: unknown): string | undefined {
  const causa = (erro as { cause?: unknown })?.cause ?? erro;
  return (causa as { code?: string })?.code;
}
