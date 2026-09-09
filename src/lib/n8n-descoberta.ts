/**
 * Descoberta dos workflows do n8n.
 *
 * Fora da rota de sincronização porque dois caminhos precisam dela: o cron, a
 * cada cinco minutos, e o botão "Atualizar do n8n" da tela de vínculos.
 *
 * Usa a secret key — a chave de API do n8n vive numa tabela sem policy de
 * SELECT. Só pode ser importado de Server Component ou Server Action.
 */

import { clienteAdmin } from "@/lib/supabase/admin";
import { listarWorkflows } from "@/lib/executores/n8n-sincronizacao";

export type ResultadoDescoberta =
  | { novas: number; renomeados: number }
  | { erro: string };

/**
 * Traz para o painel todo workflow que existe no n8n.
 *
 * Workflow novo entra na empresa de plataforma: sem vínculo explícito, a
 * automação é da Proos. Reatribuir é trabalho da tela de vínculos, e a
 * descoberta nunca desfaz isso — workflow já conhecido tem só o nome
 * atualizado, jamais a empresa.
 */
export async function descobrirWorkflows(
  supabase: ReturnType<typeof clienteAdmin>,
  instanciaUrl: string,
  apiKey: string,
): Promise<ResultadoDescoberta> {
  const resultado = await listarWorkflows(instanciaUrl, apiKey);
  if ("erro" in resultado) return { erro: resultado.erro };

  const { data: plataforma } = await supabase
    .from("empresas")
    .select("id")
    .eq("eh_plataforma", true)
    .maybeSingle();

  if (!plataforma) return { erro: "Nenhuma empresa de plataforma cadastrada." };

  const { data: existentes } = await supabase
    .from("automacoes")
    .select("id, nome, config")
    .eq("tipo", "n8n");

  const conhecidos = new Map<string, { id: string; nome: string }>();
  for (const linha of existentes ?? []) {
    const workflowId = (linha.config as { workflowId?: unknown } | null)?.workflowId;
    if (typeof workflowId === "string") {
      conhecidos.set(workflowId, { id: linha.id, nome: linha.nome });
    }
  }

  const novas = resultado.workflows
    .filter((workflow) => !conhecidos.has(workflow.id))
    .map((workflow) => ({
      empresa_id: plataforma.id,
      nome: workflow.nome,
      descricao: "",
      tipo: "n8n" as const,
      // Espelha o estado do n8n na entrada. O painel não dispara workflow —
      // `monitorado` significa que ele só lê o que já rodou lá.
      status: workflow.ativo ? ("ativa" as const) : ("pausada" as const),
      config: {
        workflowId: workflow.id,
        modoDisparo: "monitorado",
        cron: "",
        aguardarResposta: false,
      },
    }));

  if (novas.length > 0) {
    const { error } = await supabase.from("automacoes").insert(novas);
    if (error) return { erro: error.message };
  }

  // O nome pertence ao n8n: sem isto, um rename lá faria as duas telas
  // discordarem sobre o que é o mesmo workflow.
  const renomeados = resultado.workflows.filter((workflow) => {
    const atual = conhecidos.get(workflow.id);
    return atual !== undefined && atual.nome !== workflow.nome;
  });

  for (const workflow of renomeados) {
    await supabase
      .from("automacoes")
      .update({ nome: workflow.nome })
      .eq("id", conhecidos.get(workflow.id)!.id);
  }

  return { novas: novas.length, renomeados: renomeados.length };
}

/**
 * Resolve a conexão sozinha e descobre. Para quem chama fora do cron, que já
 * carregou a conexão para outros fins.
 */
export async function descobrirAgora(): Promise<ResultadoDescoberta> {
  let admin: ReturnType<typeof clienteAdmin>;
  try {
    admin = clienteAdmin();
  } catch {
    return { erro: "SUPABASE_SECRET_KEY ausente no ambiente do servidor." };
  }

  const [{ data: conexao }, { data: segredo }] = await Promise.all([
    admin.from("integracao_n8n_plataforma").select("instancia_url").eq("id", true).maybeSingle(),
    admin
      .from("integracao_n8n_plataforma_segredo")
      .select("api_key")
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (!conexao?.instancia_url || !segredo?.api_key) {
    return {
      erro: "Nenhuma instância de n8n conectada. Conecte em Configurações → Integrações, com a Proos selecionada.",
    };
  }

  return descobrirWorkflows(admin, conexao.instancia_url, segredo.api_key);
}
