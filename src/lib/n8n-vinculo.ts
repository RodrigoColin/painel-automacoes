/**
 * Workflows do n8n oferecidos no seletor de vínculo da nova automação.
 *
 * Usa `clienteAdmin` porque a chave de API vive numa tabela sem policy de
 * SELECT — nem o admin da Proos a alcança pela própria sessão. Por isso este
 * módulo só pode ser importado de Server Component ou Server Action: a chave
 * não pode chegar ao navegador, e o que sai daqui é só id e nome.
 */

import { clienteAdmin } from "@/lib/supabase/admin";
import { listarWorkflows, type WorkflowN8n } from "@/lib/executores/n8n-sincronizacao";

export type WorkflowsDisponiveis =
  | { workflows: WorkflowN8n[] }
  | { erro: string };

export async function workflowsDisponiveis(): Promise<WorkflowsDisponiveis> {
  let admin: ReturnType<typeof clienteAdmin>;
  try {
    admin = clienteAdmin();
  } catch {
    // Falta a secret key no ambiente. Vira mensagem na tela em vez de derrubar
    // a página inteira de criação de automação.
    return { erro: "SUPABASE_SECRET_KEY ausente no ambiente — não dá para ler a conexão do n8n." };
  }

  const [{ data: conexao }, { data: segredo }, { data: vinculados }] = await Promise.all([
    admin.from("integracao_n8n_plataforma").select("instancia_url").eq("id", true).maybeSingle(),
    admin.from("integracao_n8n_plataforma_segredo").select("api_key").eq("id", true).maybeSingle(),
    admin.from("automacoes").select("config").eq("tipo", "n8n"),
  ]);

  if (!conexao?.instancia_url || !segredo?.api_key) {
    return {
      erro: "Nenhuma instância de n8n conectada. Conecte em Configurações → Integrações, com a Proos selecionada.",
    };
  }

  const resultado = await listarWorkflows(conexao.instancia_url, segredo.api_key);
  if ("erro" in resultado) return resultado;

  // O vínculo é único no painel inteiro, não por empresa: o mesmo workflow em
  // duas automações faria as duas espelharem as mesmas execuções, duplicando
  // o histórico e confundindo a quem pertence o resultado.
  const jaVinculados = new Set(
    (vinculados ?? [])
      .map((linha) => (linha.config as { workflowId?: unknown } | null)?.workflowId)
      .filter((id): id is string => typeof id === "string"),
  );

  return { workflows: resultado.workflows.filter((w) => !jaVinculados.has(w.id)) };
}
