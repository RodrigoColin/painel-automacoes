/**
 * Pasta de cada empresa cliente no projeto Infisical da Proos.
 *
 * O projeto é um só, compartilhado; o que isola a Scopo da Oystr é a pasta.
 * O app cria a pasta sozinho, em `<pasta raiz>/<nome da empresa>`, e grava o
 * caminho em `infisical_caminhos_clientes` — daí em diante é esse caminho
 * gravado que vale, mesmo que a empresa seja renomeada depois.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { garantirPasta, type LocalInfisical } from "@/lib/infisical/api";
import type { Database } from "@/lib/supabase/tipos-banco";

type Cliente = SupabaseClient<Database>;

export type ConfiguracaoInfisical = {
  projetoId: string;
  ambiente: string;
  pastaRaiz: string;
  injetarSegredos: boolean;
  mascararValores: boolean;
};

export async function lerConfiguracaoInfisical(
  supabase: Cliente,
): Promise<ConfiguracaoInfisical | null> {
  const { data } = await supabase
    .from("integracao_infisical_plataforma")
    .select("projeto_id, ambiente, pasta_raiz, injetar_segredos, mascarar_valores")
    .eq("id", true)
    .maybeSingle();

  if (!data) return null;
  return {
    projetoId: data.projeto_id,
    ambiente: data.ambiente,
    pastaRaiz: data.pasta_raiz,
    injetarSegredos: data.injetar_segredos,
    mascararValores: data.mascarar_valores,
  };
}

/** "Oystr Serviços Ltda." → "oystr-servicos-ltda": o Infisical só aceita letras, números, - e _ no nome da pasta. */
export function nomeDePasta(nome: string) {
  return (
    nome
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cliente"
  );
}

export function juntarCaminho(raiz: string, nome: string) {
  return `${raiz.replace(/\/+$/, "")}/${nome}`;
}

/** Caminho já gravado da empresa, ou `null` se a pasta ainda não foi criada. */
export async function caminhoGravado(supabase: Cliente, empresaId: string) {
  const { data } = await supabase
    .from("infisical_caminhos_clientes")
    .select("caminho")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return data?.caminho ?? null;
}

/**
 * Cria a pasta da empresa no Infisical (se ainda não existir) e grava o
 * caminho. Precisa de um cliente Supabase de admin da Proos: a escrita em
 * `infisical_caminhos_clientes` é restrita a ela pelo RLS.
 */
export async function garantirPastaCliente(
  supabase: Cliente,
  config: ConfiguracaoInfisical,
  empresa: { id: string; nome: string },
): Promise<LocalInfisical> {
  const caminho =
    (await caminhoGravado(supabase, empresa.id)) ??
    juntarCaminho(config.pastaRaiz, nomeDePasta(empresa.nome));

  const local = { projetoId: config.projetoId, ambiente: config.ambiente, caminho };
  await garantirPasta(local);

  const { error } = await supabase
    .from("infisical_caminhos_clientes")
    .upsert(
      { empresa_id: empresa.id, caminho, atualizado_em: new Date().toISOString() },
      { onConflict: "empresa_id" },
    );
  if (error) throw new Error(`Pasta criada no Infisical, mas o caminho não foi salvo: ${error.message}`);

  return local;
}
