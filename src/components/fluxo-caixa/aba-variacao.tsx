"use client";

import { Fragment, useMemo, useState } from "react";
import { clsx } from "@/lib/clsx";
import { brl, k, nomeMes } from "@/lib/fluxo-caixa/calculos";
import type { Extra, VariacaoCausaBloco, VariacaoRef } from "@/lib/fluxo-caixa/tipos";
import { Secao, Segmentado, tab } from "@/components/fluxo-caixa/pecas";

const ROTULOS: Record<string, string> = { "7d": "7 dias", "15d": "15 dias" };

function dataBr(iso?: string) {
  return iso ? iso.split("-").reverse().join("/") : "";
}

type Causa = { id: string; nome: string; valor: number; dica: string; bloco?: VariacaoCausaBloco };

export function AbaVariacao({ extra }: { extra: Extra }) {
  const refs = extra.variacao ?? {};
  const disponiveis = ["7d", "15d"].filter((r) => refs[r]);
  const [ref, setRef] = useState<string>(disponiveis[0] ?? "7d");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const v: VariacaoRef | undefined = refs[ref] ?? (disponiveis[0] ? refs[disponiveis[0]] : undefined);

  const causas = useMemo<Causa[]>(() => {
    if (!v) return [];
    const c = v.causas;
    return [
      { id: "real", nome: "Já realizado no mês", valor: c.realizacao.total, bloco: c.realizacao, dica: "O que efetivamente entrou ou saiu neste mês desde o período anterior." },
      { id: "novo", nome: "Novos lançamentos", valor: c.novoLancamento.total, bloco: c.novoLancamento, dica: "Títulos e contratos que não existiam antes (receita nova, despesa nova)." },
      { id: "mud", nome: "Mudança real", valor: c.mudancaReal.total, bloco: c.mudancaReal, dica: "Ganho ou perda de quem já existia na projeção." },
      { id: "prem", nome: "Regra do dashboard", valor: c.premissa ?? 0, dica: "Mudança da projeção pela média — a média de 6 meses rolou ou o recebimento efetivo mudou." },
      { id: "anc", nome: "Ajuste de ancoragem", valor: c.ancoragem, dica: "Diferença entre o caixa real do mês e a soma por categoria." },
    ].filter((x) => Math.abs(x.valor) >= 1);
  }, [v]);

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

  // Headline usa o número COM a regra do dashboard (o mesmo das outras abas).
  // Fallback para a base de títulos se o pacote for de uma versão anterior do motor.
  const alvoMes = v.alvos[v.mesCorrente];
  const alvoAno = v.alvos[v.fimAno];
  const deltaMes = alvoMes?.deltaComRegra ?? alvoMes?.delta ?? 0;
  const deltaAno = v.causas.deltaFimAnoComRegra ?? v.causas.deltaFimAno;
  const timing = v.causas.deslocamentoTiming;
  const maxAbs = Math.max(1, ...causas.map((c) => Math.abs(c.valor)));
  const sinalTxt = (n: number) => (n > 0 ? "aumentou" : n < 0 ? "caiu" : "ficou igual");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmentado
          rotulo="Comparar com"
          valor={ref}
          onMudar={setRef}
          opcoes={disponiveis.map((r) => ({ valor: r, rotulo: `${ROTULOS[r] ?? r} atrás` }))}
        />
        <span className="text-xs text-fg-muted">
          Base: {dataBr(v.refData)} → hoje · caixa acumulado · R$
        </span>
      </div>

      <Secao
        titulo={`O que mudou desde ${dataBr(v.refData)}`}
        dica="A variação do caixa projetado, decomposta pela causa. Clique numa causa para ver o que a compõe."
      >
        <p className="text-sm">
          O caixa projetado de <strong>fim do ano</strong> {sinalTxt(deltaAno)}{" "}
          <strong className={clsx(deltaAno < 0 && "text-danger")}>{brl(Math.abs(deltaAno))}</strong> desde {dataBr(v.refData)}.
          {Math.abs(timing) >= 1 ? (
            <>
              {" "}Além disso, <strong>{brl(timing)}</strong> de receita apenas mudou de mês — <em>timing</em>, que não altera o
              total do ano.
            </>
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

      <Secao titulo="Por que o fim do ano mudou" dica="As causas somam exatamente a variação do fim do ano.">
        <div className="flex flex-col gap-2">
          {causas.map((c) => {
            const aberto = abertos[c.id];
            const itens = c.bloco?.itens ?? [];
            const pct = (Math.abs(c.valor) / maxAbs) * 100;
            const neg = c.valor < 0;
            return (
              <Fragment key={c.id}>
                <button
                  type="button"
                  onClick={() => itens.length > 0 && setAbertos({ ...abertos, [c.id]: !aberto })}
                  className={clsx(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left",
                    itens.length > 0 && "hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  title={c.dica}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {itens.length ? <span className="w-3 text-fg-muted">{aberto ? "▾" : "▸"}</span> : <span className="w-3" />}
                      {c.nome}
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <span
                        className={clsx("block h-full rounded-full", neg ? "bg-danger" : "bg-success")}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </span>
                  <b className={clsx("tabular-nums text-sm", neg && "text-danger")}>{k(c.valor)}</b>
                </button>
                {aberto && itens.length ? (
                  <div className="mb-1 ml-6 overflow-x-auto rounded-lg border border-border">
                    <table className={tab.table}>
                      <tbody>
                        {itens.map((it, i) => (
                          <tr key={i}>
                            <td className={clsx(tab.td, "text-xs")}>{it.categoria}</td>
                            <td className={clsx(tab.td, "max-w-64 truncate text-xs text-fg-muted")} title={it.cliente}>
                              {it.cliente && it.cliente !== "(sem detalhe por cliente)" ? it.cliente : "—"}
                            </td>
                            <td className={clsx(tab.tdR, "text-xs tabular-nums", it.delta < 0 && "text-danger")}>{brl(it.delta)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {c.bloco?.itensTotal && c.bloco.itensTotal > itens.length ? (
                      <p className="px-3 py-1.5 text-xs text-fg-muted">
                        Mostrando os {itens.length} maiores de {c.bloco.itensTotal}.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
        {Math.abs(v.causas.residuo) >= 1 ? (
          <p className="mt-3 text-xs text-fg-muted">Resíduo não atribuído: {brl(v.causas.residuo)}.</p>
        ) : null}
      </Secao>
    </div>
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
