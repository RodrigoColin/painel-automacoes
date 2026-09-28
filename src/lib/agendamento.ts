/**
 * Cálculo de quando cada automação roda.
 *
 * Não há um cron por automação: um único job de um minuto (container `cron`
 * da VPS) chama o dispatcher,
 * e é este módulo que decide o que está vencido — a agenda vive no banco,
 * na coluna `proxima_execucao`.
 */

import { CronExpressionParser } from "cron-parser";
import type { ConfigAutomacao } from "@/lib/automacao-tipos";

/**
 * Fuso das expressões cron. Sem isto o cálculo sairia em UTC e "todo dia às
 * 8h" viraria 5h da manhã no Brasil.
 */
const FUSO = "America/Sao_Paulo";

/** Expressão cron da automação, ou `null` quando ela não é agendada. */
function cronDe(entrada: ConfigAutomacao): string | null {
  if (entrada.tipo === "python-cron") return entrada.config.cron;
  return entrada.config.modoDisparo === "agendado" ? entrada.config.cron : null;
}

/**
 * Próxima execução depois de `apartirDe`. Devolve `null` para automações sem
 * agendamento (webhook e manual) ou com expressão inválida — não vale derrubar
 * o dispatcher inteiro porque uma automação foi cadastrada errada.
 */
export function proximaExecucao(
  entrada: ConfigAutomacao,
  apartirDe: Date = new Date(),
): Date | null {
  const cron = cronDe(entrada);
  if (!cron) return null;

  try {
    const intervalo = CronExpressionParser.parse(cron, {
      currentDate: apartirDe,
      tz: FUSO,
    });
    return intervalo.next().toDate();
  } catch {
    return null;
  }
}
