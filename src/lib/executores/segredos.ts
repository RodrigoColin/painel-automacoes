/**
 * Resolve placeholders `{{infisical.NOME}}` nas variáveis de ambiente de uma
 * automação Python, buscando o valor real no Infisical da empresa dona da
 * automação. É o que liga o toggle "Injetar segredos nas execuções" da tela
 * de Configurações ao que de fato roda no cron.
 *
 * Também expõe `mascararLogs`, para o toggle "Mascarar valores no histórico":
 * troca qualquer ocorrência de um valor resolvido por "•••" antes de gravar
 * em `logs_execucao`.
 */

import type { Executor } from "@/lib/db";
import { lerSegredos } from "@/lib/infisical/api";
import { caminhoGravado, lerConfiguracaoInfisical } from "@/lib/infisical/clientes";
import type { ResultadoExecucao } from "@/lib/executores/tipos";

const PLACEHOLDER = /\{\{\s*infisical\.([A-Za-z0-9_.\-/]+)\s*\}\}/g;

export type ResolucaoSegredos = {
  texto: string;
  /** Valores buscados no Infisical — usados para mascarar o histórico depois. */
  sensiveis: string[];
  /** Preferência da empresa — repassada para quem for gravar o histórico. */
  mascararValores: boolean;
};

/**
 * Troca cada `{{infisical.NOME}}` encontrado em `texto` pelo valor real.
 *
 * Lança erro (sem tentar seguir em frente) se a automação referencia um
 * segredo e a empresa não tem Infisical conectado, tem a injeção desligada,
 * ou o nome não existe no projeto/ambiente/caminho configurados — silenciar
 * isso deixaria a automação rodar com uma credencial vazia sem avisar
 * ninguém.
 */
export async function resolverVariaveisInfisical(
  banco: Executor,
  empresaId: string,
  texto: string,
): Promise<ResolucaoSegredos> {
  const nomes = new Set<string>();
  for (const match of texto.matchAll(PLACEHOLDER)) nomes.add(match[1]);
  if (nomes.size === 0) return { texto, sensiveis: [], mascararValores: true };

  // A conexão com o Infisical é única (credenciais nas variáveis de ambiente,
  // projeto/ambiente na tela da Proos) — só a pasta é por cliente, e é isso
  // que impede uma automação de enxergar a pasta de outra empresa.
  const [config, caminho] = await Promise.all([
    lerConfiguracaoInfisical(banco),
    caminhoGravado(banco, empresaId),
  ]);

  if (!config) {
    throw new Error(
      `Automação referencia segredos do Infisical (${[...nomes].join(", ")}), mas a Proos ainda não configurou o Infisical em Configurações.`,
    );
  }
  if (!config.injetarSegredos) {
    throw new Error(
      "Automação referencia segredos do Infisical, mas a injeção está desligada em Configurações.",
    );
  }
  if (!caminho) {
    throw new Error(
      "Esta empresa ainda não tem pasta no Infisical — peça para a Proos criar em Configurações → Clientes.",
    );
  }

  const mapa = await lerSegredos({
    projetoId: config.projetoId,
    ambiente: config.ambiente,
    caminho,
  });

  const sensiveis: string[] = [];
  const faltando: string[] = [];

  const resolvido = texto.replace(PLACEHOLDER, (original, nome: string) => {
    const valor = mapa[nome];
    if (valor === undefined) {
      faltando.push(nome);
      return original;
    }
    sensiveis.push(valor);
    return valor;
  });

  if (faltando.length > 0) {
    throw new Error(
      `Segredo(s) não encontrado(s) na pasta ${caminho} do Infisical: ${faltando.join(", ")}.`,
    );
  }

  return { texto: resolvido, sensiveis, mascararValores: config.mascararValores };
}

/** Substitui qualquer ocorrência de um valor sensível por "•••" nas mensagens de log. */
export function mascararLogs(
  logs: ResultadoExecucao["logs"],
  sensiveis: string[],
): ResultadoExecucao["logs"] {
  if (sensiveis.length === 0) return logs;

  return logs.map((log) => ({
    ...log,
    mensagem: sensiveis.reduce(
      (mensagem, valor) => (valor ? mensagem.split(valor).join("•••") : mensagem),
      log.mensagem,
    ),
  }));
}
