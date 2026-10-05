/**
 * Cliente da API do Infisical.
 *
 * As credenciais da Machine Identity vêm das variáveis de ambiente — nunca do
 * banco nem da tela:
 *
 *   INFISICAL_SITE_URL       (opcional; padrão https://app.infisical.com)
 *   INFISICAL_CLIENT_ID
 *   INFISICAL_CLIENT_SECRET
 *
 * Autenticação por Universal Auth: Client ID + Client Secret trocados por um
 * access token de curta duração, reaproveitado até perto de expirar.
 *
 * A identidade precisa de leitura e escrita no projeto: o app cria a pasta de
 * cada cliente e grava as chaves do Omie nela.
 */

const TIMEOUT_MS = 15_000;
const SITE_PADRAO = "https://app.infisical.com";

type CredenciaisInfisical = { siteUrl: string; clientId: string; clientSecret: string };

/** Local no Infisical: projeto + ambiente (slug) + caminho da pasta. */
export type LocalInfisical = { projetoId: string; ambiente: string; caminho: string };

/** Quais variáveis de ambiente estão faltando — vazio quando dá para conectar. */
export function variaveisFaltando(): string[] {
  return ["INFISICAL_CLIENT_ID", "INFISICAL_CLIENT_SECRET"].filter(
    (nome) => !process.env[nome]?.trim(),
  );
}

/** Instância usada — não é segredo, pode ir para a tela. */
export function siteUrlInfisical() {
  return (process.env.INFISICAL_SITE_URL?.trim() || SITE_PADRAO).replace(/\/+$/, "");
}

function credenciaisDoAmbiente(): CredenciaisInfisical | null {
  const clientId = process.env.INFISICAL_CLIENT_ID?.trim();
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  return { siteUrl: siteUrlInfisical(), clientId, clientSecret };
}

class ErroInfisical extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ErroInfisical";
  }
}

/* --------------------------------- Token -------------------------------- */

let token: { valor: string; expiraEm: number; clientId: string } | null = null;

async function obterToken(credenciais: CredenciaisInfisical): Promise<string> {
  // Renova com um minuto de folga, e também se a variável de ambiente mudou.
  if (token && token.clientId === credenciais.clientId && Date.now() < token.expiraEm - 60_000) {
    return token.valor;
  }

  const corpo = await chamar<{ accessToken: string; expiresIn: number }>(
    credenciais.siteUrl,
    "/api/v1/auth/universal-auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        clientId: credenciais.clientId,
        clientSecret: credenciais.clientSecret,
      }),
    },
  );

  token = {
    valor: corpo.accessToken,
    expiraEm: Date.now() + (corpo.expiresIn ?? 0) * 1000,
    clientId: credenciais.clientId,
  };
  return token.valor;
}

/* ------------------------------- Requisição ------------------------------ */

async function chamar<T>(siteUrl: string, caminho: string, init: RequestInit): Promise<T> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(`${siteUrl}${caminho}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
      signal: controlador.signal,
      cache: "no-store",
    });

    const corpo = (await resposta.json().catch(() => null)) as (T & { message?: string }) | null;

    if (!resposta.ok || !corpo) {
      throw new ErroInfisical(
        corpo?.message ?? `Infisical respondeu ${resposta.status}.`,
        resposta.status,
      );
    }
    return corpo;
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new ErroInfisical(`Infisical não respondeu em ${TIMEOUT_MS / 1000}s.`, null);
    }
    if (erro instanceof ErroInfisical) throw erro;
    throw new ErroInfisical(
      `Falha ao contatar o Infisical: ${erro instanceof Error ? erro.message : String(erro)}`,
      null,
    );
  } finally {
    clearTimeout(timer);
  }
}

function exigirCredenciais(): CredenciaisInfisical {
  const credenciais = credenciaisDoAmbiente();
  if (!credenciais) {
    throw new ErroInfisical(
      `Variáveis de ambiente ausentes: ${variaveisFaltando().join(", ")}.`,
      null,
    );
  }
  return credenciais;
}

async function autenticado<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const credenciais = exigirCredenciais();
  const acesso = await obterToken(credenciais);
  return chamar<T>(credenciais.siteUrl, caminho, {
    ...init,
    headers: { Authorization: `Bearer ${acesso}` },
  });
}

/* -------------------------------- Pastas -------------------------------- */

async function listarPastas(projetoId: string, ambiente: string, caminho: string) {
  const url = new URLSearchParams({ projectId: projetoId, environment: ambiente, path: caminho });
  const corpo = await autenticado<{ folders: { name: string }[] }>(`/api/v2/folders?${url}`);
  return corpo.folders.map((pasta) => pasta.name);
}

/**
 * Garante que a pasta existe, criando cada nível que faltar — o Infisical não
 * cria pastas intermediárias sozinho, e gravar segredo numa pasta
 * inexistente falha.
 */
export async function garantirPasta({ projetoId, ambiente, caminho }: LocalInfisical) {
  const partes = caminho.split("/").filter(Boolean);
  let pai = "/";

  for (const nome of partes) {
    const existentes = await listarPastas(projetoId, ambiente, pai);
    if (!existentes.includes(nome)) {
      await autenticado("/api/v2/folders", {
        method: "POST",
        body: JSON.stringify({ projectId: projetoId, environment: ambiente, name: nome, path: pai }),
      });
    }
    pai = pai === "/" ? `/${nome}` : `${pai}/${nome}`;
  }
}

/* ------------------------------- Segredos ------------------------------- */

/** Valores dos segredos de uma pasta. Pasta inexistente devolve vazio. */
export async function lerSegredos({
  projetoId,
  ambiente,
  caminho,
}: LocalInfisical): Promise<Record<string, string>> {
  const url = new URLSearchParams({
    projectId: projetoId,
    environment: ambiente,
    secretPath: caminho,
    viewSecretValue: "true",
  });

  try {
    const corpo = await autenticado<{ secrets?: { secretKey: string; secretValue: string }[] }>(
      `/api/v4/secrets?${url}`,
    );
    return Object.fromEntries((corpo.secrets ?? []).map((s) => [s.secretKey, s.secretValue]));
  } catch (erro) {
    if (erro instanceof ErroInfisical && erro.status === 404) return {};
    throw erro;
  }
}

/** Cria ou atualiza os segredos numa pasta (que precisa existir). */
export async function gravarSegredos(local: LocalInfisical, valores: Record<string, string>) {
  await autenticado("/api/v4/secrets/batch", {
    method: "PATCH",
    body: JSON.stringify({
      projectId: local.projetoId,
      environment: local.ambiente,
      secretPath: local.caminho,
      mode: "upsert",
      secrets: Object.entries(valores).map(([secretKey, secretValue]) => ({
        secretKey,
        secretValue,
      })),
    }),
  });
}

/** Remove segredos de uma pasta. Se nenhum existe (404), não é erro. */
export async function removerSegredos(local: LocalInfisical, nomes: string[]) {
  if (nomes.length === 0) return;
  try {
    await autenticado("/api/v4/secrets/batch", {
      method: "DELETE",
      body: JSON.stringify({
        projectId: local.projetoId,
        environment: local.ambiente,
        secretPath: local.caminho,
        secrets: nomes.map((secretKey) => ({ secretKey })),
      }),
    });
  } catch (erro) {
    if (erro instanceof ErroInfisical && erro.status === 404) return;
    throw erro;
  }
}

/**
 * Confere credenciais, projeto e ambiente listando as pastas da raiz. Não
 * prova permissão de escrita — essa só aparece ao criar a primeira pasta.
 */
export async function testarConexao(projetoId: string, ambiente: string) {
  await listarPastas(projetoId, ambiente, "/");
}
