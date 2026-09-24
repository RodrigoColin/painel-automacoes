/**
 * Pasta de cada empresa cliente no projeto Infisical da Proos.
 *
 * O projeto é um só, compartilhado; o que isola a Scopo da Oystr é a pasta.
 * O app cria a pasta sozinho, em `<pasta raiz>/<nome da empresa>`, e grava o
 * caminho em `infisical_caminhos_clientes` — daí em diante é esse caminho
 * gravado que vale, mesmo que a empresa seja renomeada depois.
 */

import { eq } from "drizzle-orm";
import type { Executor } from "@/lib/db";
import { infisicalCaminhosClientes, integracaoInfisical } from "@/lib/db/schema";
import { garantirPasta, type LocalInfisical } from "@/lib/infisical/api";

export type ConfiguracaoInfisical = {
  projetoId: string;
  ambiente: string;
  pastaRaiz: string;
};

/**
 * Todas as funções daqui recebem o executor de quem chama: a transação da
 * sessão (`naSessao`, com RLS) na tela, ou `db` no cron, que roda sem sessão.
 */
export async function lerConfiguracaoInfisical(
  banco: Executor,
): Promise<ConfiguracaoInfisical | null> {
  const [data] = await banco
    .select()
    .from(integracaoInfisical)
    .where(eq(integracaoInfisical.id, true));

  if (!data) return null;
  return {
    projetoId: data.projeto_id,
    ambiente: data.ambiente,
    pastaRaiz: data.pasta_raiz,
  };
}

/** "Oystr Serviços Ltda." → "oystr-servicos-ltda": o Infisical só aceita letras, números, - e _ no nome da pasta. */
function nomeDePasta(nome: string) {
  return (
    nome
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cliente"
  );
}

function juntarCaminho(raiz: string, nome: string) {
  return `${raiz.replace(/\/+$/, "")}/${nome}`;
}

/** Caminho já gravado da empresa, ou `null` se a pasta ainda não foi criada. */
export async function caminhoGravado(banco: Executor, empresaId: string) {
  const [data] = await banco
    .select({ caminho: infisicalCaminhosClientes.caminho })
    .from(infisicalCaminhosClientes)
    .where(eq(infisicalCaminhosClientes.empresa_id, empresaId));
  return data?.caminho ?? null;
}

/**
 * Cria a pasta da empresa no Infisical (se ainda não existir) e grava o
 * caminho. Precisa da sessão de um admin da Proos: a escrita em
 * `infisical_caminhos_clientes` é restrita a ela pelo RLS.
 */
export async function garantirPastaCliente(
  banco: Executor,
  config: ConfiguracaoInfisical,
  empresa: { id: string; nome: string },
): Promise<LocalInfisical> {
  const caminho =
    (await caminhoGravado(banco, empresa.id)) ??
    juntarCaminho(config.pastaRaiz, nomeDePasta(empresa.nome));

  const local = { projetoId: config.projetoId, ambiente: config.ambiente, caminho };
  await garantirPasta(local);

  const atualizado_em = new Date().toISOString();
  try {
    await banco
      .insert(infisicalCaminhosClientes)
      .values({ empresa_id: empresa.id, caminho, atualizado_em })
      .onConflictDoUpdate({
        target: infisicalCaminhosClientes.empresa_id,
        set: { caminho, atualizado_em },
      });
  } catch (erro) {
    throw new Error(
      `Pasta criada no Infisical, mas o caminho não foi salvo: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  return local;
}
