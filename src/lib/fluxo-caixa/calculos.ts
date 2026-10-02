/**
 * Contas da tela "Fluxo de caixa" que dependem das escolhas de quem olha
 * (cenário de estresse e regra do dashboard). Portadas do template do antigo
 * artefato da Oystr; o que era número fixo dela vem de `extra.parametros`.
 * Funções puras: rodam no navegador a cada troca de cenário.
 */

import { dividirCategoria } from "@/lib/fluxo-caixa/grupos";
import type { DiaExtrato, Extra, Extrato, MesHistorico, Movimento } from "@/lib/fluxo-caixa/tipos";

export type Cenario = "base" | "conservador" | "pessimista";

export type ParametrosCenario = { frac: number; atraso: number };

export function parametrosCenario(extra: Extra, cenario: Cenario): ParametrosCenario {
  if (cenario === "base") return { frac: 0, atraso: 0 };
  const p = extra.parametros.cenarios[cenario];
  return { frac: p.frac, atraso: p.atraso };
}

/* --------------------------------- Datas --------------------------------- */

export function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export function proximoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "set/26" */
export const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
/** "28/09" */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "Seg, 28/09" */
export const diaRotulo = (iso: string) => `${SEMANA[diaDaSemana(iso)]}, ${diaMes(iso)}`;

/* ------------------------------- Formatação ------------------------------ */

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const brl = (v: number) => reais.format(v);

/** Compacto para eixo e célula de matriz: "R$ 1,2 mi", "R$ 350k", "−R$ 80". */
export function k(v: number) {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (a >= 1e3) return `${s}R$ ${Math.round(a / 1e3)}k`;
  return `${s}R$ ${Math.round(a)}`;
}

export const pct = (v: number, casas = 1) => `${v.toFixed(casas).replace(".", ",")}%`;

/* ------------------------ Regra do dashboard (fat.) ---------------------- */

/** Média do faturamento dos últimos 6 meses fechados (mês corrente fora) — só pra exibição. */
export function faturamentoBase(extra: Extra, hoje: string) {
  const fechados = extra.hist.filter((h) => h.mes < hoje.slice(0, 7) && h.fat > 0).slice(-6);
  if (fechados.length === 0) return { valor: 0, de: null, ate: null, n: 0 };
  return {
    valor: fechados.reduce((s, h) => s + h.fat, 0) / fechados.length,
    de: fechados[0].mes,
    ate: fechados[fechados.length - 1].mes,
    n: fechados.length,
  };
}

/**
 * catmes de um mês, com a regra do dashboard aplicada POR CATEGORIA (não um total
 * genérico) pros meses futuros: cada categoria de receita sem contrato/título ainda
 * cadastrado na Omie é completada até a própria média dos últimos 6 meses fechados
 * (`extra.catBase`), não até uma média única do faturamento total — uma categoria com
 * boa cobertura não deveria "emprestar" espaço pra outra que ainda está rala. Mês
 * corrente e fechados voltam como estão: já são dado real (contrato com vigência
 * vencida incluso, ver proos-omie-mcp/caixa/bases.py), sem suposição nenhuma.
 */
export function catmesAjustado(extra: Extra, mes: string, mesCur: string): Record<string, number> {
  const base = { ...(extra.catmes[mes] ?? {}) };
  if (mes <= mesCur) return base;
  const jaCat: Record<string, number> = {};
  for (const [c, v] of Object.entries(base)) {
    if (v > 0) {
      for (const [cn, p] of dividirCategoria(c)) jaCat[cn] = (jaCat[cn] ?? 0) + v * p;
    }
  }
  const recEfetivo = extra.parametros.recEfetivo;
  for (const [cn, media] of Object.entries(extra.catBase ?? {})) {
    const falta = media * recEfetivo - (jaCat[cn] ?? 0);
    if (falta > 0) base[cn] = (base[cn] ?? 0) + falta;
  }
  return base;
}

/**
 * Preenche, dia a dia, a diferença entre o que o extrato diário já sabe (movsCaixa,
 * que só cobre o horizonte do extrato) e o que catmesAjustado() diz que deveria estar
 * lá naquele mês — por categoria. Isso cobre dois casos com mecânica parecida:
 *   - mês corrente (e meses já fechados dentro do horizonte do extrato): catmesAjustado()
 *     devolve o dado real (já com o complemento de vigência vencida) direto da base de
 *     títulos -- a fonte de verdade. O extrato diário (ListarExtrato) é uma consulta
 *     SEPARADA à Omie, com timing e categorização próprios (ex.: título com categoria em
 *     branco vira "Sem categoria" no extrato, mas a base de títulos reclassifica pela
 *     categoria mais comum do cliente) -- diferenças pra mais OU pra menos acontecem.
 *     Por isso aqui a correção é nos DOIS sentidos (RECONCILIA, não só completa): sem
 *     isso, uma categoria em que o extrato mostra mais do que a base de títulos nunca
 *     era descontada, e a aba Diário ficava com entradas maiores que a Por Categoria pro
 *     mesmo mês (achado real, 02/10/2026: R$ 13.828,55 de excesso em "Presto Recorrente"
 *     e "Execução Única" nunca descontados).
 *   - meses futuros: catmesAjustado() já inclui a média por categoria; só COMPLETA
 *     (nunca reduz) -- é projeção, não tem por que subtrair de um mês que ainda nem
 *     começou.
 * Achado real na Oystr, 01/10/2026: antes disso só rodava pros meses futuros e
 * comparava contra movsCaixa (não contra catmes), subestimando o mês corrente e, pra
 * um mês parcialmente fora do horizonte do extrato, inflando a "falta" em ~5x.
 */
export function complementoContratos(extrato: Extrato, extra: Extra, movsCaixa: Movimento[]): Movimento[] {
  const mesCur = extrato.hoje.slice(0, 7);
  const padrao = extra.parametros.padraoIntramensal;
  const conta = extrato.contas.find((c) => c.somaNoCaixa)?.codigo ?? 0;
  const diasHorizonte = new Set(extrato.dias.map((d) => d.data));
  const meses = [...new Set(extrato.dias.map((d) => d.data.slice(0, 7)))];

  const saida: Movimento[] = [];
  for (const mes of meses) {
    const reconcilia = mes <= mesCur;
    const alvoCat = catmesAjustado(extra, mes, mesCur);
    const jaCat: Record<string, number> = {};
    for (const m of movsCaixa) {
      if (!m.data.startsWith(mes) || m.valor <= 0) continue;
      for (const [cn, p] of dividirCategoria(m.categoria)) jaCat[cn] = (jaCat[cn] ?? 0) + m.valor * p;
    }
    const [a, mm] = mes.split("-").map(Number);
    const nd = new Date(Date.UTC(a, mm, 0)).getUTCDate();
    const dias: { iso: string; peso: number }[] = [];
    for (let d = 1; d <= nd; d++) {
      const iso = `${mes}-${String(d).padStart(2, "0")}`;
      if (iso >= extrato.hoje && diaDaSemana(iso) % 6 !== 0 && diasHorizonte.has(iso)) {
        dias.push({ iso, peso: padrao[d - 1] ?? 0 });
      }
    }
    const total = dias.reduce((s, x) => s + x.peso, 0);
    if (!total) continue;
    // mês corrente/fechado reconcilia com toda categoria de receita que aparece em
    // qualquer uma das duas fontes (mesmo uma só no extrato, sem contrapartida em
    // catmes); meses futuros só olham o que catmes já prevê. Mas só entram categorias
    // que catmes reconhece como receita em algum momento (alvo>0 agora, ou histórico em
    // catBase) — categoria que só existe no extrato e nunca em catmes (ex.: transferência
    // entre contas da própria empresa, que não é título) não entra na reconciliação:
    // não é receita "sobrando", é um tipo de movimento que catmes nem modela.
    const categoriaConhecida = (cn: string) => (alvoCat[cn] ?? 0) > 0 || cn in extra.catBase;
    const categorias = reconcilia
      ? new Set([...Object.keys(alvoCat), ...Object.keys(jaCat)].filter(categoriaConhecida))
      : new Set(Object.keys(alvoCat));
    for (const cn of categorias) {
      const alvo = alvoCat[cn] ?? 0;
      const ja = jaCat[cn] ?? 0;
      if (!reconcilia && !(alvo > 0)) continue; // meses futuros: só categoria de receita prevista
      const diff = alvo - ja;
      if (!reconcilia && diff <= 0) continue; // meses futuros: nunca reduz
      if (Math.abs(diff) < 1) continue;
      for (const x of dias) {
        saida.push({
          id: `fat-${cn}-${x.iso}`,
          data: x.iso,
          vencimento: null,
          conta,
          nome: diff < 0
            ? "Ajuste de reconciliação com a base de títulos"
            : mes <= mesCur ? "Complemento de contratos com vigência vencida" : "Projeção pela média (sem contrato específico ainda)",
          categoria: cn,
          documento: "",
          origem: "Faturamento projetado",
          valor: Math.round(((diff * x.peso) / total) * 100) / 100,
          realizado: false,
        });
      }
    }
  }
  return saida;
}

/* ------------------------------- Cenários -------------------------------- */

/**
 * Cenário de estresse: uma fração de cada entrada prevista de hoje em diante
 * atrasa N dias. O que passa do fim do horizonte sai da projeção.
 */
export function aplicarCenario(movs: Movimento[], p: ParametrosCenario, hoje: string, ultimoDia: string): Movimento[] {
  if (!p.frac) return movs;
  const saida: Movimento[] = [];
  for (const m of movs) {
    if (!(m.valor > 0) || m.realizado || m.data < hoje) {
      saida.push(m);
      continue;
    }
    saida.push({ ...m, valor: m.valor * (1 - p.frac) });
    const nova = somarDias(m.data, p.atraso);
    if (nova <= ultimoDia) saida.push({ ...m, id: `${m.id}-atraso`, data: nova, valor: m.valor * p.frac, cenario: true });
  }
  return saida;
}

/** Entradas, saídas e saldo de cada dia do horizonte para um conjunto de movimentos. */
export function recalcularDias(extrato: Extrato, movs: Movimento[]): DiaExtrato[] {
  const porDia = new Map<string, { e: number; s: number; r: number }>();
  for (const m of movs) {
    const o = porDia.get(m.data) ?? { e: 0, s: 0, r: 0 };
    if (m.valor > 0) o.e += m.valor;
    else o.s -= m.valor;
    if (m.realizado) o.r += m.valor;
    porDia.set(m.data, o);
  }
  const vazio = { e: 0, s: 0, r: 0 };
  const iHoje = extrato.dias.findIndex((d) => d.data === extrato.hoje);
  const dh = porDia.get(extrato.hoje) ?? vazio;
  const dias = extrato.dias.map((d) => ({ ...d }));

  let s = extrato.caixaProprio + (dh.e - dh.s - dh.r);
  dias.forEach((d, i) => {
    const o = porDia.get(d.data) ?? vazio;
    d.entradas = o.e;
    d.saidas = o.s;
    if (i === iHoje) d.saldo = s;
    else if (i > iHoje) {
      s += o.e - o.s;
      d.saldo = s;
    }
  });
  let b = extrato.caixaProprio - dh.r;
  for (let i = iHoje - 1; i >= 0; i--) {
    dias[i].saldo = b;
    b -= (porDia.get(dias[i].data) ?? vazio).r;
  }
  return dias;
}

/* ------------------------------ Visão mensal ----------------------------- */

export type LinhaMensal = MesHistorico & {
  /** Recebimento efetivo = entradas ÷ faturado. */
  receb: number | null;
};

/**
 * Meses do ano corrente: fechados e em curso vêm do histórico; os seguintes
 * seguem a mesma conta da aba "Por categoria" (catmes + regra do dashboard +
 * cenário, com a parcela atrasada caindo no mês seguinte).
 */
export function linhasMensais(extra: Extra, hoje: string, usaRegra: boolean, p: ParametrosCenario): LinhaMensal[] {
  const ano = String(extra.ano);
  const mesCur = hoje.slice(0, 7);
  const doAno = extra.hist.filter((h) => h.mes.startsWith(ano));
  const linhas: LinhaMensal[] = doAno
    .filter((h) => h.mes <= mesCur)
    .map((h) => ({ ...h, receb: h.fat > 0 ? h.ent / h.fat : null }));

  const futuros = doAno.filter((h) => h.mes > mesCur).map((h) => h.mes);
  const E: Record<string, number> = {};
  const S: Record<string, number> = {};
  futuros.forEach((m, i) => {
    E[m] ??= 0;
    S[m] ??= 0;
    const proximo = futuros[i + 1];
    const add = (v: number) => {
      if (v <= 0) {
        S[m] -= v;
        return;
      }
      if (p.frac) {
        E[m] += v * (1 - p.frac);
        if (proximo) E[proximo] = (E[proximo] ?? 0) + v * p.frac;
      } else E[m] += v;
    };
    const cats = usaRegra ? catmesAjustado(extra, m, mesCur) : (extra.catmes[m] ?? {});
    for (const v of Object.values(cats)) add(v);
  });

  let acum = linhas.at(-1)?.acum ?? 0;
  for (const m of futuros) {
    const saldo = E[m] - S[m];
    acum += saldo;
    const faturado = E[m] / (extra.parametros.recEfetivo || 1);
    linhas.push({ mes: m, fat: faturado, ent: E[m], sai: S[m], saldo, acum, status: "projetado", receb: null });
  }
  return linhas;
}

/* ------------------------------- CSV (Excel) ----------------------------- */

function celulaCsv(v: unknown) {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const numeroCsv = (v: number) => v.toFixed(2).replace(".", ",");

/** Baixa um CSV que o Excel abre direto (BOM + ponto e vírgula). */
export function baixarCsv(nome: string, linhas: unknown[][]) {
  const texto = "﻿" + linhas.map((l) => l.map(celulaCsv).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function slug(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}
