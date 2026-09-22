/**
 * Executa o script Python enviado na criação da automação.
 *
 * O arquivo mora no disco (`automacao-scripts`, ver `lib/armazenamento.ts`).
 * Este lado lê o conteúdo e manda o código no corpo da chamada para o
 * container `executor` (`executor/servidor.py`), que o roda num diretório
 * temporário. Assim o executor não precisa de acesso ao banco nem ao volume
 * de arquivos — e só é alcançável pela rede interna do Docker.
 *
 * Só admin da Proos cria automação, então o código enviado é de quem opera o
 * painel. Se um dia clientes puderem enviar script, isto precisa de um
 * sandbox de verdade — código de terceiro não pode rodar neste container.
 */

import type { ConfigPythonCron } from "@/lib/automacao-tipos";
import { lerArquivo } from "@/lib/armazenamento";
import { truncar, type ResultadoExecucao } from "@/lib/executores/tipos";

/** Endereço do container do executor na rede do Docker (ver `docker-compose.yml`). */
function baseUrl() {
  return process.env.EXECUTOR_URL ?? "http://localhost:8000";
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

  let conteudo: Buffer | null;
  try {
    conteudo = await lerArquivo("automacao-scripts", config.arquivo.caminho);
  } catch (erro) {
    return falha(
      `Não foi possível ler o script ${config.arquivo.nome}: ${erro instanceof Error ? erro.message : String(erro)}.`,
    );
  }
  if (!conteudo) {
    return falha(`Não foi possível ler o script ${config.arquivo.nome}: arquivo ausente.`);
  }

  const codigo = conteudo.toString("utf8");

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
