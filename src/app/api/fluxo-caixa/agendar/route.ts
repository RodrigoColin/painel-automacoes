/**
 * Enfileira a rodada do fluxo de caixa de todas as empresas com Omie
 * configurado (pasta no Infisical). Chamada pelo container `cron` às 10h e às
 * 16h (ver `deploy/cron/crontab`); o container `caixa` processa a fila.
 *
 * Só enfileira e responde na hora — cada rodada leva minutos. `?empresa=<id>`
 * limita a uma empresa, para operação manual.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { empresas, infisicalCaminhosClientes } from "@/lib/db/schema";
import { enfileirarRodadas } from "@/lib/fluxo-caixa/dados";

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
      .from(infisicalCaminhosClientes)
      .innerJoin(empresas, eq(empresas.id, infisicalCaminhosClientes.empresa_id))
      .where(
        and(
          eq(empresas.eh_plataforma, false),
          somente ? eq(empresas.id, somente) : undefined,
        ),
      );
    const enfileiradas = await enfileirarRodadas(
      alvos.map((a) => a.id),
      "agendado",
    );
    return NextResponse.json({ empresas: alvos.length, enfileiradas });
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    );
  }
}
