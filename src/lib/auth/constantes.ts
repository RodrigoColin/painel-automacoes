/**
 * Separado de `sessao.ts` para o `proxy.ts` poder importar sem arrastar junto
 * o driver do Postgres e o bcrypt.
 */

export const COOKIE_SESSAO = "painel_sessao";

/** Piso de tamanho de senha, conferido na criação e na troca. */
export const SENHA_MINIMA = 8;
