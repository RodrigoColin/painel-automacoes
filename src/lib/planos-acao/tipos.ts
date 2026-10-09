import type { Etapa } from "@/lib/planos-acao/etapas";

/** Retrato do vencido gravado no card a cada sincronização. */
export type DadosInadimplencia = {
  /** Vencido em aberto com vencimento no ano corrente. */
  valor: number;
  titulos: number;
  /** Maior atraso, em dias. */
  dias: number;
  /** Vencimento mais antigo (`aaaa-mm-dd`). */
  antigo: string;
  /** Vencido somando anos anteriores. */
  vencidoTotal: number;
  /** Data de referência do pacote (`aaaa-mm-dd`). */
  ref: string;
};

export type Card = {
  id: string;
  titulo: string;
  descricao: string;
  etapa: Etapa;
  origem: "inadimplencia" | "manual";
  clienteNome: string | null;
  dados: Partial<DadosInadimplencia>;
  responsavelId: string | null;
  prazo: string | null;
  regularizadoEm: string | null;
  concluidoEm: string | null;
  criadoEm: string;
  tarefas: number;
  tarefasConcluidas: number;
};

export type Tarefa = {
  id: string;
  cardId: string;
  titulo: string;
  responsavelId: string | null;
  prazo: string | null;
  concluidaEm: string | null;
};

/** Tarefa na visão de lista, com o card de onde veio. */
export type TarefaComCard = Tarefa & { cardTitulo: string };

export type Evento = {
  id: string;
  tipo: "criado" | "comentario" | "etapa" | "regularizado" | "tarefa";
  autor: string | null;
  texto: string;
  criadoEm: string;
};

export type DetalheCard = { tarefas: Tarefa[]; eventos: Evento[] };

export type Responsavel = { id: string; nome: string };

export type ConfigPlanos = { autoInadimplencia: boolean; atrasoMinimoDias: number; valorMinimo: number };
