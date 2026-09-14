/**
 * Sincroniza o faturamento do Omie de todas as empresas com pasta no
 * Infisical. Chamada uma vez por dia pelo pg_cron (migração 0031).
 *
 * Empresas em série: cada uma já faz várias chamadas paralelas ao Omie, e as
 * chaves de clientes diferentes não dividem limite — mas a função tem teto de
 * tempo, e em série uma empresa lenta não derruba as outras no meio.
 *
 * `?completa=1` refaz os 13 meses em vez de só o mês corrente e o anterior;
 * `?empresa=<id>` limita a uma empresa. Servem para operação manual.
 */

import { NextResponse, type NextRequest } from "next/server";
import { sincronizarFaturamentoOmie } from "@/lib/omie/sincronizacao";
import { clienteAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const supabase = clienteAdmin();
  let consulta = supabase.from("infisical_caminhos_clientes").select("empresa_id");
  if (somente) consulta = consulta.eq("empresa_id", somente);
  const { data: empresas, error } = await consulta;

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const resultados = [];
  for (const { empresa_id } of empresas ?? []) {
    const inicio = Date.now();
    const resultado = await sincronizarFaturamentoOmie(empresa_id, { completa });
    resultados.push({ empresa_id, duracaoMs: Date.now() - inicio, ...resultado });
  }

  return NextResponse.json({ processadas: resultados.length, resultados });
}
