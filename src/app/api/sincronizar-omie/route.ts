/**
 * Sincroniza o faturamento do Omie de todas as empresas com pasta no
 * Infisical. Chamada pelo container `cron` às 10h e às 16h de Brasília (ver
 * `deploy/cron/crontab`).
 *
 * Empresas em série: cada uma já faz várias chamadas paralelas ao Omie, e as
 * chaves de clientes diferentes não dividem limite — em série, uma empresa
 * lenta não derruba as outras no meio.
 *
 * `?completa=1` refaz os 13 meses em vez de só o mês corrente e o anterior;
 * `?empresa=<id>` limita a uma empresa. Servem para operação manual.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { infisicalCaminhosClientes } from "@/lib/db/schema";
import { sincronizarFaturamentoOmie } from "@/lib/omie/sincronizacao";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    return NextResponse.json({ erro: "CRON_SECRET não configurado." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const completa = request.nextUrl.searchParams.get("completa") === "1";
  const somente = request.nextUrl.searchParams.get("empresa");

  let empresas: { empresa_id: string }[];
  try {
    empresas = await db
      .select({ empresa_id: infisicalCaminhosClientes.empresa_id })
      .from(infisicalCaminhosClientes)
      .where(somente ? eq(infisicalCaminhosClientes.empresa_id, somente) : undefined);
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    );
  }

  const resultados = [];
  for (const { empresa_id } of empresas) {
    const inicio = Date.now();
    const resultado = await sincronizarFaturamentoOmie(empresa_id, { completa });
    resultados.push({ empresa_id, duracaoMs: Date.now() - inicio, ...resultado });
  }

  return NextResponse.json({ processadas: resultados.length, resultados });
}
