/**
 * Dispara workflows numa instância n8n.
 *
 * O painel não executa nada aqui — o n8n tem runtime próprio. O que fazemos é
 * chamar e registrar o que voltou.
 */

import type { ConfigN8n } from "@/lib/automacao-tipos";
import { truncar, type ResultadoExecucao } from "@/lib/executores/tipos";

/** Teto de espera. Sem isto uma instância travada seguraria o dispatcher. */
const TIMEOUT_MS = 60_000;

export async function executarN8n(
  config: ConfigN8n,
  segredos: Record<string, unknown>,
): Promise<ResultadoExecucao> {
  const base = config.instanciaUrl.trim().replace(/\/+$/, "");
  if (!base || !config.workflowId.trim()) {
    return {
      sucesso: false,
      logs: [
        { nivel: "erro", mensagem: "Instância n8n ou ID do workflow não configurados." },
      ],
    };
  }

  const url = `${base}/webhook/${config.workflowId.trim()}`;
  const cabecalhos: Record<string, string> = { "Content-Type": "application/json" };

  // A chave de API fica em `automacao_segredos`, fora de `config` — o cliente
  // nunca recebe este valor.
  const apiKey = segredos.apiKey;
  if (typeof apiKey === "string" && apiKey) cabecalhos["X-N8N-API-KEY"] = apiKey;

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  const inicio = Date.now();

  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ origem: "painel-automacoes", em: new Date().toISOString() }),
      signal: controlador.signal,
      // O disparo não deve reaproveitar resposta em cache de execução anterior.
      cache: "no-store",
    });

    const duracao = Date.now() - inicio;
    const corpo = config.aguardarResposta ? await resposta.text() : "";

    if (!resposta.ok) {
      return {
        sucesso: false,
        logs: [
          {
            nivel: "erro",
            mensagem: `n8n respondeu ${resposta.status} em ${duracao} ms. ${truncar(corpo, 500)}`,
          },
        ],
      };
    }

    const logs: ResultadoExecucao["logs"] = [
      { nivel: "info", mensagem: `Workflow disparado; n8n respondeu ${resposta.status} em ${duracao} ms.` },
    ];
    if (corpo) logs.push({ nivel: "info", mensagem: truncar(corpo) });

    return { sucesso: true, logs };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === "AbortError";
    return {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: abortou
            ? `Tempo limite de ${TIMEOUT_MS / 1000}s excedido ao chamar o n8n.`
            : `Falha ao chamar o n8n: ${erro instanceof Error ? erro.message : String(erro)}`,
        },
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}
