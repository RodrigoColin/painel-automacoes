/**
 * Atualiza os cards de inadimplência dos planos de ação de todas as empresas
 * clientes. Chamada pelo container `cron` a cada 10 minutos (ver
 * `deploy/cron/crontab`): as rodadas do fluxo de caixa terminam em horário
 * imprevisível, e a chamada sai cedo quando não há pacote novo.
 *
 * `?empresa=<id>` limita a uma empresa, para operação manual.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { empresas } from "@/lib/db/schema";
import { sincronizarInadimplencia } from "@/lib/planos-acao/sincronizacao";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    return NextResponse.json({ erro: "CRON_SECRET não configurado." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const somente = request.nextUrl.searchParams.get("empresa");

  try {
    const alvos = await db
      .select({ id: empresas.id })
      .from(empresas)
      .where(and(eq(empresas.eh_plataforma, false), somente ? eq(empresas.id, somente) : undefined));

    let criados = 0;
    let regularizados = 0;
    const erros: { empresa: string; erro: string }[] = [];
    // Uma empresa por vez, e uma que falha não derruba as outras.
    for (const alvo of alvos) {
      try {
        const resultado = await sincronizarInadimplencia(alvo.id);
        criados += resultado?.criados ?? 0;
        regularizados += resultado?.regularizados ?? 0;
      } catch (erro) {
        erros.push({ empresa: alvo.id, erro: erro instanceof Error ? erro.message : String(erro) });
      }
    }

    return NextResponse.json({ empresas: alvos.length, criados, regularizados, erros });
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    );
  }
}
