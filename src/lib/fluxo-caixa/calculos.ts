/**
 * Contas da tela "Fluxo de caixa" que dependem das escolhas de quem olha
 * (cenário de estresse e regra do dashboard). Portadas do template do antigo
 * artefato da Oystr; o que era número fixo dela vem de `extra.parametros`.
 * Funções puras: rodam no navegador a cada troca de cenário.
 */

import { CATEGORIA_FATURAMENTO_PROJETADO } from "@/lib/fluxo-caixa/grupos";
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

/** Média do faturamento dos últimos 6 meses fechados (mês corrente fora). */
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
 * Faturamento projetado dos meses depois do corrente que o extrato ainda não
 * previu: média de faturamento × recebimento efetivo, menos o que já está
 * previsto, espalhado pelos dias úteis conforme o padrão de entradas da
 * empresa. No mês corrente não entra (os títulos reais já cobrem).
 */
export function complementoContratos(extrato: Extrato, extra: Extra, movsCaixa: Movimento[]): Movimento[] {
  const fat = faturamentoBase(extra, extrato.hoje).valor;
  if (fat <= 0) return [];
  const alvo = fat * extra.parametros.recEfetivo;
  const padrao = extra.parametros.padraoIntramensal;
  const conta = extrato.contas.find((c) => c.somaNoCaixa)?.codigo ?? 0;
  const diasHorizonte = new Set(extrato.dias.map((d) => d.data));
  const meses = [...new Set(extrato.dias.map((d) => d.data.slice(0, 7)))].filter((m) => m > extrato.hoje.slice(0, 7));

  const saida: Movimento[] = [];
  for (const mes of meses) {
    const jaPrevisto = movsCaixa
      .filter((m) => m.data.startsWith(mes) && m.valor > 0)
      .reduce((s, m) => s + m.valor, 0);
    const falta = alvo - jaPrevisto;
    if (falta <= 0) continue;
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
    for (const x of dias) {
      saida.push({
        id: `fat-${x.iso}`,
        data: x.iso,
        vencimento: null,
        conta,
        nome: "Contratos a faturar no mês (regra do dashboard)",
        categoria: CATEGORIA_FATURAMENTO_PROJETADO,
        documento: "",
        origem: "Faturamento projetado",
        valor: Math.round(((falta * x.peso) / total) * 100) / 100,
        realizado: false,
      });
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
  const fat = faturamentoBase(extra, hoje).valor * extra.parametros.recEfetivo;
  futuros.forEach((m, i) => {
    E[m] ??= 0;
    S[m] ??= 0;
    const proximo = futuros[i + 1];
    const add = (categoria: string, v: number) => {
      if (v <= 0) {
        S[m] -= v;
        return;
      }
      if (p.frac && categoria !== CATEGORIA_FATURAMENTO_PROJETADO) {
        E[m] += v * (1 - p.frac);
        if (proximo) E[proximo] = (E[proximo] ?? 0) + v * p.frac;
      } else E[m] += v;
    };
    let entradasBrutas = 0;
    for (const [c, v] of Object.entries(extra.catmes[m] ?? {})) {
      add(c, v);
      if (v > 0) entradasBrutas += v;
    }
    if (usaRegra && fat - entradasBrutas > 0) add(CATEGORIA_FATURAMENTO_PROJETADO, fat - entradasBrutas);
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
