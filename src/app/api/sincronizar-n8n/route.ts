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
 * Roda pela conexão do app, fora do RLS, porque atravessa todas as empresas,
 * sem sessão.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { automacoes, execucoes } from "@/lib/db/schema";
import { buscarExecucoes } from "@/lib/executores/n8n-sincronizacao";
import { descobrirWorkflows, lerConexaoN8n } from "@/lib/n8n-descoberta";

export const dynamic = "force-dynamic";

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

  // A conexão com o n8n é única, compartilhada por todas as empresas — só o
  // workflowId de cada automação muda.
  const conexao = await lerConexaoN8n();

  // Falta de conexão é estado de configuração, não falha: responde 200 para
  // não encher o log do cron de erro enquanto ninguém conectou a instância.
  // Quem sinaliza isso para quem usa é a tela de Configurações.
  if (!conexao.url || !conexao.apiKey) {
    return NextResponse.json({
      em: new Date().toISOString(),
      configurado: false,
      motivo: "Integração n8n da plataforma não configurada.",
    });
  }

  const descoberta = await descobrirWorkflows(db, conexao.url, conexao.apiKey);

  // Consulta depois da descoberta, para as automações recém-criadas já
  // sincronizarem nesta mesma rodada em vez de esperar a próxima.
  let monitoradas: LinhaMonitorada[];
  try {
    monitoradas = (await db
      .select({
        id: automacoes.id,
        empresa_id: automacoes.empresa_id,
        nome: automacoes.nome,
        config: automacoes.config,
        sincronizado_ate: automacoes.sincronizado_ate,
      })
      .from(automacoes)
      .where(
        and(
          eq(automacoes.tipo, "n8n"),
          sql`${automacoes.config} @> ${JSON.stringify({ modoDisparo: "monitorado" })}::jsonb`,
        ),
      )) as LinhaMonitorada[];
  } catch (erro) {
    return NextResponse.json(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 500 },
    );
  }

  const resultados = [];
  for (const automacao of monitoradas) {
    resultados.push(await sincronizar(automacao, conexao.url, conexao.apiKey));
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
  const workflowId = automacao.config?.workflowId;

  if (!workflowId) {
    return { automacao: automacao.nome, erro: "Sem workflowId configurado." };
  }

  let encontradas;
  try {
    encontradas = await buscarExecucoes(
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

  if (encontradas.length === 0) {
    return { automacao: automacao.nome, novas: 0 };
  }

  // Upsert com o índice único (automacao_id, externo_id) torna a operação
  // idempotente: rodar de novo não duplica nem perde nada.
  try {
    await db
      .insert(execucoes)
      .values(
        encontradas.map((e) => ({
          automacao_id: automacao.id,
          empresa_id: automacao.empresa_id,
          externo_id: e.externoId,
          resultado: e.resultado,
          origem: e.origem,
          iniciada_em: e.iniciadaEm,
          finalizada_em: e.finalizadaEm,
          duracao_ms: e.duracaoMs,
        })),
      )
      .onConflictDoUpdate({
        target: [execucoes.automacao_id, execucoes.externo_id],
        set: {
          empresa_id: sql.raw("excluded.empresa_id"),
          resultado: sql.raw("excluded.resultado"),
          origem: sql.raw("excluded.origem"),
          iniciada_em: sql.raw("excluded.iniciada_em"),
          finalizada_em: sql.raw("excluded.finalizada_em"),
          duracao_ms: sql.raw("excluded.duracao_ms"),
        },
      });
  } catch (erro) {
    return { automacao: automacao.nome, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  // Avança o marco apenas até a execução mais recente já concluída: uma que
  // ainda está rodando precisa ser revisitada para registrar o desfecho.
  const concluidas = encontradas.filter((e) => e.resultado !== "em_andamento");
  const marco = concluidas
    .map((e) => e.iniciadaEm)
    .sort()
    .at(-1);

  if (marco) {
    await db
      .update(automacoes)
      .set({ sincronizado_ate: marco })
      .where(eq(automacoes.id, automacao.id));
  }

  return { automacao: automacao.nome, novas: encontradas.length };
}
