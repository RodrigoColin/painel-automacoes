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

  // Uma consulta por rodada, não uma por automação: a instância de n8n é
  // única no painel (conectada pela Proos), então vale para o lote inteiro.
  const instanciaN8n = vencidas.some((a) => a.tipo === "n8n")
    ? await lerInstanciaN8n(supabase)
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

/**
 * Conexão única com o n8n, lida com a secret key porque a tabela do segredo
 * não concede SELECT a ninguém pelo RLS.
 */
async function lerInstanciaN8n(supabase: ReturnType<typeof clienteAdmin>) {
  const [{ data: conexao }, { data: segredo }] = await Promise.all([
    supabase.from("integracao_n8n_plataforma").select("instancia_url").eq("id", true).maybeSingle(),
    supabase.from("integracao_n8n_plataforma_segredo").select("api_key").eq("id", true).maybeSingle(),
  ]);

  return {
    url: conexao?.instancia_url ?? "",
    apiKey: segredo?.api_key ?? "",
  };
}

async function despachar(
  automacao: LinhaAutomacao,
  instanciaN8n: { url: string; apiKey: string },
) {
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

  // Variáveis de ambiente das automações Python saíram por enquanto: o script
  // roda só com o ambiente mínimo do executor. Quando voltarem, a resolução
  // de `{{infisical.NOME}}` e o mascaramento estão em `lib/executores/segredos.ts`.
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
