/**
 * Atualização das 10h e 16h (container `cron`, ver `deploy/cron/crontab`) de
 * tudo que vem do Omie, para todas as empresas com pasta no Infisical:
 * sincroniza o faturamento e renova o cache (`cache_externo`) do resumo e das
 * contas correntes. As chaves em memória são relidas no Infisical a cada rodada.
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
import { descartarChavesOmie, obterResumoOmie } from "@/lib/omie/resumo";
import { contasOmie } from "@/lib/omie/fluxo-caixa";

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

  descartarChavesOmie();
  const resultados = [];
  for (const { empresa_id } of empresas) {
    const inicio = Date.now();
    const resultado = await sincronizarFaturamentoOmie(empresa_id, { completa });
    const resumo = await obterResumoOmie(empresa_id, { forcar: true, banco: db });
    const contas = await contasOmie(empresa_id, { forcar: true, banco: db }).then(
      (lista) => lista.length,
      (erro: unknown) => (erro instanceof Error ? erro.message : String(erro)),
    );
    resultados.push({
      empresa_id,
      duracaoMs: Date.now() - inicio,
      ...resultado,
      cache: { resumo: resumo.estado === "erro" ? resumo.mensagem : resumo.estado, contas },
    });
  }

  return NextResponse.json({ processadas: resultados.length, resultados });
}
