"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { baixarCsv, brl, diaMes, k, nomeMes, numeroCsv, pct } from "@/lib/fluxo-caixa/calculos";
import type { Extra } from "@/lib/fluxo-caixa/tipos";
import { Colunas } from "@/components/fluxo-caixa/graficos";
import { BotaoLeve, Kpi, Secao, tab } from "@/components/fluxo-caixa/pecas";

type ColDevedor = "cliente" | "valor" | "n" | "dias" | "antigo" | "pct" | "vencidoTotal" | "titulosTotal" | "extra";

export function AbaInadimplencia({ extra }: { extra: Extra }) {
  const I = extra.inad;
  const X = extra.inadx;
  const ano = String(I.ano);
  const [ordem, setOrdem] = useState<{ col: ColDevedor; dir: 1 | -1 }>({ col: "valor", dir: -1 });
  const [todosDev, setTodosDev] = useState(false);
  const [todosCx, setTodosCx] = useState(false);

  const colunas: { col: ColDevedor; rotulo: string }[] = [
    { col: "cliente", rotulo: "Cliente" },
    { col: "valor", rotulo: `Vencido ${ano}` },
    { col: "n", rotulo: "Títulos" },
    { col: "dias", rotulo: "Maior atraso" },
    { col: "antigo", rotulo: "Venc. mais antigo" },
    { col: "pct", rotulo: "% do total" },
    { col: "vencidoTotal", rotulo: "Vencido total" },
    { col: "titulosTotal", rotulo: "Títulos (total)" },
    { col: "extra", rotulo: `De antes de ${ano}` },
  ];
  const devedores = I.top
    .map((c) => ({ ...c, pct: I.total ? (c.valor / I.total) * 100 : 0, extra: c.vencidoTotal - c.valor }))
    .sort((a, b) => {
      const x = a[ordem.col];
      const y = b[ordem.col];
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * ordem.dir;
    });
  const devVisiveis = todosDev ? devedores : devedores.slice(0, 15);
  const cxVisiveis = todosCx ? I.cxm : I.cxm.slice(0, 15);
  const inadimplencia = I.fatAno ? (I.total / I.fatAno) * 100 : null;

  function ordenar(col: ColDevedor) {
    setOrdem((o) => (o.col === col ? { col, dir: (o.dir * -1) as 1 | -1 } : { col, dir: col === "cliente" ? 1 : -1 }));
  }

  function exportarDevedores() {
    baixarCsv(`maiores_devedores_${ano}_${I.ref}.csv`, [
      colunas.map((c) => c.rotulo),
      ...devedores.map((c) => [c.cliente, numeroCsv(c.valor), c.n, c.dias, c.antigo, numeroCsv(c.pct), numeroCsv(c.vencidoTotal), c.titulosTotal, numeroCsv(c.extra)]),
    ]);
  }

  function exportarCx() {
    baixarCsv(`cliente_x_mes_vencimento_${ano}_${I.ref}.csv`, [
      ["Cliente", ...I.meses.map(nomeMes), "Total"],
      ...I.cxm.map((c) => [c.cliente, ...I.meses.map((m) => numeroCsv(Number(c[m] ?? 0))), numeroCsv(c.tot)]),
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-fg-muted">Posição em {diaMes(I.ref)} · vencimentos de {ano} nos quadros; todos os anos no fim da aba.</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo={`Vencido em aberto (${ano})`} valor={brl(I.total)} nota={`${I.n} títulos · ${I.clientes} clientes`} tom={I.total > 0 ? "negativo" : undefined} />
        <Kpi
          rotulo="Inadimplência"
          valor={inadimplencia === null ? "—" : pct(inadimplencia)}
          nota={`Vencido em ${ano} ÷ faturado no ano`}
          tom={inadimplencia !== null && inadimplencia > 5 ? "negativo" : undefined}
        />
        <Kpi rotulo="Concentração top 5" valor={I.total ? `${Math.round((I.top5 / I.total) * 100)}%` : "—"} nota={`${brl(I.top5)} nos 5 maiores`} />
        <Kpi rotulo="A vencer" valor={brl(I.avencer)} nota={`Em aberto ainda no prazo (venc. ${ano})`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Secao titulo="Aging por mês de vencimento" dica="Títulos vencidos em aberto, pelo mês em que venceram.">
          {I.pormes.length ? <Colunas itens={I.pormes.map((p) => ({ rotulo: nomeMes(p.mes), valor: p.valor }))} /> : <p className="text-sm text-fg-muted">Nada vencido em {ano}.</p>}
        </Secao>
        <Secao titulo="Faixas de atraso">
          <div className="space-y-3">
            {I.faixas.map((f) => (
              <div key={f.faixa}>
                <div className="flex justify-between text-sm">
                  <span>{f.faixa.replace(/^\d\) /, "")}</span>
                  <b className="tabular-nums">{brl(f.valor)}</b>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <i className="block h-full rounded-full bg-serie-2" style={{ width: `${I.total ? (f.valor / I.total) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-fg-muted">{f.n} títulos · {I.total ? pct((f.valor / I.total) * 100) : "—"}</span>
              </div>
            ))}
          </div>
        </Secao>
      </div>

      <Secao
        titulo={`Maiores devedores em ${ano} (${devVisiveis.length} de ${devedores.length})`}
        dica={`Com o vencido de todos os anos ao lado (mostra se o cliente também deve de antes de ${ano}). Clique numa coluna para ordenar.`}
        acoes={
          <>
            {devedores.length > 15 ? <BotaoLeve onClick={() => setTodosDev(!todosDev)}>{todosDev ? "Só os 15 maiores" : `Mostrar todos (${devedores.length})`}</BotaoLeve> : null}
            <BotaoLeve onClick={exportarDevedores}>Exportar Excel</BotaoLeve>
          </>
        }
      >
        <div className={tab.wrap}>
          <table className={tab.table}>
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th key={c.col} className={c.col === "cliente" ? tab.th : tab.thR} aria-sort={ordem.col === c.col ? (ordem.dir > 0 ? "ascending" : "descending") : undefined}>
                    <button type="button" onClick={() => ordenar(c.col)} className="uppercase tracking-wider hover:text-fg">
                      {c.rotulo}
                      {ordem.col === c.col ? (ordem.dir > 0 ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devVisiveis.map((c) => (
                <tr key={c.cliente}>
                  <td className={clsx(tab.td, "max-w-64 truncate font-medium")} title={c.cliente}>{c.cliente}</td>
                  <td className={clsx(tab.tdR, "font-semibold text-danger")}>{brl(c.valor)}</td>
                  <td className={tab.tdR}>{c.n}</td>
                  <td className={clsx(tab.tdR, c.dias > 90 && "text-danger")}>{c.dias} dias</td>
                  <td className={clsx(tab.tdR, "text-fg-muted")}>{c.antigo.split("-").reverse().join("/")}</td>
                  <td className={clsx(tab.tdR, "text-fg-muted")}>{pct(c.pct)}</td>
                  <td className={clsx(tab.tdR, "font-semibold", c.extra > 0 && "text-danger")}>{brl(c.vencidoTotal)}</td>
                  <td className={tab.tdR}>{c.titulosTotal}</td>
                  <td className={clsx(tab.tdR, c.extra > 0 ? "text-danger" : "text-fg-muted")}>{c.extra > 0 ? brl(c.extra) : "—"}</td>
                </tr>
              ))}
              {devVisiveis.length === 0 ? <tr><td colSpan={9} className={clsx(tab.td, "text-fg-muted")}>Nenhum cliente com título vencido em {ano}.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Secao>

      {I.cxm.length ? (
        <Secao
          titulo={`Cliente × mês de vencimento em ${ano} (${cxVisiveis.length} de ${I.cxm.length})`}
          dica="Saldos vencidos em aberto por mês de vencimento."
          acoes={
            <>
              {I.cxm.length > 15 ? <BotaoLeve onClick={() => setTodosCx(!todosCx)}>{todosCx ? "Só os 15 maiores" : `Mostrar todos (${I.cxm.length})`}</BotaoLeve> : null}
              <BotaoLeve onClick={exportarCx}>Exportar Excel</BotaoLeve>
            </>
          }
        >
          <div className={tab.wrap}>
            <table className={tab.table}>
              <thead>
                <tr>
                  <th className={tab.th}>Cliente</th>
                  {I.meses.map((m) => <th key={m} className={tab.thR}>{nomeMes(m)}</th>)}
                  <th className={tab.thR}>Total</th>
                </tr>
              </thead>
              <tbody>
                {cxVisiveis.map((c) => (
                  <tr key={c.cliente}>
                    <td className={clsx(tab.td, "max-w-64 truncate font-medium")} title={c.cliente}>{c.cliente}</td>
                    {I.meses.map((m) => {
                      const v = Number(c[m] ?? 0);
                      return <td key={m} className={clsx(tab.tdR, "text-xs", !v && "text-fg-subtle")}>{v ? k(v) : "—"}</td>;
                    })}
                    <td className={clsx(tab.tdR, "text-xs font-semibold")}>{k(c.tot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
        <Secao
          titulo="Recuperação por faixa de atraso"
          dica={`Vencido de todos os anos: ${brl(X.vencidoTotal)} em ${X.nTotal} títulos · ${brl(X.legado)} são de antes de ${ano}. Taxa = parte do que atrasou além da faixa e foi recebido nos últimos 12 meses.`}
        >
          <div className={tab.wrap}>
            <table className={tab.table}>
              <thead>
                <tr>
                  <th className={tab.th}>Atraso</th>
                  <th className={tab.thR}>Taxa</th>
                  <th className={tab.thR}>Vencido</th>
                  <th className={tab.thR}>Esperado</th>
                </tr>
              </thead>
              <tbody>
                {X.recuperacao.map((r) => (
                  <tr key={r.faixa}>
                    <td className={tab.td}>{r.faixa} dias</td>
                    <td className={tab.tdR}>{pct(r.taxa * 100)}</td>
                    <td className={tab.tdR}>{brl(r.vencidoTotal)}</td>
                    <td className={tab.tdR}>{brl(r.esperadoTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
        <Secao titulo="Reincidentes" dica="Clientes com atraso de mais de 15 dias em 3 meses ou mais dos últimos 12.">
          {X.reincidentes.length ? (
            <div className={tab.wrap}>
              <table className={tab.table}>
                <thead>
                  <tr>
                    <th className={tab.th}>Cliente</th>
                    <th className={tab.thR}>Meses</th>
                    <th className={tab.thR}>Atraso médio</th>
                    <th className={tab.thR}>Recebido/mês</th>
                    <th className={tab.thR}>Vencido</th>
                    <th className={tab.thR}>Contrato/mês</th>
                  </tr>
                </thead>
                <tbody>
                  {X.reincidentes.map((r) => (
                    <tr key={r.cliente}>
                      <td className={clsx(tab.td, "font-medium")}>{r.cliente}</td>
                      <td className={tab.tdR}>{r.meses}</td>
                      <td className={tab.tdR}>{r.atrasoMedio} dias</td>
                      <td className={tab.tdR}>{brl(r.recebidoMes)}</td>
                      <td className={clsx(tab.tdR, r.vencido > 0 && "text-danger")}>{r.vencido > 0 ? brl(r.vencido) : "—"}</td>
                      <td className={clsx(tab.tdR, "text-fg-muted")}>{r.mrr > 0 ? brl(r.mrr) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Nenhum cliente reincidente.</p>
          )}
        </Secao>
      </div>
    </div>
  );
}
