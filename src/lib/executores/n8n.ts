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

/**
 * `instancia` vem da conexão única que a Proos configura em
 * `integracao_n8n_plataforma` — não da automação. Ver `ConfigN8n`.
 */
export async function executarN8n(
  config: ConfigN8n,
  instancia: { url: string; apiKey: string },
): Promise<ResultadoExecucao> {
  const base = instancia.url.trim().replace(/\/+$/, "");
  if (!base || !config.workflowId.trim()) {
    return {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: base
            ? "ID do workflow não configurado na automação."
            : "Nenhuma instância n8n conectada. A Proos precisa conectá-la em Configurações.",
        },
      ],
    };
  }

  const url = `${base}/webhook/${config.workflowId.trim()}`;
  const cabecalhos: Record<string, string> = { "Content-Type": "application/json" };

  // A chave nunca chega ao cliente: a policy de
  // `integracao_n8n_plataforma_segredo` não concede SELECT a ninguém, e só o
  // agendador (secret key, que ignora RLS) a lê.
  if (instancia.apiKey) cabecalhos["X-N8N-API-KEY"] = instancia.apiKey;

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
