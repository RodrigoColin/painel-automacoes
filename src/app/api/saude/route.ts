/**
 * Healthcheck: o container está de pé e alcança o banco.
 *
 * É o que o `docker compose up --wait` do deploy espera antes de dar a versão
 * por no ar. Público de propósito e sem nada de dado: responde só "ok".
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
