/**
 * Cofre de segredos usado pelas automações. O painel nunca guarda o valor dos
 * segredos — só a conexão (URL, projeto, ambiente) e as credenciais da
 * Machine Identity. O valor é buscado no Infisical a cada execução, via
 * Universal Auth (Client ID + Client Secret trocados por um access token de
 * curta duração).
 */

import type { ResultadoExecucao } from "@/lib/executores/tipos";

const TIMEOUT_MS = 15_000;

async function autenticar(
  siteUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const base = siteUrl.trim().replace(/\/+$/, "");
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(`${base}/api/v1/auth/universal-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => null);
      throw new Error(
        corpo?.message ?? `Infisical respondeu ${resposta.status} ao autenticar.`,
      );
    }

    const corpo = (await resposta.json()) as { accessToken: string };
    return corpo.accessToken;
  } finally {
    clearTimeout(timer);
  }
}

/** Testa a conexão completa — credenciais, projeto, ambiente e caminho — usada ao vincular uma empresa. */
export async function testarConexao(
  siteUrl: string,
  clientId: string,
  clientSecret: string,
  projetoId: string,
  ambiente: string,
  caminhoBase: string,
): Promise<ResultadoExecucao> {
  const base = siteUrl.trim().replace(/\/+$/, "");

  try {
    const accessToken = await autenticar(base, clientId, clientSecret);

    const url = new URL(`${base}/api/v4/secrets`);
    url.searchParams.set("projectId", projetoId);
    url.searchParams.set("environment", ambiente);
    url.searchParams.set("secretPath", caminhoBase || "/");
    url.searchParams.set("viewSecretValue", "false");

    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    try {
      const resposta = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: controlador.signal,
        cache: "no-store",
      });

      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => null);
        return {
          sucesso: false,
          logs: [
            {
              nivel: "erro",
              mensagem:
                corpo?.message ??
                `Infisical respondeu ${resposta.status} ao listar segredos do projeto/ambiente informados.`,
            },
          ],
        };
      }

      return {
        sucesso: true,
        logs: [{ nivel: "info", mensagem: "Conexão com o Infisical confirmada." }],
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (erro) {
    return {
      sucesso: false,
      logs: [
        {
          nivel: "erro",
          mensagem: `Falha ao contatar o Infisical: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
        },
      ],
    };
  }
}

/** Busca os segredos de um caminho — usado pelo executor no momento de rodar uma automação. */
export async function buscarSegredos(
  siteUrl: string,
  clientId: string,
  clientSecret: string,
  projetoId: string,
  ambiente: string,
  caminhoBase: string,
): Promise<Record<string, string>> {
  const base = siteUrl.trim().replace(/\/+$/, "");
  const accessToken = await autenticar(base, clientId, clientSecret);

  const url = new URL(`${base}/api/v4/secrets`);
  url.searchParams.set("projectId", projetoId);
  url.searchParams.set("environment", ambiente);
  url.searchParams.set("secretPath", caminhoBase || "/");
  url.searchParams.set("viewSecretValue", "true");

  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });

  if (!resposta.ok) {
    throw new Error(`Infisical respondeu ${resposta.status} ao buscar segredos.`);
  }

  const corpo = (await resposta.json()) as {
    secrets?: { secretKey: string; secretValue: string }[];
  };

  return Object.fromEntries(
    (corpo.secrets ?? []).map((s) => [s.secretKey, s.secretValue]),
  );
}
