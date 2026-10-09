/**
 * Etapas do quadro de planos de ação. Fixas nesta versão: a mesma lista está
 * no check de `planos_cards.etapa` (db/migrations/0011_planos_acao.sql) —
 * mudou aqui, mude lá.
 */

export const ETAPAS = [
  { chave: "a_tratar", rotulo: "A tratar" },
  { chave: "em_contato", rotulo: "Em contato" },
  { chave: "em_negociacao", rotulo: "Em negociação" },
  { chave: "acordo_firmado", rotulo: "Acordo firmado" },
  { chave: "concluido", rotulo: "Concluído" },
] as const;

export type Etapa = (typeof ETAPAS)[number]["chave"];

export const ETAPA_INICIAL: Etapa = "a_tratar";
export const ETAPA_FINAL: Etapa = "concluido";

export function ehEtapa(valor: string): valor is Etapa {
  return ETAPAS.some((etapa) => etapa.chave === valor);
}

export function rotuloEtapa(chave: string) {
  return ETAPAS.find((etapa) => etapa.chave === chave)?.rotulo ?? chave;
}

/** Padrões da criação automática quando a empresa não tem `planos_config`. */
export const CONFIG_PADRAO = { autoInadimplencia: true, atrasoMinimoDias: 7, valorMinimo: 0 };
