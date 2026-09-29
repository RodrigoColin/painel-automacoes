/**
 * Cache das consultas a serviços externos, gravado no Postgres
 * (`cache_externo`) para sobreviver a deploy e reinício.
 *
 * Regra: vale 24 horas; o cron das 10h e 16h (/api/sincronizar-omie) renova
 * tudo com `forcar`, e os botões "Atualizar" também. Se a busca falhar e
 * houver valor guardado, devolve o guardado (marcado como desatualizado) —
 * o dado fica até a próxima atualização que der certo.
 *
 * Usa a conexão do app: quem chama já conferiu que a pessoa pertence à
 * empresa (DAL), e o cron não tem sessão.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cacheExterno } from "@/lib/db/schema";

export const VALIDADE_CACHE_MS = 24 * 60 * 60 * 1000;

export type ChaveCache = "omie:resumo" | "omie:contas";

export type Cacheado<T> = { valor: T; em: string; desatualizado: boolean };

export async function lerCache<T>(empresaId: string, chave: ChaveCache): Promise<{ valor: T; em: string } | null> {
  const [linha] = await db
    .select({ valor: cacheExterno.valor, em: cacheExterno.atualizado_em })
    .from(cacheExterno)
    .where(and(eq(cacheExterno.empresa_id, empresaId), eq(cacheExterno.chave, chave)))
    .limit(1);
  return linha ? { valor: linha.valor as T, em: linha.em } : null;
}

async function gravarCache(empresaId: string, chave: ChaveCache, valor: unknown) {
  await db
    .insert(cacheExterno)
    .values({ empresa_id: empresaId, chave, valor })
    .onConflictDoUpdate({
      target: [cacheExterno.empresa_id, cacheExterno.chave],
      set: { valor, atualizado_em: sql`now()` },
    });
}

export const idadeMs = (em: string) => Date.now() - Date.parse(em);

export async function comCache<T>(
  empresaId: string,
  chave: ChaveCache,
  buscar: () => Promise<T>,
  { forcar = false }: { forcar?: boolean } = {},
): Promise<Cacheado<T>> {
  const guardado = await lerCache<T>(empresaId, chave);
  if (!forcar && guardado && idadeMs(guardado.em) < VALIDADE_CACHE_MS) {
    return { ...guardado, desatualizado: false };
  }
  try {
    const valor = await buscar();
    await gravarCache(empresaId, chave, valor);
    return { valor, em: new Date().toISOString(), desatualizado: false };
  } catch (erro) {
    if (guardado) return { ...guardado, desatualizado: true };
    throw erro;
  }
}

/** Apaga o cache da empresa (tudo, ou só uma chave) — ex.: depois de trocar as chaves do Omie. */
export async function descartarCache(empresaId: string, chave?: ChaveCache) {
  await db
    .delete(cacheExterno)
    .where(and(eq(cacheExterno.empresa_id, empresaId), chave ? eq(cacheExterno.chave, chave) : undefined));
}
