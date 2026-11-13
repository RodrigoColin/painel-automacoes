"use server";

/**
 * Variação (ponte) sob demanda — o usuário escolhe uma data-base livre e o
 * worker do container `caixa` calcula com o MESMO motor Python das refs
 * pré-calculadas (caixa/variacao.py). Aqui só enfileiramos o pedido e lemos o
 * resultado; nada de duplicar o motor em TypeScript.
 *
 * `caixa_variacao_dia` não tem policy (padrão planos_*): a escrita passa pela
 * conexão do app, então a checagem de empresa do usuário aqui é o que vale.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { caixaPacoteDiario, caixaVariacaoDia } from "@/lib/db/schema";
import { empresasDoUsuario, verificarSessao } from "@/lib/dal";
import type { VariacaoRef } from "@/lib/fluxo-caixa/tipos";

export type EstadoVariacaoDia = {
  status: "na_fila" | "calculando" | "pronta" | "erro";
  resultado?: VariacaoRef;
  erro?: string;
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

async function autorizar(empresaId: string): Promise<string | null> {
  await verificarSessao();
  const empresas = await empresasDoUsuario();
  if (!empresas.some((e) => e.id === empresaId)) return "Sem acesso a esta empresa.";
  return null;
}

async function dataPacoteAtual(empresaId: string): Promise<string | null> {
  const [linha] = await db
    .select({ data: caixaPacoteDiario.data })
    .from(caixaPacoteDiario)
    .where(eq(caixaPacoteDiario.empresa_id, empresaId))
    .orderBy(desc(caixaPacoteDiario.data))
    .limit(1);
  return linha?.data ?? null;
}

/**
 * Pede a variação desde `dataBase`. Se já houver resultado válido para o
 * pacote atual, devolve na hora; senão (re)enfileira e o worker calcula em
 * segundos (ou após a rodada em andamento terminar).
 */
export async function solicitarVariacaoDia(empresaId: string, dataBase: string): Promise<EstadoVariacaoDia> {
  const negado = await autorizar(empresaId);
  if (negado) return { status: "erro", erro: negado };
  if (!DATA_ISO.test(dataBase)) return { status: "erro", erro: "Data inválida." };

  const atual = await dataPacoteAtual(empresaId);
  if (!atual) return { status: "erro", erro: "Ainda não há pacote de fluxo de caixa calculado." };
  if (dataBase >= atual) return { status: "erro", erro: "Escolha uma data anterior ao pacote atual." };

  const [existente] = await db
    .select()
    .from(caixaVariacaoDia)
    .where(and(eq(caixaVariacaoDia.empresa_id, empresaId), eq(caixaVariacaoDia.data_base, dataBase)));
  if (existente?.status === "pronta" && existente.data_pacote === atual && existente.resultado) {
    return { status: "pronta", resultado: existente.resultado as VariacaoRef };
  }
  if (existente?.status === "calculando" || (existente?.status === "na_fila" && existente.data_pacote === null)) {
    return { status: existente.status };
  }

  await db
    .insert(caixaVariacaoDia)
    .values({ empresa_id: empresaId, data_base: dataBase, status: "na_fila", data_pacote: null, resultado: null, erro: null })
    .onConflictDoUpdate({
      target: [caixaVariacaoDia.empresa_id, caixaVariacaoDia.data_base],
      set: { status: "na_fila", data_pacote: null, resultado: null, erro: null },
    });
  return { status: "na_fila" };
}

/** Polling do resultado — chamado pelo cliente a cada poucos segundos. */
export async function consultarVariacaoDia(empresaId: string, dataBase: string): Promise<EstadoVariacaoDia> {
  const negado = await autorizar(empresaId);
  if (negado) return { status: "erro", erro: negado };
  if (!DATA_ISO.test(dataBase)) return { status: "erro", erro: "Data inválida." };

  const [linha] = await db
    .select()
    .from(caixaVariacaoDia)
    .where(and(eq(caixaVariacaoDia.empresa_id, empresaId), eq(caixaVariacaoDia.data_base, dataBase)));
  if (!linha) return { status: "erro", erro: "Pedido não encontrado — tente de novo." };
  if (linha.status === "pronta" && linha.resultado) return { status: "pronta", resultado: linha.resultado as VariacaoRef };
  if (linha.status === "erro") return { status: "erro", erro: linha.erro ?? "Falha no cálculo." };
  return { status: linha.status };
}
