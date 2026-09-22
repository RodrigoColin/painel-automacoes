/**
 * Constantes da logo da empresa, compartilhadas entre a action e o
 * formulário.
 *
 * Ficam fora de `acoes.ts` por obrigação: um módulo `"use server"` só pode
 * exportar funções assíncronas — qualquer constante exportada de lá derruba
 * o módulo inteiro na compilação.
 */

/** 512 KB é folgado para uma logo e segura o custo de servir a imagem em toda página. */
export const TAMANHO_MAXIMO_LOGO = 512 * 1024;

/** Tipos aceitos, com a extensão que cada um ganha no disco. */
export const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const TIPOS_LOGO_ACEITOS = Object.keys(EXTENSAO_POR_TIPO);
