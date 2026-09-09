/**
 * Espelha no painel o histórico de execuções de workflows que rodam no n8n.
 *
 * Modo `monitorado`: o n8n continua sendo dono do agendamento e da execução —
 * o painel não dispara nada. Serve para vincular automações que já estão em
 * produção sem precisar editá-las, o que seria arriscar o que já funciona.
 */

import type { ResultadoExecucao } from "@/lib/executores/tipos";

/** Execução como o n8n devolve em `GET /api/v1/executions`. */
type ExecucaoN8n = {
  id: string | number;
  status?: string;
  startedAt?: string;
  stoppedAt?: string | null;
  finished?: boolean;
  mode?: string;
};

export type ExecucaoNormalizada = {
  externoId: string;
  resultado: "sucesso" | "erro" | "em_andamento";
  iniciadaEm: string;
  finalizadaEm: string | null;
  duracaoMs: number | null;
  origem: string;
};

const TIMEOUT_MS = 30_000;

/**
 * Busca execuções de um workflow, da mais recente para a mais antiga.
 *
 * `desde` corta o que já foi importado. O n8n não filtra por data na API, então
 * paramos de paginar assim que passamos do marco — daí a ordem importar.
 */
export async function buscarExecucoes(
  instanciaUrl: string,
  apiKey: string,
  workflowId: string,
  desde: Date | null,
  limite = 100,
): Promise<ExecucaoNormalizada[]> {
  const base = instanciaUrl.trim().replace(/\/+$/, "");
  const url = new URL(`${base}/api/v1/executions`);
  url.searchParams.set("workflowId", workflowId);
  url.searchParams.set("limit", String(Math.min(limite, 100)));
  url.searchParams.set("includeData", "false");

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!resposta.ok) {
      throw new Error(`n8n respondeu ${resposta.status} ao listar execuções.`);
    }

    const corpo = (await resposta.json()) as { data?: ExecucaoN8n[] };
    const execucoes = corpo.data ?? [];

    return execucoes
      .map(normalizar)
      .filter((e): e is ExecucaoNormalizada => e !== null)
      .filter((e) => !desde || new Date(e.iniciadaEm) > desde);
  } finally {
    clearTimeout(timer);
  }
}

function normalizar(bruta: ExecucaoN8n): ExecucaoNormalizada | null {
  if (!bruta.id || !bruta.startedAt) return null;

  const inicio = new Date(bruta.startedAt);
  const fim = bruta.stoppedAt ? new Date(bruta.stoppedAt) : null;

  return {
    externoId: String(bruta.id),
    resultado: traduzirStatus(bruta),
    iniciadaEm: inicio.toISOString(),
    finalizadaEm: fim?.toISOString() ?? null,
    duracaoMs: fim ? fim.getTime() - inicio.getTime() : null,
    // `trigger` no n8n é o disparo pelo gatilho do próprio workflow.
    origem: bruta.mode === "trigger" ? "n8n · agendado" : `n8n · ${bruta.mode ?? "?"}`,
  };
}

/**
 * O n8n usa `success`, `error`, `crashed`, `running`, `waiting`, `canceled`.
 * O painel só conhece três estados, então tudo que não terminou bem e não está
 * em curso é tratado como erro — inclusive `canceled`, que para quem acompanha
 * significa que a automação não entregou o resultado.
 */
function traduzirStatus(bruta: ExecucaoN8n): ExecucaoNormalizada["resultado"] {
  switch (bruta.status) {
    case "success":
      return "sucesso";
    case "running":
    case "waiting":
    case "new":
      return "em_andamento";
    default:
      return bruta.finished && !bruta.status ? "sucesso" : "erro";
  }
}

export type WorkflowN8n = {
  id: string;
  nome: string;
  ativo: boolean;
};

/**
 * Lista os workflows da instância, para o seletor de vínculo.
 *
 * Descarta os arquivados: arquivado no n8n não executa, então oferecê-lo só
 * produziria automação que nunca registra nada. Os inativos continuam na
 * lista — vincular antes de ativar no n8n é uma ordem de trabalho legítima.
 */
export async function listarWorkflows(
  instanciaUrl: string,
  apiKey: string,
): Promise<{ workflows: WorkflowN8n[] } | { erro: string }> {
  const base = instanciaUrl.trim().replace(/\/+$/, "");

  try {
    const resposta = await fetch(`${base}/api/v1/workflows?limit=250&excludePinnedData=true`, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      cache: "no-store",
    });

    if (!resposta.ok) {
      return {
        erro:
          resposta.status === 401
            ? "O n8n recusou a chave de API. Reconecte em Configurações → Integrações."
            : `O n8n respondeu ${resposta.status} ao listar os workflows.`,
      };
    }

    const corpo = (await resposta.json()) as { data?: unknown };
    const lista = Array.isArray(corpo.data) ? corpo.data : [];

    const workflows = lista
      .map((item) => item as Record<string, unknown>)
      .filter((item) => typeof item.id === "string" && item.isArchived !== true)
      .map((item) => ({
        id: item.id as string,
        nome: typeof item.name === "string" ? item.name : (item.id as string),
        ativo: item.active === true,
      }));

    return { workflows };
  } catch (erro) {
    return {
      erro: `Falha ao contatar o n8n: ${erro instanceof Error ? erro.message : String(erro)}`,
    };
  }
}

/** Testa a conexão com a instância — usado ao vincular uma empresa. */
export async function testarConexao(
  instanciaUrl: string,
  apiKey: string,
): Promise<ResultadoExecucao> {
  const base = instanciaUrl.trim().replace(/\/+$/, "");

  try {
    const resposta = await fetch(`${base}/api/v1/workflows?limit=1`, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      cache: "no-store",
    });

    return resposta.ok
      ? { sucesso: true, logs: [{ nivel: "info", mensagem: "Conexão com o n8n confirmada." }] }
      : {
          sucesso: false,
          logs: [{ nivel: "erro", mensagem: `n8n respondeu ${resposta.status}.` }],
        };
  } catch (erro) {
    return {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: `Falha ao contatar o n8n: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
        },
      ],
    };
  }
}
