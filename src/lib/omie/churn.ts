/**
 * Separado de `lib/omie/faturamento.ts` de propósito: aquele arquivo importa
 * `criarClienteServidor` (que usa `next/headers`, só-servidor). Um componente
 * client que importe um valor de lá — não só o tipo — arrasta esse import
 * pro bundle do navegador e quebra o build. Esta função não precisa de nada
 * do servidor, só do tipo `MovimentoCliente`.
 */
import type { MovimentoCliente } from "@/lib/omie/faturamento";

/** Separa a saída bruta em confirmado (cancelado no Omie) vs. em revisão (suspenso/ativo lá). */
export function classificarChurn(saidas: MovimentoCliente[]) {
  return {
    confirmados: saidas.filter((s) => s.situacaoContrato === "cancelado"),
    suspensos: saidas.filter((s) => s.situacaoContrato === "suspenso"),
    ativosRevisar: saidas.filter((s) => s.situacaoContrato === "ativo"),
    semContrato: saidas.filter((s) => s.situacaoContrato === "sem-contrato"),
  };
}
