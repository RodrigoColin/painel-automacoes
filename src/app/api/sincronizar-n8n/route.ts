/**
 * Descobre os workflows do n8n e sincroniza o histórico de execuções deles.
 *
 * Duas etapas por rodada. A descoberta traz para o painel todo workflow que
 * existe na instância — o painel não espera ninguém cadastrar nada. A
 * sincronização espelha as execuções de cada um.
 *
 * Separada do `/api/agendador` de propósito: aquele *dispara* automações, esta
 * só *lê* o que já aconteceu em outro sistema. Misturar as duas faria uma falha
 * de rede no n8n atrasar o disparo de automações que não têm nada a ver.
 *
 * Roda com a secret key porque atravessa todas as empresas, sem sessão.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import { buscarExecucoes } from "@/lib/executores/n8n-sincronizacao";
import { descobrirWorkflows } from "@/lib/n8n-descoberta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type LinhaMonitorada = {
  id: string;
  empresa_id: string;
  nome: string;
  config: { workflowId?: string };
  sincronizado_ate: string | null;
};

export async function GET(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    return NextResponse.json({ erro: "CRON_SECRET não configurado." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${esperado}`) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const supabase = clienteAdmin();

  // A conexão com o n8n é única, compartilhada por todas as empresas — só o
  // workflowId de cada automação muda.
  const [{ data: integracao }, { data: segredo }] = await Promise.all([
    supabase.from("integracao_n8n_plataforma").select("instancia_url").eq("id", true).maybeSingle(),
    supabase
      .from("integracao_n8n_plataforma_segredo")
      .select("api_key")
      .eq("id", true)
      .maybeSingle(),
  ]);

  // Falta de conexão é estado de configuração, não falha: responde 200 para
  // não encher o log do cron de erro enquanto ninguém conectou a instância.
  // Quem sinaliza isso para quem usa é a tela de Configurações.
  if (!integracao?.instancia_url || !segredo?.api_key) {
    return NextResponse.json({
      em: new Date().toISOString(),
      configurado: false,
      motivo: "Integração n8n da plataforma não configurada.",
    });
  }

  const descoberta = await descobrirWorkflows(
    supabase,
    integracao.instancia_url,
    segredo.api_key,
  );

  // Consulta depois da descoberta, para as automações recém-criadas já
  // sincronizarem nesta mesma rodada em vez de esperar a próxima.
  const { data: automacoes, error } = await supabase
    .from("automacoes")
    .select("id, empresa_id, nome, config, sincronizado_ate")
    .eq("tipo", "n8n")
    .contains("config", { modoDisparo: "monitorado" });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const monitoradas = (automacoes ?? []) as unknown as LinhaMonitorada[];

  const resultados = [];
  for (const automacao of monitoradas) {
    resultados.push(await sincronizar(automacao, integracao.instancia_url, segredo.api_key));
  }

  return NextResponse.json({
    em: new Date().toISOString(),
    configurado: true,
    descoberta,
    monitoradas: monitoradas.length,
    resultados,
  });
}

async function sincronizar(automacao: LinhaMonitorada, instanciaUrl: string, apiKey: string) {
  const supabase = clienteAdmin();
  const workflowId = automacao.config?.workflowId;

  if (!workflowId) {
    return { automacao: automacao.nome, erro: "Sem workflowId configurado." };
  }

  let execucoes;
  try {
    execucoes = await buscarExecucoes(
      instanciaUrl,
      apiKey,
      workflowId,
      automacao.sincronizado_ate ? new Date(automacao.sincronizado_ate) : null,
    );
  } catch (erro) {
    return {
      automacao: automacao.nome,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }

  if (execucoes.length === 0) {
    return { automacao: automacao.nome, novas: 0 };
  }

  // `upsert` com o índice único (automacao_id, externo_id) torna a operação
  // idempotente: rodar de novo não duplica nem perde nada.
  const { error: erroInsercao } = await supabase.from("execucoes").upsert(
    execucoes.map((e) => ({
      automacao_id: automacao.id,
      empresa_id: automacao.empresa_id,
      externo_id: e.externoId,
      resultado: e.resultado,
      origem: e.origem,
      iniciada_em: e.iniciadaEm,
      finalizada_em: e.finalizadaEm,
      duracao_ms: e.duracaoMs,
    })),
    { onConflict: "automacao_id,externo_id" },
  );

  if (erroInsercao) {
    return { automacao: automacao.nome, erro: erroInsercao.message };
  }

  // Avança o marco apenas até a execução mais recente já concluída: uma que
  // ainda está rodando precisa ser revisitada para registrar o desfecho.
  const concluidas = execucoes.filter((e) => e.resultado !== "em_andamento");
  const marco = concluidas
    .map((e) => e.iniciadaEm)
    .sort()
    .at(-1);

  if (marco) {
    await supabase
      .from("automacoes")
      .update({ sincronizado_ate: marco })
      .eq("id", automacao.id);
  }

  return { automacao: automacao.nome, novas: execucoes.length };
}
