/**
 * Formatação e cores compartilhadas pela aba de faturamento (servidor e
 * cliente). As classes de cor ficam escritas por extenso de propósito: o
 * Tailwind só gera a classe que encontra literal no código.
 */

/** Fundo da marca por slot de categoria; slot 0 é "Outras", em cinza neutro. */
export const FUNDO_CATEGORIA: Record<number, string> = {
  0: "bg-fg-subtle",
  1: "bg-cat-1",
  2: "bg-cat-2",
  3: "bg-cat-3",
  4: "bg-cat-4",
  5: "bg-cat-5",
  6: "bg-cat-6",
  7: "bg-cat-7",
};

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brlInteiro = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
export const brlCompacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
export const numero = new Intl.NumberFormat("pt-BR");

/** "+R$ 350" / "−R$ 3.116" — o sinal vem por extenso, a cor só reforça. */
export function variacaoReais(valor: number) {
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "±";
  return `${sinal}${brlInteiro.format(Math.abs(valor))}`;
}

/** Variação percentual; `null` quando não há base para comparar. */
export function variacaoPercentual(anterior: number, atual: number) {
  if (anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

export function formatarPercentual(valor: number | null, casas = 1) {
  if (valor === null) return "—";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "±";
  return `${sinal}${Math.abs(valor).toFixed(casas).replace(".", ",")}%`;
}

export function tomVariacao(valor: number) {
  return valor > 0 ? "text-success" : valor < 0 ? "text-danger" : "text-fg-muted";
}
