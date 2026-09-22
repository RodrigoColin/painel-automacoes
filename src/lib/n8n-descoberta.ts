/**
 * Descoberta dos workflows do n8n.
 *
 * Fora da rota de sincronização porque dois caminhos precisam dela: o cron, a
 * cada cinco minutos, e o botão "Atualizar do n8n" da tela de vínculos.
 *
 * Usa a conexão do app, fora do RLS — a chave de API do n8n vive numa tabela
 * sem policy de SELECT. Só pode ser importado de Server Component ou Server
 * Action.
 */

import { eq } from "drizzle-orm";
import { db, type Executor } from "@/lib/db";
import { automacoes, empresas, integracaoN8n, integracaoN8nSegredo } from "@/lib/db/schema";
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
  banco: Executor,
  instanciaUrl: string,
  apiKey: string,
): Promise<ResultadoDescoberta> {
  const resultado = await listarWorkflows(instanciaUrl, apiKey);
  if ("erro" in resultado) return { erro: resultado.erro };

  const [plataforma] = await banco
    .select({ id: empresas.id })
    .from(empresas)
    .where(eq(empresas.eh_plataforma, true));

  if (!plataforma) return { erro: "Nenhuma empresa de plataforma cadastrada." };

  const existentes = await banco
    .select({ id: automacoes.id, nome: automacoes.nome, config: automacoes.config })
    .from(automacoes)
    .where(eq(automacoes.tipo, "n8n"));

  const conhecidos = new Map<string, { id: string; nome: string }>();
  for (const linha of existentes) {
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
    try {
      await banco.insert(automacoes).values(novas);
    } catch (erro) {
      return { erro: erro instanceof Error ? erro.message : String(erro) };
    }
  }

  // O nome pertence ao n8n: sem isto, um rename lá faria as duas telas
  // discordarem sobre o que é o mesmo workflow.
  const renomeados = resultado.workflows.filter((workflow) => {
    const atual = conhecidos.get(workflow.id);
    return atual !== undefined && atual.nome !== workflow.nome;
  });

  for (const workflow of renomeados) {
    await banco
      .update(automacoes)
      .set({ nome: workflow.nome })
      .where(eq(automacoes.id, conhecidos.get(workflow.id)!.id));
  }

  return { novas: novas.length, renomeados: renomeados.length };
}

/**
 * Conexão única com o n8n: URL e chave de API. Lida fora do RLS porque a
 * tabela do segredo não concede SELECT a ninguém pela sessão.
 */
export async function lerConexaoN8n() {
  const [[conexao], [segredo]] = await Promise.all([
    db
      .select({ instancia_url: integracaoN8n.instancia_url })
      .from(integracaoN8n)
      .where(eq(integracaoN8n.id, true)),
    db
      .select({ api_key: integracaoN8nSegredo.api_key })
      .from(integracaoN8nSegredo)
      .where(eq(integracaoN8nSegredo.id, true)),
  ]);

  return { url: conexao?.instancia_url ?? "", apiKey: segredo?.api_key ?? "" };
}

/**
 * Resolve a conexão sozinha e descobre. Para quem chama fora do cron, que já
 * carregou a conexão para outros fins.
 */
export async function descobrirAgora(): Promise<ResultadoDescoberta> {
  const conexao = await lerConexaoN8n();

  if (!conexao.url || !conexao.apiKey) {
    return {
      erro: "Nenhuma instância de n8n conectada. Conecte em Configurações → Integrações, com a Proos selecionada.",
    };
  }

  return descobrirWorkflows(db, conexao.url, conexao.apiKey);
}
