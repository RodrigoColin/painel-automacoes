/**
 * Dispatcher do agendador.
 *
 * O container `cron` chama esta rota a cada minuto. Ela busca as automações
 * ativas cuja `proxima_execucao` já venceu, dispara cada uma e reagenda. É o
 * que permite N automações com horários distintos a partir de um só cron
 * declarado estaticamente.
 *
 * Roda pela conexão do app, fora do RLS, porque não há sessão de usuário: o
 * agendador precisa enxergar automações de todas as empresas.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { automacoes, execucoes, logsExecucao } from "@/lib/db/schema";
import { lerConexaoN8n } from "@/lib/n8n-descoberta";
import { proximaExecucao } from "@/lib/agendamento";
import { executarN8n } from "@/lib/executores/n8n";
import { executarPython } from "@/lib/executores/python";
import type { ResultadoExecucao } from "@/lib/executores/tipos";
import type { ConfigAutomacao, ConfigN8n, ConfigPythonCron } from "@/lib/automacao-tipos";

/** Nunca cacheia: cada chamada precisa ler o estado atual da agenda. */
export const dynamic = "force-dynamic";

/** Teto por rodada — evita estourar o tempo da função numa fila grande. */
const LOTE = 20;

type LinhaAutomacao = {
  id: string;
  empresa_id: string;
  nome: string;
  tipo: ConfigAutomacao["tipo"];
  config: Record<string, unknown>;
  proxima_execucao: string | null;
};

export async function GET(request: NextRequest) {
  const naoAutorizado = verificarAutorizacao(request);
  if (naoAutorizado) return naoAutorizado;

  const agora = new Date();

  let vencidas: LinhaAutomacao[];
  try {
    vencidas = (await db
      .select({
        id: automacoes.id,
        empresa_id: automacoes.empresa_id,
        nome: automacoes.nome,
        tipo: automacoes.tipo,
        config: automacoes.config,
        proxima_execucao: automacoes.proxima_execucao,
      })
      .from(automacoes)
      .where(
        and(
          eq(automacoes.status, "ativa"),
          isNotNull(automacoes.proxima_execucao),
          lte(automacoes.proxima_execucao, agora.toISOString()),
        ),
      )
      .orderBy(asc(automacoes.proxima_execucao))
      .limit(LOTE)) as LinhaAutomacao[];
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    );
  }

  // Uma consulta por rodada, não uma por automação: a instância de n8n é
  // única no painel (conectada pela Proos), então vale para o lote inteiro.
  const instanciaN8n = vencidas.some((a) => a.tipo === "n8n")
    ? await lerConexaoN8n()
    : { url: "", apiKey: "" };

  // Em série, de propósito: o objetivo é previsibilidade de carga, não
  // velocidade. Uma rodada com 20 automações lentas é sinal de que o lote
  // precisa diminuir, não de paralelizar sem limite.
  const resultados = [];
  for (const automacao of vencidas) {
    resultados.push(await despachar(automacao, instanciaN8n));
  }

  return NextResponse.json({
    em: agora.toISOString(),
    processadas: resultados.length,
    resultados,
  });
}

/**
 * Só o container de cron pode chamar. Sem isto qualquer um dispararia todas
 * as automações do painel batendo numa URL pública.
 */
function verificarAutorizacao(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;

  if (!esperado) {
    return NextResponse.json(
      { erro: "CRON_SECRET não configurado no ambiente." },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  return null;
}

async function despachar(
  automacao: LinhaAutomacao,
  instanciaN8n: { url: string; apiKey: string },
) {
  const entrada = {
    tipo: automacao.tipo,
    config: automacao.config,
  } as unknown as ConfigAutomacao;

  // Reagenda antes de executar: se a execução demorar ou a função morrer no
  // meio, a automação não fica presa sendo redisparada a cada minuto.
  const proxima = proximaExecucao(entrada, new Date());
  await db
    .update(automacoes)
    .set({ proxima_execucao: proxima?.toISOString() ?? null })
    .where(eq(automacoes.id, automacao.id));

  const [execucao] = await db
    .insert(execucoes)
    .values({
      automacao_id: automacao.id,
      empresa_id: automacao.empresa_id,
      resultado: "em_andamento",
      origem: "agendador",
    })
    .returning({ id: execucoes.id })
    .catch(() => []);

  const execucaoId = execucao?.id;
  const inicio = Date.now();

  // Automações Python não têm variáveis de ambiente: o script roda só com o
  // ambiente mínimo do executor.
  let resultado: ResultadoExecucao;
  try {
    resultado =
      automacao.tipo === "python-cron"
        ? await executarPython(entrada.config as ConfigPythonCron)
        : await executarN8n(entrada.config as ConfigN8n, instanciaN8n);
  } catch (erro) {
    resultado = {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: `Erro inesperado no executor: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
        },
      ],
    };
  }

  const duracao = Date.now() - inicio;

  if (execucaoId) {
    await db
      .update(execucoes)
      .set({
        resultado: resultado.sucesso ? "sucesso" : "erro",
        finalizada_em: new Date().toISOString(),
        duracao_ms: duracao,
      })
      .where(eq(execucoes.id, execucaoId));

    if (resultado.logs.length > 0) {
      await db.insert(logsExecucao).values(
        resultado.logs.map((log) => ({
          execucao_id: execucaoId,
          empresa_id: automacao.empresa_id,
          nivel: log.nivel,
          mensagem: log.mensagem,
        })),
      );
    }
  }

  return {
    automacao: automacao.nome,
    sucesso: resultado.sucesso,
    duracaoMs: duracao,
    proximaExecucao: proxima?.toISOString() ?? null,
  };
}
