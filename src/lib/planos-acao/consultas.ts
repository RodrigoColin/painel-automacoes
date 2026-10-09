/**
 * Leituras do quadro de planos de ação. Passam pela sessão, com o RLS valendo
 * — menos `responsaveisPossiveis`, que precisa enxergar a equipe da Proos.
 */

import { and, asc, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  empresas,
  membros,
  perfis,
  planosCards,
  planosConfig,
  planosEventos,
  planosTarefas,
} from "@/lib/db/schema";
import { naSessao } from "@/lib/dal";
import { CONFIG_PADRAO, ETAPA_FINAL, type Etapa } from "@/lib/planos-acao/etapas";
import type {
  Card,
  ConfigPlanos,
  DetalheCard,
  Evento,
  Responsavel,
  TarefaComCard,
} from "@/lib/planos-acao/tipos";

/** Concluídos mais antigos que isto saem do quadro (continuam no banco). */
const DIAS_CONCLUIDOS_VISIVEIS = 30;

/** Cards abertos e os concluídos recentes, com o progresso das tarefas. */
export async function listarCards(empresaId: string): Promise<Card[]> {
  const corte = new Date(Date.now() - DIAS_CONCLUIDOS_VISIVEIS * 86_400_000).toISOString();

  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: planosCards.id,
        titulo: planosCards.titulo,
        descricao: planosCards.descricao,
        etapa: planosCards.etapa,
        origem: planosCards.origem,
        clienteNome: planosCards.cliente_nome,
        dados: planosCards.dados,
        responsavelId: planosCards.responsavel_id,
        prazo: planosCards.prazo,
        regularizadoEm: planosCards.regularizado_em,
        concluidoEm: planosCards.concluido_em,
        criadoEm: planosCards.criado_em,
        tarefas: sql<number>`(select count(*)::int from public.planos_tarefas t where t.card_id = ${planosCards.id})`,
        tarefasConcluidas: sql<number>`(select count(*)::int from public.planos_tarefas t where t.card_id = ${planosCards.id} and t.concluida_em is not null)`,
      })
      .from(planosCards)
      .where(
        and(
          eq(planosCards.empresa_id, empresaId),
          or(ne(planosCards.etapa, ETAPA_FINAL), gte(planosCards.concluido_em, corte)),
        ),
      )
      .orderBy(desc(planosCards.criado_em)),
  );

  return linhas.map((linha) => ({
    ...linha,
    etapa: linha.etapa as Etapa,
    origem: linha.origem as Card["origem"],
    dados: linha.dados as Card["dados"],
  }));
}

/** Tarefas ainda abertas da empresa, para a visão de lista. */
export async function listarTarefasAbertas(empresaId: string): Promise<TarefaComCard[]> {
  return naSessao((tx) =>
    tx
      .select({
        id: planosTarefas.id,
        cardId: planosTarefas.card_id,
        titulo: planosTarefas.titulo,
        responsavelId: planosTarefas.responsavel_id,
        prazo: planosTarefas.prazo,
        concluidaEm: planosTarefas.concluida_em,
        cardTitulo: planosCards.titulo,
      })
      .from(planosTarefas)
      .innerJoin(planosCards, eq(planosCards.id, planosTarefas.card_id))
      .where(and(eq(planosTarefas.empresa_id, empresaId), isNull(planosTarefas.concluida_em)))
      // Sem prazo vai para o fim: é o padrão do `asc` no Postgres.
      .orderBy(asc(planosTarefas.prazo), asc(planosTarefas.criado_em)),
  );
}

/** Tarefas e linha do tempo de um card. O RLS barra card de outra empresa. */
export async function detalheDoCard(cardId: string): Promise<DetalheCard> {
  return naSessao(async (tx) => {
    const tarefas = await tx
      .select({
        id: planosTarefas.id,
        cardId: planosTarefas.card_id,
        titulo: planosTarefas.titulo,
        responsavelId: planosTarefas.responsavel_id,
        prazo: planosTarefas.prazo,
        concluidaEm: planosTarefas.concluida_em,
      })
      .from(planosTarefas)
      .where(eq(planosTarefas.card_id, cardId))
      .orderBy(asc(planosTarefas.criado_em));

    // LEFT JOIN: o autor pode ser o sistema (nulo) ou alguém da Proos, cujo
    // perfil o RLS não mostra a quem é do cliente.
    const eventos = await tx
      .select({
        id: planosEventos.id,
        tipo: planosEventos.tipo,
        autorId: planosEventos.autor_id,
        autorNome: perfis.nome,
        autorEmail: perfis.email,
        texto: planosEventos.texto,
        criadoEm: planosEventos.criado_em,
      })
      .from(planosEventos)
      .leftJoin(perfis, eq(perfis.id, planosEventos.autor_id))
      .where(eq(planosEventos.card_id, cardId))
      .orderBy(desc(planosEventos.criado_em));

    return {
      tarefas,
      eventos: eventos.map((evento) => ({
        id: evento.id,
        tipo: evento.tipo as Evento["tipo"],
        autor: evento.autorId ? evento.autorNome || evento.autorEmail || "Equipe Proos" : null,
        texto: evento.texto,
        criadoEm: evento.criadoEm,
      })),
    };
  });
}

/**
 * Quem pode ser responsável por um card ou tarefa: as pessoas ativas da
 * empresa e os admins da plataforma, que trabalham nos clientes sem serem
 * membros deles. Pela conexão do app porque o RLS esconderia a equipe da
 * Proos de quem é do cliente — só devolve id e nome, e quem chama já passou
 * por `empresaAtual`.
 */
export async function responsaveisPossiveis(empresaId: string): Promise<Responsavel[]> {
  const linhas = await db
    .selectDistinct({ id: perfis.id, nome: perfis.nome, email: perfis.email })
    .from(membros)
    .innerJoin(perfis, eq(perfis.id, membros.user_id))
    .innerJoin(empresas, eq(empresas.id, membros.empresa_id))
    .where(
      and(
        eq(membros.status, "ativo"),
        or(
          eq(membros.empresa_id, empresaId),
          and(eq(empresas.eh_plataforma, true), eq(membros.papel, "admin")),
        ),
      ),
    );

  return linhas
    .map((linha) => ({ id: linha.id, nome: linha.nome || linha.email }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function configPlanos(empresaId: string): Promise<ConfigPlanos> {
  const [linha] = await naSessao((tx) =>
    tx
      .select({
        autoInadimplencia: planosConfig.auto_inadimplencia,
        atrasoMinimoDias: planosConfig.atraso_minimo_dias,
        valorMinimo: planosConfig.valor_minimo,
      })
      .from(planosConfig)
      .where(eq(planosConfig.empresa_id, empresaId))
      .limit(1),
  );
  return linha ?? CONFIG_PADRAO;
}
