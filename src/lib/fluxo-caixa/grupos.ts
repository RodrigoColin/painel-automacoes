/**
 * Grupos de categoria do fluxo de caixa ("Por categoria").
 *
 * Classificação por palavra-chave no nome da categoria do Omie, na ordem da
 * lista (o primeiro que casa vence), com ajuste exato por empresa em
 * `fluxo_caixa_config.categorias_grupo`. A cor segue o grupo em qualquer
 * gráfico; receitas e despesas nunca dividem o mesmo gráfico categórico.
 */

export type IdGrupo = "rec" | "fat" | "rp" | "rec1" | "pes" | "imp" | "inf" | "com" | "fin" | "adm";

export type GrupoFluxo = {
  id: IdGrupo;
  nome: string;
  padrao: RegExp;
  /** 1 = receita, -1 = despesa. */
  sinal: 1 | -1;
  /** Variável CSS da paleta categórica (ou neutra, para o "outros"). */
  cor: string;
};

export const CATEGORIA_FATURAMENTO_PROJETADO = "Faturamento projetado (ainda não faturado)";

export const GRUPOS_FLUXO: GrupoFluxo[] = [
  // O grupo "fat" NÃO é escolhido por nome de categoria: ele recebe toda receita ainda não
  // faturada (fora do contas a receber), roteada explicitamente por grupoDeMov/origem. O
  // `padrao` abaixo nunca casa com categoria real (serve só de placeholder inofensivo). Fica no
  // topo das receitas de propósito (pedido do Rodrigo) — a ordem aqui define a ordem na tela;
  // como o regex nunca casa, pôr antes de "rec" não muda classificação nenhuma.
  { id: "fat", nome: "Faturamento projetado (ainda não faturado)", padrao: /(?!)/, sinal: 1, cor: "var(--cat-7)" },
  { id: "rec", nome: "Receita recorrente", padrao: /recorrente|mensalidade|assinatura/i, sinal: 1, cor: "var(--cat-3)" },
  // "Receita pontual": serviços pontuais (execução única, desenvolvimento, integração). Vem
  // ANTES do catch-all "Outras entradas" (primeiro que casa vence). Ajuste por empresa em
  // fluxo_caixa_config.categorias_grupo, se precisar mapear nomes diferentes.
  { id: "rp", nome: "Receita pontual", padrao: /execu|desenvolv|integra/i, sinal: 1, cor: "var(--cat-6)" },
  { id: "rec1", nome: "Outras entradas", padrao: /./, sinal: 1, cor: "var(--cat-1)" },
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
 * Origem de movimento que representa RECEITA ainda não faturada (fora do contas a receber):
 * as previsões nativas do Omie ("Previsão de Contratos Mensais / Ordem de Serviço / Pedido…")
 * e a projeção pela média do dashboard (linha sintética com origem "Faturamento projetado").
 * "Conta a Receber" e créditos já realizados NÃO entram aqui — já estão faturados.
 */
export function ehOrigemProjetada(origem: string | null | undefined): boolean {
  return !!origem && (origem.startsWith("Previsão") || origem === "Faturamento projetado");
}

/**
 * Grupo de um MOVIMENTO: receita ainda não faturada cai sempre no grupo "fat"
 * ("Faturamento projetado (ainda não faturado)"), seja qual for o nome da categoria; o
 * restante segue a classificação por nome (grupoDe). Regra única — ver ehOrigemProjetada.
 */
export function grupoDeMov(categoria: string, valor: number, ajustes: Record<string, string>, projetado: boolean): IdGrupo {
  if (valor > 0 && projetado) return "fat";
  return grupoDe(categoria, valor, ajustes);
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
