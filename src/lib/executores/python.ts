/**
 * Executa o script Python enviado na criação da automação.
 *
 * O arquivo mora no bucket privado `automacao-scripts`. Este lado (Next, com
 * a secret key) baixa o conteúdo e manda o código no corpo da chamada para a
 * Vercel Function Python (`api/executar.py`), que o roda num diretório
 * temporário. Assim a Function Python não precisa de credencial do Supabase.
 *
 * Só admin da Proos cria automação, então o código enviado é de quem opera o
 * painel. Se um dia clientes puderem enviar script, isto precisa migrar para
 * Vercel Sandbox — código de terceiro não pode rodar neste runtime.
 */

import { BUCKET_SCRIPTS, type ConfigPythonCron } from "@/lib/automacao-tipos";
import { truncar, type ResultadoExecucao } from "@/lib/executores/tipos";
import { clienteAdmin } from "@/lib/supabase/admin";

/** Host da própria implantação — a Function Python é outro runtime, exige URL absoluta. */
function baseUrl() {
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}

function falha(mensagem: string): ResultadoExecucao {
  return { sucesso: false, logs: [{ nivel: "erro", mensagem }] };
}

export async function executarPython(config: ConfigPythonCron): Promise<ResultadoExecucao> {
  if (!config.arquivo?.caminho) {
    return falha("Nenhum arquivo Python enviado para esta automação.");
  }

  const segredo = process.env.EXECUTOR_SECRET;
  if (!segredo) {
    return falha("EXECUTOR_SECRET ausente — o executor Python não pode ser chamado sem ele.");
  }

  const { data: blob, error: erroDownload } = await clienteAdmin()
    .storage.from(BUCKET_SCRIPTS)
    .download(config.arquivo.caminho);

  if (erroDownload || !blob) {
    return falha(
      `Não foi possível baixar o script ${config.arquivo.nome}: ${erroDownload?.message ?? "arquivo ausente"}.`,
    );
  }

  const codigo = await blob.text();

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
        nome: config.arquivo.nome,
        codigo,
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
