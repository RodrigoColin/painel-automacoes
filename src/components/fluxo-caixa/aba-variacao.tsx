"use client";

import { Fragment, useMemo, useState } from "react";
import { clsx } from "@/lib/clsx";
import { brl, k, nomeMes } from "@/lib/fluxo-caixa/calculos";
import type { Extra, VariacaoItem, VariacaoRef } from "@/lib/fluxo-caixa/tipos";
import { Secao, Segmentado, tab } from "@/components/fluxo-caixa/pecas";

const ROTULOS: Record<string, string> = { "7d": "7 dias", "15d": "15 dias" };
const SEM_DETALHE = "(sem detalhe por cliente)";

function dataBr(iso?: string) {
  return iso ? iso.split("-").reverse().join("/") : "";
}

type CausaId = "real" | "novo" | "mud";

/** Rótulo em linguagem de negócio para (natureza, causa dominante, sinal). */
function rotuloNegocio(natureza: "receita" | "despesa", causa: CausaId, positivo: boolean): string {
  if (natureza === "receita") {
    if (causa === "real") return positivo ? "entrou acima do previsto" : "entrou abaixo do previsto";
    if (causa === "novo") return positivo ? "faturamento novo" : "faturamento cancelado";
    return positivo ? "projeção de receita maior" : "projeção de receita menor";
  }
  if (causa === "real") return positivo ? "pagamos menos que o previsto" : "pagamos mais que o previsto";
  if (causa === "novo") return positivo ? "despesa removida" : "despesa nova";
  return positivo ? "despesa menor" : "despesa maior";
}

type Evento = {
  categoria: string;
  natureza: "receita" | "despesa";
  total: number;
  rotulo: string;
  clientes: { cliente: string; delta: number; rotulo: string }[];
};

/** Agrega os itens das causas em variações POR CATEGORIA, separadas por natureza.
 * Formato novo: item já é a categoria, com clientes aninhados (lista de categorias completa —
 * os subtotais reconciliam com os totais das causas). Formato antigo: item por cliente. */
function montarEventos(v: VariacaoRef): { receitas: Evento[]; despesas: Evento[] } {
  const buckets: [CausaId, VariacaoItem[]][] = [
    ["real", v.causas.realizacao?.itens ?? []],
    ["novo", v.causas.novoLancamento?.itens ?? []],
    ["mud", v.causas.mudancaReal?.itens ?? []],
  ];
  const mapa = new Map<string, Evento & { porCausa: Record<CausaId, number> }>();
  for (const [causa, itens] of buckets) {
    for (const it of itens) {
      const nat = it.natureza ?? (it.delta > 0 ? "receita" : "despesa");
      const chave = `${nat}|${it.categoria}`;
      const ev = mapa.get(chave) ?? {
        categoria: it.categoria,
        natureza: nat,
        total: 0,
        rotulo: "",
        clientes: [],
        porCausa: { real: 0, novo: 0, mud: 0 },
      };
      ev.total += it.delta;
      ev.porCausa[causa] += it.delta;
      if (it.clientes?.length) {
        for (const c of it.clientes) {
          ev.clientes.push({ cliente: c.cliente, delta: c.delta, rotulo: rotuloNegocio(nat, causa, c.delta > 0) });
        }
      } else if (it.cliente) {
        ev.clientes.push({ cliente: it.cliente, delta: it.delta, rotulo: rotuloNegocio(nat, causa, it.delta > 0) });
      }
      mapa.set(chave, ev);
    }
  }
  const eventos = [...mapa.values()]
    .filter((e) => Math.abs(e.total) >= 1)
    .map((e) => {
      const dominante = (Object.entries(e.porCausa) as [CausaId, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0];
      e.rotulo = rotuloNegocio(e.natureza, dominante, e.total > 0);
      e.clientes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return e;
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return {
    receitas: eventos.filter((e) => e.natureza === "receita"),
    despesas: eventos.filter((e) => e.natureza === "despesa"),
  };
}

export function AbaVariacao({ extra }: { extra: Extra }) {
  const refs = extra.variacao ?? {};
  const disponiveis = ["7d", "15d"].filter((r) => refs[r]);
  const [ref, setRef] = useState<string>(disponiveis[0] ?? "7d");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const v: VariacaoRef | undefined = refs[ref] ?? (disponiveis[0] ? refs[disponiveis[0]] : undefined);
  const eventos = useMemo(() => (v ? montarEventos(v) : { receitas: [], despesas: [] }), [v]);

  if (!v) {
    return (
      <Secao titulo="Variação" dica="O que mudou de um período para o outro.">
        <p className="text-sm text-fg-muted">
          Ainda não há histórico suficiente para a ponte de variação. Assim que houver um snapshot de alguns dias atrás
          (as rodadas gravam um por dia), esta aba passa a mostrar <strong>por que o caixa mudou</strong>.
        </p>
      </Secao>
    );
  }

  const alvoMes = v.alvos[v.mesCorrente];
  const alvoAno = v.alvos[v.fimAno];
  const deltaMes = alvoMes?.deltaComRegra ?? alvoMes?.delta ?? 0;
  const deltaAno = v.causas.deltaFimAnoComRegra ?? v.causas.deltaFimAno;
  const premissa = v.causas.premissa ?? 0;
  const ancoragem = v.causas.ancoragem ?? 0;
  const timing = v.causas.deslocamentoTiming;
  // Recebimentos: nominais por cliente. Pagamentos: UMA linha pelo total da categoria
  // (decisão do Rodrigo, caso folha — recorrência com valor-padrão gera pares falsos por
  // funcionário; o que interessa é a linha "Salários" como um todo). Itens de despesa COM
  // cliente são do formato antigo (por funcionário) e ficam de fora.
  const timingItens = (v.causas.deslocamentoTimingItens ?? []).filter((t) =>
    (t.natureza ?? "receita") === "receita" ? !!t.cliente && t.cliente !== SEM_DETALHE : !t.cliente,
  );
  const timingReceb =
    v.causas.deslocamentoTimingRecebimentos ??
    timingItens.filter((t) => (t.natureza ?? "receita") === "receita").reduce((s, t) => s + t.valor, 0);
  const timingPag = v.causas.deslocamentoTimingPagamentos ?? 0;

  const totR = eventos.receitas.reduce((s, e) => s + e.total, 0);
  const totD = eventos.despesas.reduce((s, e) => s + e.total, 0);
  const maiorReceita = eventos.receitas[0];
  const maiorDespesa = eventos.despesas[0];

  // Frase executiva: o movimento dominante primeiro, em português de gente.
  const partes: string[] = [];
  if (Math.abs(totR) >= 1 && maiorReceita) partes.push(`${totR > 0 ? "entrou" : "saiu da projeção"} ${brl(Math.abs(totR))} em receitas (principalmente ${maiorReceita.categoria})`);
  if (Math.abs(totD) >= 1 && maiorDespesa) partes.push(`${totD < 0 ? "as despesas pesaram" : "as despesas aliviaram"} ${brl(Math.abs(totD))} (${maiorDespesa.categoria})`);
  if (Math.abs(premissa) >= 1) partes.push(`a projeção pela média ${premissa > 0 ? "subiu" : "desceu"} ${brl(Math.abs(premissa))}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmentado
          rotulo="Comparar com"
          valor={ref}
          onMudar={setRef}
          opcoes={disponiveis.map((r) => ({ valor: r, rotulo: `${ROTULOS[r] ?? r} atrás` }))}
        />
        <span className="text-xs text-fg-muted">Base: {dataBr(v.refData)} → hoje · caixa acumulado · R$</span>
      </div>

      <Secao titulo={`O que mudou desde ${dataBr(v.refData)}`} dica="A variação do caixa projetado, explicada em linguagem de negócio. Clique numa linha para abrir os clientes.">
        <p className="text-sm">
          O caixa projetado de <strong>fim do ano</strong> {deltaAno > 0 ? "melhorou" : deltaAno < 0 ? "piorou" : "não mudou"}{" "}
          <strong className={clsx(deltaAno < 0 && "text-danger")}>{brl(Math.abs(deltaAno))}</strong>
          {partes.length ? <>: {partes.join("; ")}.</> : "."}
          {timingReceb >= 1 ? (
            <> Além disso, <strong>{brl(timingReceb)}</strong> em recebimentos apenas mudou de mês (timing) — não altera o ano.</>
          ) : null}
        </p>
      </Secao>

      <div className="grid gap-4 sm:grid-cols-2">
        <Alvo
          titulo={`Fim de ${nomeMes(v.mesCorrente)} (mês corrente)`}
          delta={deltaMes}
          de={alvoMes ? { acumA: alvoMes.acumAComRegra ?? alvoMes.acumA, acumB: alvoMes.acumBComRegra ?? alvoMes.acumB } : undefined}
        />
        <Alvo
          titulo={`Fim do ano (${nomeMes(v.fimAno)})`}
          delta={deltaAno}
          de={alvoAno ? { acumA: alvoAno.acumAComRegra ?? alvoAno.acumA, acumB: alvoAno.acumBComRegra ?? alvoAno.acumB } : undefined}
        />
      </div>

      <BlocoNatureza
        titulo="Receitas — o que mudou"
        total={totR}
        eventos={eventos.receitas}
        abertos={abertos}
        setAbertos={setAbertos}
        vazio="Nenhuma variação de receita relevante no período."
      />
      <BlocoNatureza
        titulo="Despesas — o que mudou"
        total={totD}
        eventos={eventos.despesas}
        abertos={abertos}
        setAbertos={setAbertos}
        vazio="Nenhuma variação de despesa relevante no período."
      />

      {Math.abs(premissa) >= 1 || Math.abs(ancoragem) >= 1 ? (
        <Secao titulo="Projeção pela média e ajustes" dica="A parte da variação que vem da regra do dashboard (média de 6 meses, recebimento efetivo) e de ajustes técnicos — não é um fato novo de cliente.">
          <div className="flex flex-col gap-1.5 text-sm">
            {Math.abs(premissa) >= 1 ? (
              <div className="flex items-baseline justify-between gap-3">
                <span>Projeção pela média (regra do dashboard) {premissa > 0 ? "subiu" : "desceu"} — a média de 6 meses rolou</span>
                <b className={clsx("tabular-nums", premissa < 0 && "text-danger")}>{k(premissa)}</b>
              </div>
            ) : null}
            {Math.abs(ancoragem) >= 1 ? (
              <div className="flex items-baseline justify-between gap-3 text-fg-muted">
                <span>Ajuste técnico de ancoragem no caixa real do mês</span>
                <b className="tabular-nums">{k(ancoragem)}</b>
              </div>
            ) : null}
          </div>
        </Secao>
      ) : null}

      {timing >= 1 ? (
        <Secao
          titulo="Só mudou de mês (timing)"
          dica="Dinheiro que saiu de um mês e reapareceu em outro — o total do ano não muda; muda em qual mês ele se move. Recebimentos aparecem por cliente; pagamentos pelo total da categoria (ex.: a linha Salários inteira, sem detalhe por favorecido)."
        >
          {timingItens.length ? (
            <div className={clsx(tab.wrap, "-mx-4 sm:-mx-5")}>
              <table className={clsx(tab.table, "min-w-max")}>
                <tbody>
                  {timingItens.map((t, i) => {
                    const receita = (t.natureza ?? "receita") === "receita";
                    return (
                      <tr key={i}>
                        <td className={clsx(tab.td, "max-w-72 truncate text-sm")} title={receita ? t.cliente : t.categoria}>
                          {receita ? t.cliente : t.categoria}
                        </td>
                        <td className={clsx(tab.td, "text-xs text-fg-muted")}>
                          {receita ? `${t.categoria} · recebimento` : "pagamento · total da categoria"}
                        </td>
                        <td className={clsx(tab.td, "whitespace-nowrap text-xs text-fg-muted")}>{nomeMes(t.de)} → {nomeMes(t.para)}</td>
                        <td className={clsx(tab.tdR, "tabular-nums text-sm")}>{brl(t.valor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : timingReceb + timingPag >= 1 ? (
            <p className="text-sm text-fg-muted">
              {brl(timingReceb + timingPag)} mudaram de mês dentro do ano (sem detalhe neste pacote).
            </p>
          ) : null}
        </Secao>
      ) : null}

      {Math.abs(v.causas.residuo) >= 1 ? (
        <p className="text-xs text-fg-subtle">Resíduo não atribuído: {brl(v.causas.residuo)}.</p>
      ) : null}
    </div>
  );
}

function BlocoNatureza({
  titulo,
  total,
  eventos,
  abertos,
  setAbertos,
  vazio,
}: {
  titulo: string;
  total: number;
  eventos: Evento[];
  abertos: Record<string, boolean>;
  setAbertos: (a: Record<string, boolean>) => void;
  vazio: string;
}) {
  const LIMIAR = 1000;
  const principais = eventos.filter((e) => Math.abs(e.total) >= LIMIAR);
  const menores = eventos.filter((e) => Math.abs(e.total) < LIMIAR);
  const somaMenores = menores.reduce((s, e) => s + e.total, 0);
  const maxAbs = Math.max(1, ...eventos.map((e) => Math.abs(e.total)));

  return (
    <Secao
      titulo={titulo}
      acoes={<b className={clsx("tabular-nums text-sm", total < 0 && "text-danger")}>{total > 0 ? "+" : ""}{k(total)}</b>}
    >
      {eventos.length === 0 ? (
        <p className="text-sm text-fg-muted">{vazio}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {principais.map((e) => {
            const chave = `${e.natureza}|${e.categoria}`;
            const aberto = abertos[chave];
            const neg = e.total < 0;
            const clientes = e.clientes.filter((c) => c.cliente !== SEM_DETALHE);
            // resto = o total da categoria menos os clientes exibidos (clientes truncados no
            // pacote + parcela sem detalhe por cliente, ex.: projeções)
            const semDetalhe = e.total - clientes.reduce((s, c) => s + c.delta, 0);
            return (
              <Fragment key={chave}>
                <button
                  type="button"
                  onClick={() => setAbertos({ ...abertos, [chave]: !aberto })}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="w-3 text-fg-muted">{aberto ? "▾" : "▸"}</span>
                      <span className="font-medium">{e.categoria}</span>
                      <span className="text-xs text-fg-muted">{e.rotulo}</span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <span className={clsx("block h-full rounded-full", neg ? "bg-danger" : "bg-success")} style={{ width: `${(Math.abs(e.total) / maxAbs) * 100}%` }} />
                    </span>
                  </span>
                  <b className={clsx("tabular-nums text-sm", neg && "text-danger")}>{e.total > 0 ? "+" : ""}{k(e.total)}</b>
                </button>
                {aberto ? (
                  <div className="mb-1 ml-6 overflow-x-auto rounded-lg border border-border">
                    <table className={tab.table}>
                      <tbody>
                        {clientes.map((c, i) => (
                          <tr key={i}>
                            <td className={clsx(tab.td, "max-w-72 truncate text-xs")} title={c.cliente}>{c.cliente}</td>
                            <td className={clsx(tab.td, "text-xs text-fg-muted")}>{c.rotulo}</td>
                            <td className={clsx(tab.tdR, "text-xs tabular-nums", c.delta < 0 && "text-danger")}>{brl(c.delta)}</td>
                          </tr>
                        ))}
                        {Math.abs(semDetalhe) >= 1 ? (
                          <tr className="text-fg-muted">
                            <td className={clsx(tab.td, "text-xs")}>(demais clientes e parcelas sem detalhe)</td>
                            <td className={tab.td} />
                            <td className={clsx(tab.tdR, "text-xs tabular-nums", semDetalhe < 0 && "text-danger")}>{brl(semDetalhe)}</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
          {Math.abs(somaMenores) >= 1 ? (
            <div className="flex items-baseline justify-between gap-3 px-3 py-1 text-xs text-fg-muted">
              <span>⋯ outras {menores.length} variações menores</span>
              <b className={clsx("tabular-nums", somaMenores < 0 && "text-danger")}>{somaMenores > 0 ? "+" : ""}{k(somaMenores)}</b>
            </div>
          ) : null}
        </div>
      )}
    </Secao>
  );
}

function Alvo({ titulo, delta, de }: { titulo: string; delta: number; de?: { acumA: number; acumB: number } }) {
  const neg = delta < 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{titulo}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", neg && "text-danger")}>
        {delta > 0 ? "+" : ""}
        {brl(delta)}
      </div>
      {de ? (
        <div className="mt-1 text-xs text-fg-muted tabular-nums">
          {brl(de.acumA)} → {brl(de.acumB)}
        </div>
      ) : null}
    </div>
  );
}
