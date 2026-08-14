/**
 * Executa scripts Python versionados no repositório.
 *
 * Os scripts rodam numa Vercel Function Python separada (`api/executar.py`),
 * não neste processo. São scripts de primeira parte, versionados junto do
 * código — se um dia o painel aceitar upload de `.py` pelos usuários, isto
 * precisa migrar para Vercel Sandbox, porque código de terceiro não pode
 * rodar no mesmo runtime da aplicação.
 */

import type { ConfigPythonCron } from "@/lib/automacao-tipos";
import { truncar, type ResultadoExecucao } from "@/lib/executores/tipos";

/** Host da própria implantação — a Function Python é outro runtime, exige URL absoluta. */
function baseUrl() {
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

export async function executarPython(
  config: ConfigPythonCron,
  segredos: Record<string, unknown>,
): Promise<ResultadoExecucao> {
  if (!config.entrada?.trim()) {
    return {
      sucesso: false,
      logs: [{ nivel: "erro", mensagem: "Nenhum arquivo Python definido na automação." }],
    };
  }

  const segredo = process.env.EXECUTOR_SECRET;
  if (!segredo) {
    return {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: "EXECUTOR_SECRET ausente — o executor Python não pode ser chamado sem ele.",
        },
      ],
    };
  }

  // `variaveis` vem no formato CHAVE=valor, uma por linha.
  const variaveis: Record<string, string> = {};
  const bruto = typeof segredos.variaveis === "string" ? segredos.variaveis : "";
  for (const linha of bruto.split("\n")) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const igual = limpa.indexOf("=");
    if (igual <= 0) continue;
    variaveis[limpa.slice(0, igual).trim()] = limpa.slice(igual + 1).trim();
  }

  const timeoutMs = Math.max(1, config.timeoutSegundos || 300) * 1000;
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  const inicio = Date.now();

  try {
    const resposta = await fetch(`${baseUrl()}/api/executar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Executor-Secret": segredo,
      },
      body: JSON.stringify({
        entrada: config.entrada.trim(),
        variaveis,
        timeout: Math.max(1, config.timeoutSegundos || 300),
      }),
      signal: controlador.signal,
      cache: "no-store",
    });

    const duracao = Date.now() - inicio;
    const dados = (await resposta.json().catch(() => null)) as {
      ok?: boolean;
      codigo?: number;
      stdout?: string;
      stderr?: string;
      erro?: string;
    } | null;

    if (!resposta.ok || !dados) {
      return {
        sucesso: false,
        logs: [
          {
            nivel: "erro",
            mensagem: `Executor respondeu ${resposta.status} em ${duracao} ms.${
              dados?.erro ? ` ${truncar(dados.erro, 500)}` : ""
            }`,
          },
        ],
      };
    }

    const logs: ResultadoExecucao["logs"] = [];
    if (dados.stdout?.trim()) {
      logs.push({ nivel: "info", mensagem: truncar(dados.stdout) });
    }
    if (dados.stderr?.trim()) {
      // stderr não significa falha por si só — muita biblioteca escreve aviso ali.
      logs.push({ nivel: dados.ok ? "aviso" : "erro", mensagem: truncar(dados.stderr) });
    }
    if (dados.erro) {
      logs.push({ nivel: "erro", mensagem: truncar(dados.erro, 500) });
    }
    logs.push({
      nivel: dados.ok ? "info" : "erro",
      mensagem: `Script encerrou com código ${dados.codigo ?? "?"} em ${duracao} ms.`,
    });

    return { sucesso: Boolean(dados.ok), logs };
  } catch (erro) {
    const abortou = erro instanceof Error && erro.name === "AbortError";
    return {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: abortou
            ? `Tempo limite de ${timeoutMs / 1000}s excedido.`
            : `Falha ao chamar o executor: ${erro instanceof Error ? erro.message : String(erro)}`,
        },
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}
