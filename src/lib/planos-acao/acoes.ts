"use server";

/**
 * Escritas do quadro de planos de ação.
 *
 * Não há policy de escrita nas tabelas `planos_*`: tudo passa pela conexão do
 * app, então a checagem de `autorizar` (permissão de escrita na empresa) e o
 * filtro por `empresa_id` em cada comando são o que vale.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { codigoErro, db } from "@/lib/db";
import { planosCards, planosConfig, planosEventos, planosTarefas } from "@/lib/db/schema";
import { empresasDoUsuario, exigirPermissaoDeEscrita, verificarSessao } from "@/lib/dal";
import { detalheDoCard, responsaveisPossiveis } from "@/lib/planos-acao/consultas";
import { ETAPA_FINAL, ETAPA_INICIAL, ehEtapa, rotuloEtapa } from "@/lib/planos-acao/etapas";
import type { DetalheCard } from "@/lib/planos-acao/tipos";

type Resultado = { erro?: string };

const TITULO_MAXIMO = 200;
const TEXTO_MAXIMO = 4000;
/** O plano de ação é HTML do editor: as tags contam, então o teto é maior. */
const PLANO_MAXIMO = 30000;

/** Quem chamou pode escrever nesta empresa? Devolve o id da pessoa. */
async function autorizar(empresaId: string): Promise<{ erro: string } | { userId: string }> {
  const { userId } = await verificarSessao();
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  }
  return { userId };
}

const ehData = (valor: string) => /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor));

/** Normaliza prazo e responsável vindos do formulário (`""` = sem). */
async function validarAtribuicao(
  empresaId: string,
  dados: { responsavelId?: string | null; prazo?: string | null },
): Promise<{ erro: string } | { responsavelId: string | null; prazo: string | null }> {
  const prazo = dados.prazo || null;
  if (prazo && !ehData(prazo)) return { erro: "Prazo inválido." };

  const responsavelId = dados.responsavelId || null;
  if (responsavelId && !(await responsaveisPossiveis(empresaId)).some((r) => r.id === responsavelId)) {
    return { erro: "Responsável não pertence a esta empresa." };
  }
  return { responsavelId, prazo };
}

/**
 * Recusa em vez de cortar: truncar HTML no meio deixaria tag aberta. O
 * conteúdo não é higienizado aqui — só é exibido pelo `EditorRico`, que relê
 * o HTML pelo próprio esquema e descarta o que não conhece.
 */
function validarPlano(bruto: string | undefined): { erro: string } | { descricao: string } {
  const descricao = (bruto ?? "").trim();
  if (descricao.length > PLANO_MAXIMO) return { erro: "O plano de ação está longo demais." };
  return { descricao };
}

function validarTitulo(bruto: string): { erro: string } | { titulo: string } {
  const titulo = (bruto ?? "").trim();
  if (!titulo) return { erro: "Informe um título." };
  if (titulo.length > TITULO_MAXIMO) return { erro: `O título passa de ${TITULO_MAXIMO} caracteres.` };
  return { titulo };
}

/* ---------------------------------- Cards --------------------------------- */

export async function criarCard(dados: {
  empresaId: string;
  titulo: string;
  descricao?: string;
  responsavelId?: string | null;
  prazo?: string | null;
}): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  const titulo = validarTitulo(dados.titulo);
  if ("erro" in titulo) return titulo;
  const atribuicao = await validarAtribuicao(dados.empresaId, dados);
  if ("erro" in atribuicao) return atribuicao;
  const plano = validarPlano(dados.descricao);
  if ("erro" in plano) return plano;

  await db.transaction(async (tx) => {
    const [card] = await tx
      .insert(planosCards)
      .values({
        empresa_id: dados.empresaId,
        titulo: titulo.titulo,
        descricao: plano.descricao,
        etapa: ETAPA_INICIAL,
        origem: "manual",
        responsavel_id: atribuicao.responsavelId,
        prazo: atribuicao.prazo,
        criado_por: acesso.userId,
      })
      .returning({ id: planosCards.id });
    await tx.insert(planosEventos).values({
      card_id: card.id,
      empresa_id: dados.empresaId,
      tipo: "criado",
      autor_id: acesso.userId,
      texto: "Card criado.",
    });
  });

  revalidatePath("/planos-acao");
  return {};
}

export async function moverCard(dados: { empresaId: string; cardId: string; etapa: string }): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  if (!ehEtapa(dados.etapa)) return { erro: "Etapa desconhecida." };
  const destino = dados.etapa;

  try {
    const mudou = await db.transaction(async (tx) => {
      const [card] = await tx
        .select({ etapa: planosCards.etapa })
        .from(planosCards)
        .where(and(eq(planosCards.id, dados.cardId), eq(planosCards.empresa_id, dados.empresaId)))
        .limit(1);
      if (!card) return null;
      if (card.etapa === destino) return false;

      const agora = new Date().toISOString();
      await tx
        .update(planosCards)
        .set({ etapa: destino, concluido_em: destino === ETAPA_FINAL ? agora : null, atualizado_em: agora })
        .where(eq(planosCards.id, dados.cardId));
      await tx.insert(planosEventos).values({
        card_id: dados.cardId,
        empresa_id: dados.empresaId,
        tipo: "etapa",
        autor_id: acesso.userId,
        texto: `Movido de "${rotuloEtapa(card.etapa)}" para "${rotuloEtapa(destino)}".`,
      });
      return true;
    });
    if (mudou === null) return { erro: "Card não encontrado." };
  } catch (erro) {
    // Reabrir um card de inadimplência quando o cliente já tem outro aberto.
    if (codigoErro(erro) === "23505") return { erro: "Este cliente já tem outro card aberto." };
    return { erro: "Não foi possível mover o card." };
  }

  revalidatePath("/planos-acao");
  return {};
}

export async function editarCard(dados: {
  empresaId: string;
  cardId: string;
  titulo: string;
  descricao: string;
  responsavelId: string | null;
  prazo: string | null;
}): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  const titulo = validarTitulo(dados.titulo);
  if ("erro" in titulo) return titulo;
  const atribuicao = await validarAtribuicao(dados.empresaId, dados);
  if ("erro" in atribuicao) return atribuicao;
  const plano = validarPlano(dados.descricao);
  if ("erro" in plano) return plano;

  const alterados = await db
    .update(planosCards)
    .set({
      titulo: titulo.titulo,
      descricao: plano.descricao,
      responsavel_id: atribuicao.responsavelId,
      prazo: atribuicao.prazo,
      atualizado_em: new Date().toISOString(),
    })
    .where(and(eq(planosCards.id, dados.cardId), eq(planosCards.empresa_id, dados.empresaId)))
    .returning({ id: planosCards.id });
  if (alterados.length === 0) return { erro: "Card não encontrado." };

  revalidatePath("/planos-acao");
  return {};
}

/**
 * Troca só responsável e/ou prazo, direto pelas pílulas do card no quadro.
 * Campo ausente não é tocado; `null` ou `""` limpa.
 */
export async function atribuirCard(dados: {
  empresaId: string;
  cardId: string;
  responsavelId?: string | null;
  prazo?: string | null;
}): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  const atribuicao = await validarAtribuicao(dados.empresaId, dados);
  if ("erro" in atribuicao) return atribuicao;

  const alterados = await db
    .update(planosCards)
    .set({
      ...("responsavelId" in dados ? { responsavel_id: atribuicao.responsavelId } : {}),
      ...("prazo" in dados ? { prazo: atribuicao.prazo } : {}),
      atualizado_em: new Date().toISOString(),
    })
    .where(and(eq(planosCards.id, dados.cardId), eq(planosCards.empresa_id, dados.empresaId)))
    .returning({ id: planosCards.id });
  if (alterados.length === 0) return { erro: "Card não encontrado." };

  revalidatePath("/planos-acao");
  return {};
}

/**
 * Só card manual: o de inadimplência nasce da sincronização e voltaria na
 * rodada seguinte — o caminho para ele é mover para "Concluído".
 */
export async function excluirCard(dados: { empresaId: string; cardId: string }): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;

  const apagados = await db
    .delete(planosCards)
    .where(
      and(
        eq(planosCards.id, dados.cardId),
        eq(planosCards.empresa_id, dados.empresaId),
        eq(planosCards.origem, "manual"),
      ),
    )
    .returning({ id: planosCards.id });
  if (apagados.length === 0) return { erro: "Só cards criados manualmente podem ser excluídos." };

  revalidatePath("/planos-acao");
  return {};
}

export async function comentar(dados: { empresaId: string; cardId: string; texto: string }): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  const texto = (dados.texto ?? "").trim();
  if (!texto) return { erro: "Escreva o comentário." };
  if (texto.length > TEXTO_MAXIMO) return { erro: `O comentário passa de ${TEXTO_MAXIMO} caracteres.` };
  if (!(await cardDaEmpresa(dados.empresaId, dados.cardId))) return { erro: "Card não encontrado." };

  await db.insert(planosEventos).values({
    card_id: dados.cardId,
    empresa_id: dados.empresaId,
    tipo: "comentario",
    autor_id: acesso.userId,
    texto,
  });
  return {};
}

/** Tarefas e linha do tempo, para o modal. Leitura pela sessão (RLS). */
export async function carregarCard(cardId: string): Promise<DetalheCard> {
  await verificarSessao();
  return detalheDoCard(cardId);
}

async function cardDaEmpresa(empresaId: string, cardId: string) {
  const [card] = await db
    .select({ id: planosCards.id })
    .from(planosCards)
    .where(and(eq(planosCards.id, cardId), eq(planosCards.empresa_id, empresaId)))
    .limit(1);
  return Boolean(card);
}

/* --------------------------------- Tarefas -------------------------------- */

export async function criarTarefa(dados: {
  empresaId: string;
  cardId: string;
  titulo: string;
  responsavelId?: string | null;
  prazo?: string | null;
}): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  const titulo = validarTitulo(dados.titulo);
  if ("erro" in titulo) return titulo;
  const atribuicao = await validarAtribuicao(dados.empresaId, dados);
  if ("erro" in atribuicao) return atribuicao;
  if (!(await cardDaEmpresa(dados.empresaId, dados.cardId))) return { erro: "Card não encontrado." };

  await db.insert(planosTarefas).values({
    card_id: dados.cardId,
    empresa_id: dados.empresaId,
    titulo: titulo.titulo,
    responsavel_id: atribuicao.responsavelId,
    prazo: atribuicao.prazo,
  });

  revalidatePath("/planos-acao");
  return {};
}

export async function atualizarTarefa(dados: {
  empresaId: string;
  tarefaId: string;
  responsavelId: string | null;
  prazo: string | null;
}): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;
  const atribuicao = await validarAtribuicao(dados.empresaId, dados);
  if ("erro" in atribuicao) return atribuicao;

  const alteradas = await db
    .update(planosTarefas)
    .set({ responsavel_id: atribuicao.responsavelId, prazo: atribuicao.prazo })
    .where(and(eq(planosTarefas.id, dados.tarefaId), eq(planosTarefas.empresa_id, dados.empresaId)))
    .returning({ id: planosTarefas.id });
  if (alteradas.length === 0) return { erro: "Tarefa não encontrada." };

  revalidatePath("/planos-acao");
  return {};
}

export async function alternarTarefa(dados: {
  empresaId: string;
  tarefaId: string;
  concluida: boolean;
}): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;

  const [tarefa] = await db
    .update(planosTarefas)
    .set({
      concluida_em: dados.concluida ? new Date().toISOString() : null,
      concluida_por: dados.concluida ? acesso.userId : null,
    })
    .where(and(eq(planosTarefas.id, dados.tarefaId), eq(planosTarefas.empresa_id, dados.empresaId)))
    .returning({ cardId: planosTarefas.card_id, titulo: planosTarefas.titulo });
  if (!tarefa) return { erro: "Tarefa não encontrada." };

  await db.insert(planosEventos).values({
    card_id: tarefa.cardId,
    empresa_id: dados.empresaId,
    tipo: "tarefa",
    autor_id: acesso.userId,
    texto: `${dados.concluida ? "Concluiu" : "Reabriu"} a tarefa "${tarefa.titulo}".`,
  });

  revalidatePath("/planos-acao");
  return {};
}

export async function excluirTarefa(dados: { empresaId: string; tarefaId: string }): Promise<Resultado> {
  const acesso = await autorizar(dados.empresaId);
  if ("erro" in acesso) return acesso;

  await db
    .delete(planosTarefas)
    .where(and(eq(planosTarefas.id, dados.tarefaId), eq(planosTarefas.empresa_id, dados.empresaId)));

  revalidatePath("/planos-acao");
  return {};
}

/* ------------------------------- Configuração ----------------------------- */

/**
 * Limites da criação automática. Só quem administra a empresa. Zera a marca
 * de sincronização para os limites novos valerem já na próxima passada, sem
 * esperar pacote novo do fluxo de caixa.
 */
export async function salvarConfigPlanos(dados: {
  empresaId: string;
  autoInadimplencia: boolean;
  atrasoMinimoDias: number;
  valorMinimo: number;
}): Promise<Resultado> {
  await verificarSessao();
  const empresa = (await empresasDoUsuario()).find((item) => item.id === dados.empresaId);
  if (!empresa || empresa.papel !== "admin") {
    return { erro: "Só administradores da empresa configuram os planos de ação." };
  }

  const dias = Number(dados.atrasoMinimoDias);
  const valor = Number(dados.valorMinimo);
  if (!Number.isInteger(dias) || dias < 0 || dias > 3650) return { erro: "Atraso mínimo inválido." };
  if (!Number.isFinite(valor) || valor < 0) return { erro: "Valor mínimo inválido." };

  const valores = {
    auto_inadimplencia: Boolean(dados.autoInadimplencia),
    atraso_minimo_dias: dias,
    valor_minimo: valor,
    sincronizado_pacote_em: null,
    atualizado_em: new Date().toISOString(),
  };
  await db
    .insert(planosConfig)
    .values({ empresa_id: empresa.id, ...valores })
    .onConflictDoUpdate({ target: planosConfig.empresa_id, set: valores });

  revalidatePath("/planos-acao");
  revalidatePath("/configuracoes");
  return {};
}
