/**
 * TEMPORÁRIO (diagnóstico) — devolve o pacote de fluxo de caixa de UM dia
 * específico, para comparar uma rodada antiga com a atual. A tela só serve o
 * pacote mais recente; esta rota lê `caixa_pacote_diario` por data.
 *
 * Só leitura, sob a sessão (RLS vale) e confirmando que a pessoa pertence à
 * empresa via `empresaAtual`. Não grava nada. Remover depois do uso.
 *
 *   GET /api/fluxo-caixa/pacote-dia?data=2026-10-14[&empresa=<uuid>]
 *
 * Sem `?empresa`, usa a empresa selecionada no cookie (a mesma da tela).
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { caixaPacoteDiario } from "@/lib/db/schema";
import { naSessao, empresaAtual } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const data = request.nextUrl.searchParams.get("data");
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ erro: "Informe ?data=AAAA-MM-DD." }, { status: 400 });
  }

  const solicitada =
    request.nextUrl.searchParams.get("empresa") ?? (await lerEmpresaSelecionada()) ?? undefined;
  const empresa = await empresaAtual(solicitada);
  if (!empresa) {
    return NextResponse.json({ erro: "Empresa não encontrada." }, { status: 404 });
  }

  const [linha] = await naSessao((tx) =>
    tx
      .select({
        data: caixaPacoteDiario.data,
        atualizado_em: caixaPacoteDiario.atualizado_em,
        extra: caixaPacoteDiario.extra,
        checagem: caixaPacoteDiario.checagem,
      })
      .from(caixaPacoteDiario)
      .where(and(eq(caixaPacoteDiario.empresa_id, empresa.id), eq(caixaPacoteDiario.data, data)))
      .limit(1),
  );

  if (!linha) {
    return NextResponse.json(
      { erro: `Sem pacote em ${data} para ${empresa.nome}.`, empresa: empresa.nome },
      { status: 404 },
    );
  }

  return NextResponse.json({ empresa: empresa.nome, ...linha });
}
