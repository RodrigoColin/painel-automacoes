/**
 * Cliente mínimo da API do Omie.
 *
 * Toda chamada é um POST em `https://app.omie.com.br/api/v1/<modulo>/` com o
 * mesmo envelope: nome do método em `call`, as credenciais do cliente e os
 * parâmetros dentro de `param` (sempre um array de um objeto). Erro vem como
 * `faultstring`/`faultcode`, normalmente com HTTP 500.
 */

const BASE = "https://app.omie.com.br/api/v1";
const TIMEOUT_MS = 20_000;

export type CredenciaisOmie = { appKey: string; appSecret: string };

export class ErroOmie extends Error {
  constructor(
    message: string,
    readonly codigo: string | null,
  ) {
    super(message);
    this.name = "ErroOmie";
  }
}

/**
 * Listagem sem nenhum registro não é sucesso vazio no Omie: vem como falha
 * ("Não existem registros para a página [1]!"). Quem conta registros precisa
 * tratar isso como zero, não como erro.
 */
export function ehListaVazia(erro: unknown) {
  return (
    erro instanceof ErroOmie &&
    (erro.codigo?.endsWith("-5113") || /não existem registros/i.test(erro.message))
  );
}

/**
 * Bloqueio temporário do Omie por excesso de chamadas ("consumo redundante",
 * limite por minuto). Vale tentar de novo depois de alguns segundos.
 */
export function ehBloqueioTemporario(erro: unknown) {
  return (
    erro instanceof ErroOmie &&
    /redundant|aguarde|bloquead|limite|too many|tente novamente/i.test(erro.message)
  );
}

export async function chamarOmie<T>(
  modulo: string,
  call: string,
  param: Record<string, unknown>,
  credenciais: CredenciaisOmie,
): Promise<T> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(`${BASE}/${modulo}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        call,
        app_key: credenciais.appKey,
        app_secret: credenciais.appSecret,
        param: [param],
      }),
      signal: controlador.signal,
      cache: "no-store",
    });

    const corpo = (await resposta.json().catch(() => null)) as
      | (T & { faultstring?: string; faultcode?: string })
      | null;

    if (corpo?.faultstring) {
      throw new ErroOmie(
        corpo.faultstring.replace(/^ERROR:\s*/i, "").trim(),
        corpo.faultcode ?? null,
      );
    }
    if (!resposta.ok || !corpo) {
      throw new ErroOmie(`Omie respondeu ${resposta.status} em ${call}.`, null);
    }

    return corpo;
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new ErroOmie(`Omie não respondeu em ${TIMEOUT_MS / 1000}s (${call}).`, null);
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confere se o par App Key / App Secret é aceito pelo Omie. Devolve a
 * mensagem de erro, ou `null` quando as chaves funcionam.
 */
export async function testarChavesOmie(credenciais: CredenciaisOmie): Promise<string | null> {
  try {
    await chamarOmie(
      "geral/empresas",
      "ListarEmpresas",
      { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N" },
      credenciais,
    );
    return null;
  } catch (erro) {
    if (ehListaVazia(erro)) return null;
    return `O Omie recusou as chaves: ${erro instanceof Error ? erro.message : String(erro)}`;
  }
}
