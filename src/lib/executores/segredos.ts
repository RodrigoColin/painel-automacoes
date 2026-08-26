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

import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarSegredos } from "@/lib/executores/infisical";
import type { ResultadoExecucao } from "@/lib/executores/tipos";
import type { Database } from "@/lib/supabase/tipos-banco";

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
  supabase: SupabaseClient<Database>,
  empresaId: string,
  texto: string,
): Promise<ResolucaoSegredos> {
  const nomes = new Set<string>();
  for (const match of texto.matchAll(PLACEHOLDER)) nomes.add(match[1]);
  if (nomes.size === 0) return { texto, sensiveis: [], mascararValores: true };

  // A conexão com o Infisical é única, compartilhada por todas as empresas —
  // só o caminho dentro do projeto é por cliente, e é isso que impede uma
  // automação de enxergar a pasta de outra empresa.
  const [{ data: plataforma }, { data: caminho }] = await Promise.all([
    supabase
      .from("integracao_infisical_plataforma")
      .select("site_url, client_id, projeto_id, ambiente, injetar_segredos, mascarar_valores")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("infisical_caminhos_clientes")
      .select("caminho")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
  ]);

  if (!plataforma) {
    throw new Error(
      `Automação referencia segredos do Infisical (${[...nomes].join(", ")}), mas a Broad ainda não conectou o Infisical em Configurações → Credenciais.`,
    );
  }
  if (!plataforma.injetar_segredos) {
    throw new Error(
      `Automação referencia segredos do Infisical, mas a injeção está desligada em Configurações → Credenciais.`,
    );
  }
  if (!caminho) {
    throw new Error(
      "Esta empresa ainda não tem um caminho de segredos configurado no Infisical — peça para a Broad configurar em Configurações → Clientes.",
    );
  }

  const { data: segredo } = await supabase
    .from("integracao_infisical_plataforma_segredo")
    .select("client_secret")
    .eq("id", true)
    .maybeSingle();

  if (!segredo) {
    throw new Error("A conexão com o Infisical está sem Client Secret salvo.");
  }

  const mapa = await buscarSegredos(
    plataforma.site_url,
    plataforma.client_id,
    segredo.client_secret,
    plataforma.projeto_id,
    plataforma.ambiente,
    caminho.caminho,
  );

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
      `Segredo(s) não encontrado(s) no Infisical (projeto/ambiente/caminho configurados): ${faltando.join(", ")}.`,
    );
  }

  return { texto: resolvido, sensiveis, mascararValores: plataforma.mascarar_valores };
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
