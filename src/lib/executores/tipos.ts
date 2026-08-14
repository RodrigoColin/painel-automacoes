/**
 * Contrato comum dos executores.
 *
 * O dispatcher não sabe como cada motor roda — só pede a execução e registra
 * o que voltou. Isso mantém o agendamento independente do meio de execução.
 */

export type ResultadoExecucao = {
  sucesso: boolean;
  /** Linhas de log a gravar, na ordem em que aconteceram. */
  logs: { nivel: "info" | "aviso" | "erro"; mensagem: string }[];
};

/** Trunca saída longa: o log vai para o Postgres, não é lugar de despejo. */
export function truncar(texto: string, limite = 2000) {
  const limpo = texto.trim();
  return limpo.length > limite
    ? `${limpo.slice(0, limite)}… (${limpo.length - limite} caracteres omitidos)`
    : limpo;
}
