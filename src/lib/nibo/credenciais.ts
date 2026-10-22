/**
 * Token da API Nibo de uma empresa cliente — o equivalente a OMIE_APP_KEY/
 * APP_SECRET do Omie (ver src/lib/omie/resumo.ts), guardado na MESMA pasta por
 * empresa no Infisical. O motor Python (proos-omie-mcp/omie_mcp/infisical.py::
 * buscar_credenciais_nibo) lê exatamente esta chave.
 *
 * Sem o add-on "API Pública" no plano, o token do Nibo expira em poucos dias e
 * não tem refresh programático — é renovado à mão, colando um token novo nesta
 * tela. Por isso testamos o token antes de gravar: token colado errado/vencido
 * é o erro mais provável.
 */

import type { Executor } from "@/lib/db";
import { lerSegredos, variaveisFaltando } from "@/lib/infisical/api";
import { caminhoGravado, lerConfiguracaoInfisical } from "@/lib/infisical/clientes";

export const SEGREDO_NIBO_TOKEN = "NIBO_API_TOKEN";

const BASE_NIBO = "https://api.nibo.com.br/empresas/v1";

/**
 * Testa o token contra a API do Nibo (GET /organizations, leve). Devolve `null`
 * se o token é válido, ou uma mensagem de erro para mostrar na tela.
 */
export async function testarTokenNibo(token: string): Promise<string | null> {
  try {
    const resp = await fetch(`${BASE_NIBO}/organizations?%24top=1&%24orderby=name`, {
      headers: { ApiToken: token },
      cache: "no-store",
    });
    if (resp.status === 401 || resp.status === 403) {
      return "O Nibo recusou o token (HTTP " + resp.status + "). Gere um token novo na empresa (Configurações > API no Nibo) e cole de novo.";
    }
    if (!resp.ok) {
      return `O Nibo respondeu HTTP ${resp.status} ao validar o token.`;
    }
    return null;
  } catch (erro) {
    return `Não foi possível falar com o Nibo: ${erro instanceof Error ? erro.message : String(erro)}`;
  }
}

/**
 * Diz se a empresa já tem o token do Nibo gravado no Infisical — sem devolver o
 * valor ao navegador (mesmo cuidado de credenciaisDaEmpresa do Omie). Usado só
 * para o indicador de status na tela de Configurações.
 */
export async function temTokenNibo(empresaId: string, banco: Executor): Promise<boolean> {
  const config = await lerConfiguracaoInfisical(banco);
  if (!config || variaveisFaltando().length > 0) return false;
  const caminho = await caminhoGravado(banco, empresaId);
  if (!caminho) return false;
  try {
    const mapa = await lerSegredos({ projetoId: config.projetoId, ambiente: config.ambiente, caminho });
    return Boolean(mapa[SEGREDO_NIBO_TOKEN]?.trim());
  } catch {
    return false;
  }
}
