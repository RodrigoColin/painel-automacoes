/**
 * Constantes do upload de extrato da Conciliação Bancária, compartilhadas
 * entre a action e o formulário.
 *
 * Ficam fora de `acoes-conciliacao.ts` por obrigação: um módulo `"use
 * server"` só pode exportar funções assíncronas — qualquer constante
 * exportada de lá derruba o módulo inteiro na compilação (mesma regra de
 * `logo-empresa.ts`).
 */

export const TAMANHO_MAXIMO_OFX = 10 * 1024 * 1024; // 10 MB

export const EXTENSOES_OFX_ACEITAS = [".ofx"];
