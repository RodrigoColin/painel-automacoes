/**
 * Grupos de categoria do fluxo de caixa ("Por categoria").
 *
 * Classificação por palavra-chave no nome da categoria do Omie, na ordem da
 * lista (o primeiro que casa vence), com ajuste exato por empresa em
 * `fluxo_caixa_config.categorias_grupo`. A cor segue o grupo em qualquer
 * gráfico; receitas e despesas nunca dividem o mesmo gráfico categórico.
 */

export type IdGrupo = "rec" | "fat" | "rec1" | "pes" | "imp" | "inf" | "com" | "fin" | "adm";

export type GrupoFluxo = {
  id: IdGrupo;
  nome: string;
  padrao: RegExp;
  /** 1 = receita, -1 = despesa. */
  sinal: 1 | -1;
  /** Variável CSS da paleta categórica (ou neutra, para o "outros"). */
  cor: string;
};

export const CATEGORIA_FATURAMENTO_PROJETADO = "Faturamento projetado de contratos";

export const GRUPOS_FLUXO: GrupoFluxo[] = [
  { id: "rec", nome: "Receita recorrente", padrao: /recorrente|mensalidade|assinatura/i, sinal: 1, cor: "var(--cat-3)" },
  { id: "fat", nome: "Faturamento projetado de contratos", padrao: /^Faturamento projetado/, sinal: 1, cor: "var(--cat-7)" },
  { id: "rec1", nome: "Receita pontual e outras entradas", padrao: /./, sinal: 1, cor: "var(--cat-1)" },
  {
    id: "pes",
    nome: "Despesas com pessoal",
    padrao: /sal[aá]rio|pro-?labore|13º|fgts|vale|benef|plano de sa|rescis|f[ée]rias|inss/i,
    sinal: -1,
    cor: "var(--cat-2)",
  },
  { id: "imp", nome: "Impostos e taxas", padrao: /iss|cofins|pis|irpj|csll|imposto|tribut|multa|taxa/i, sinal: -1, cor: "var(--cat-4)" },
  {
    id: "inf",
    nome: "Infraestrutura e software",
    padrao: /infra|software|licen|equipamento|nuvem|cloud|servidor|proxy/i,
    sinal: -1,
    cor: "var(--cat-1)",
  },
  { id: "com", nome: "Comercial e marketing", padrao: /marketing|comiss|evento|comercial|m[ií]dia/i, sinal: -1, cor: "var(--cat-5)" },
  { id: "fin", nome: "Financeiras e financiamento", padrao: /juros|tarifa|empr[ée]stimo|financ|iof|banc/i, sinal: -1, cor: "var(--cat-7)" },
  { id: "adm", nome: "Administrativas e outras saídas", padrao: /./, sinal: -1, cor: "var(--fg-subtle)" },
];

export const GRUPOS_RECEITA = GRUPOS_FLUXO.filter((g) => g.sinal > 0);
export const GRUPOS_DESPESA = GRUPOS_FLUXO.filter((g) => g.sinal < 0);

export function grupoPorId(id: string) {
  return GRUPOS_FLUXO.find((g) => g.id === id);
}

/** Grupo de uma categoria para um valor (o sinal decide receita ou despesa). */
export function grupoDe(categoria: string, valor: number, ajustes: Record<string, string>): IdGrupo {
  const receita = valor > 0;
  const ajustado = grupoPorId(ajustes[categoria] ?? "");
  if (ajustado && ajustado.sinal > 0 === receita) return ajustado.id;
  for (const g of GRUPOS_FLUXO) {
    if (g.sinal > 0 === receita && g.padrao.test(categoria)) return g.id;
  }
  return receita ? "rec1" : "adm";
}

/**
 * Título rateado entre categorias vem do Omie como
 * "Salários (60,00%); INSS (40,00%)": devolve cada parte com o peso.
 */
export function dividirCategoria(texto: string): [string, number][] {
  const partes = [...String(texto).matchAll(/([^;()]+?)\s*\(([\d.,]+)%\)/g)];
  if (partes.length === 0) return [[texto, 1]];
  return partes.map((p) => [p[1].trim(), parseFloat(p[2].replace(",", ".")) / 100]);
}

/** Nome curto da categoria rateada ("(12,34567%)" vira "(12,3%)"). */
export function nomeCategoria(texto: string) {
  return String(texto).replace(/\((\d+),(\d)\d*%\)/g, "($1,$2%)");
}
