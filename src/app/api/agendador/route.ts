/**
 * Dispatcher do agendador.
 *
 * Um único Vercel Cron chama esta rota a cada minuto. Ela busca as automações
 * ativas cuja `proxima_execucao` já venceu, dispara cada uma e reagenda. É o
 * que permite N automações com horários distintos a partir de um só cron
 * declarado estaticamente.
 *
 * Roda com service role porque não há sessão de usuário: o agendador precisa
 * enxergar automações de todas as empresas.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { proximaExecucao } from "@/lib/agendamento";
import { executarN8n } from "@/lib/executores/n8n";
import { executarPython } from "@/lib/executores/python";
import type { ResultadoExecucao } from "@/lib/executores/tipos";
import type { ConfigAutomacao, ConfigN8n, ConfigPythonCron } from "@/lib/automacao-tipos";

/** Nunca cacheia: cada chamada precisa ler o estado atual da agenda. */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  const supabase = clienteAdmin();
  const agora = new Date();

  const { data, error } = await supabase
    .from("automacoes")
    .select("id, empresa_id, nome, tipo, config, proxima_execucao")
    .eq("status", "ativa")
    .not("proxima_execucao", "is", null)
    .lte("proxima_execucao", agora.toISOString())
    .order("proxima_execucao", { ascending: true })
    .limit(LOTE);

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  const vencidas = (data ?? []) as unknown as LinhaAutomacao[];

  // Em série, de propósito: o objetivo é previsibilidade de carga, não
  // velocidade. Uma rodada com 20 automações lentas é sinal de que o lote
  // precisa diminuir, não de paralelizar sem limite.
  const resultados = [];
  for (const automacao of vencidas) {
    resultados.push(await despachar(automacao));
  }

  return NextResponse.json({
    em: agora.toISOString(),
    processadas: resultados.length,
    resultados,
  });
}

/**
 * Só o Vercel Cron pode chamar. Sem isto qualquer um dispararia todas as
 * automações do painel batendo numa URL pública.
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

async function despachar(automacao: LinhaAutomacao) {
  const supabase = clienteAdmin();
  const entrada = {
    tipo: automacao.tipo,
    config: automacao.config,
  } as unknown as ConfigAutomacao;

  // Reagenda antes de executar: se a execução demorar ou a função morrer no
  // meio, a automação não fica presa sendo redisparada a cada minuto.
  const proxima = proximaExecucao(entrada, new Date());
  await supabase
    .from("automacoes")
    .update({ proxima_execucao: proxima?.toISOString() ?? null })
    .eq("id", automacao.id);

  const { data: execucao } = await supabase
    .from("execucoes")
    .insert({
      automacao_id: automacao.id,
      empresa_id: automacao.empresa_id,
      resultado: "em_andamento",
      origem: "agendador",
    })
    .select("id")
    .single();

  const execucaoId = execucao?.id as string | undefined;
  const inicio = Date.now();

  const { data: linhaSegredo } = await supabase
    .from("automacao_segredos")
    .select("valores")
    .eq("automacao_id", automacao.id)
    .maybeSingle();

  const segredos = (linhaSegredo?.valores ?? {}) as Record<string, unknown>;

  let resultado: ResultadoExecucao;
  try {
    resultado =
      automacao.tipo === "python-cron"
        ? await executarPython(entrada.config as ConfigPythonCron, segredos)
        : await executarN8n(entrada.config as ConfigN8n, segredos);
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
    await supabase
      .from("execucoes")
      .update({
        resultado: resultado.sucesso ? "sucesso" : "erro",
        finalizada_em: new Date().toISOString(),
        duracao_ms: duracao,
      })
      .eq("id", execucaoId);

    if (resultado.logs.length > 0) {
      await supabase.from("logs_execucao").insert(
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
