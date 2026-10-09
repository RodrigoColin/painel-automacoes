/**
 * Transforma inadimplentes em cards do quadro de planos de ação.
 *
 * Lê o pacote mais recente do fluxo de caixa (`caixa_pacote_diario`, gravado
 * pelo container `caixa` às 10h e às 16h) e compara `extra.inad.top` com os
 * cards da empresa:
 *
 * - cliente acima dos limites de `planos_config`, sem card aberto → card novo
 *   em "A tratar";
 * - cliente com card aberto → atualiza o retrato do vencido;
 * - cliente que saiu da lista → card marcado como regularizado e, se estava
 *   aberto, movido para "Concluído".
 *
 * O pacote identifica o cliente pela razão social, não pelo código do Omie, e
 * `inad.top` só cobre vencimentos do ano corrente — quem só deve títulos de
 * anos anteriores não vira card.
 *
 * Roda pela conexão do app: é chamada pelo cron, sem sessão, e ao abrir a
 * tela. A marca `sincronizado_pacote_em` faz as chamadas repetidas saírem
 * cedo enquanto não chega pacote novo.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { caixaPacoteDiario, planosCards, planosConfig, planosEventos } from "@/lib/db/schema";
import type { Extra } from "@/lib/fluxo-caixa/tipos";
import { CONFIG_PADRAO, ETAPA_FINAL, ETAPA_INICIAL } from "@/lib/planos-acao/etapas";
import type { DadosInadimplencia } from "@/lib/planos-acao/tipos";

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type ResultadoSincronizacao = { criados: number; regularizados: number };

/** `null` quando não havia nada a fazer (sem pacote novo, ou automação desligada). */
export async function sincronizarInadimplencia(empresaId: string): Promise<ResultadoSincronizacao | null> {
  const [[config], [pacote]] = await Promise.all([
    db.select().from(planosConfig).where(eq(planosConfig.empresa_id, empresaId)).limit(1),
    db
      .select({ atualizado_em: caixaPacoteDiario.atualizado_em, extra: caixaPacoteDiario.extra })
      .from(caixaPacoteDiario)
      .where(eq(caixaPacoteDiario.empresa_id, empresaId))
      .orderBy(desc(caixaPacoteDiario.data))
      .limit(1),
  ]);

  const inad = (pacote?.extra as Extra | null | undefined)?.inad;
  if (!pacote || !inad) return null;
  if (config && !config.auto_inadimplencia) return null;
  if (config?.sincronizado_pacote_em && config.sincronizado_pacote_em >= pacote.atualizado_em) return null;

  const atrasoMinimo = config?.atraso_minimo_dias ?? CONFIG_PADRAO.atrasoMinimoDias;
  const valorMinimo = config?.valor_minimo ?? CONFIG_PADRAO.valorMinimo;
  const naLista = new Set(inad.top.map((item) => item.cliente));
  const elegiveis = inad.top.filter((item) => item.dias >= atrasoMinimo && item.valor >= valorMinimo);

  return db.transaction(async (tx) => {
    const cards = await tx
      .select({
        id: planosCards.id,
        cliente: planosCards.cliente_nome,
        etapa: planosCards.etapa,
        regularizado_em: planosCards.regularizado_em,
      })
      .from(planosCards)
      .where(and(eq(planosCards.empresa_id, empresaId), eq(planosCards.origem, "inadimplencia")));

    const abertos = new Map<string, string>();
    // Concluído à mão com o cliente ainda devendo: não se abre outro por cima.
    const fechadosAMao = new Set<string>();
    for (const card of cards) {
      if (!card.cliente) continue;
      if (card.etapa !== ETAPA_FINAL) abertos.set(card.cliente, card.id);
      else if (!card.regularizado_em) fechadosAMao.add(card.cliente);
    }

    let criados = 0;
    for (const item of elegiveis) {
      const dados: DadosInadimplencia = {
        valor: item.valor,
        titulos: item.n,
        dias: item.dias,
        antigo: item.antigo,
        vencidoTotal: item.vencidoTotal,
        ref: inad.ref,
      };

      const aberto = abertos.get(item.cliente);
      if (aberto) {
        await tx.update(planosCards).set({ dados }).where(eq(planosCards.id, aberto));
        continue;
      }
      if (fechadosAMao.has(item.cliente)) continue;

      // `onConflictDoNothing`: cron e tela podem sincronizar ao mesmo tempo, e
      // o índice único de card aberto por cliente segura o segundo.
      const [novo] = await tx
        .insert(planosCards)
        .values({
          empresa_id: empresaId,
          titulo: item.cliente,
          etapa: ETAPA_INICIAL,
          origem: "inadimplencia",
          cliente_nome: item.cliente,
          dados,
        })
        .onConflictDoNothing()
        .returning({ id: planosCards.id });
      if (!novo) continue;

      await tx.insert(planosEventos).values({
        card_id: novo.id,
        empresa_id: empresaId,
        tipo: "criado",
        texto: `Criado automaticamente: ${reais.format(item.valor)} vencidos em ${item.n} título(s), maior atraso de ${item.dias} dias.`,
      });
      criados += 1;
    }

    const agora = new Date().toISOString();
    const saiu = cards.filter((card) => card.cliente && !card.regularizado_em && !naLista.has(card.cliente));
    const saiuAberto = saiu.filter((card) => card.etapa !== ETAPA_FINAL);

    if (saiu.length > 0) {
      await tx
        .update(planosCards)
        .set({ regularizado_em: agora })
        .where(inArray(planosCards.id, saiu.map((card) => card.id)));
    }
    if (saiuAberto.length > 0) {
      await tx
        .update(planosCards)
        .set({ etapa: ETAPA_FINAL, concluido_em: agora, atualizado_em: agora })
        .where(inArray(planosCards.id, saiuAberto.map((card) => card.id)));
      await tx.insert(planosEventos).values(
        saiuAberto.map((card) => ({
          card_id: card.id,
          empresa_id: empresaId,
          tipo: "regularizado",
          texto: "O cliente saiu da lista de inadimplentes. Card concluído automaticamente.",
        })),
      );
    }

    await tx
      .insert(planosConfig)
      .values({ empresa_id: empresaId, sincronizado_pacote_em: pacote.atualizado_em })
      .onConflictDoUpdate({
        target: planosConfig.empresa_id,
        set: { sincronizado_pacote_em: pacote.atualizado_em },
      });

    return { criados, regularizados: saiuAberto.length };
  });
}
