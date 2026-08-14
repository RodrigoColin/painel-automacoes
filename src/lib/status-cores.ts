/**
 * De estado de domínio para cor do rótulo.
 *
 * Só existem três cores semânticas — verde (sucesso), amarelo (atenção) e
 * vermelho (erro). Estados que não significam nenhuma das três ficam na
 * escala neutra, para que a cor continue querendo dizer alguma coisa.
 */

import type { ToneBadge } from "@/components/ui";
import type {
  NivelLog,
  ResultadoExecucao,
  StatusAutomacao,
  Usuario,
} from "@/lib/data";

export const toneResultado: Record<ResultadoExecucao, ToneBadge> = {
  sucesso: "success",
  erro: "danger",
  em_andamento: "outline",
};

export const toneNivelLog: Record<NivelLog, ToneBadge> = {
  info: "outline",
  aviso: "warning",
  erro: "danger",
};

export const toneStatusAutomacao: Record<StatusAutomacao, ToneBadge> = {
  ativa: "success",
  pausada: "warning",
  rascunho: "outline",
};

export const toneStatusUsuario: Record<Usuario["status"], ToneBadge> = {
  ativo: "success",
  convidado: "warning",
  inativo: "outline",
};

/** Dentro de um badge colorido o ponto acompanha a cor do texto. */
export function nivelDot(tone: ToneBadge) {
  return tone === "success" || tone === "warning" || tone === "danger"
    ? ("current" as const)
    : ("off" as const);
}
