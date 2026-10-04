"use client";

import { clsx } from "@/lib/clsx";
import { brl, diaMes, k, nomeMes, pct, type LinhaMensal } from "@/lib/fluxo-caixa/calculos";
import type { Extra, Extrato, LinhaReceita } from "@/lib/fluxo-caixa/tipos";
import { BarrasMensais, GraficoSaldo } from "@/components/fluxo-caixa/graficos";
import { Kpi, Secao, tab } from "@/components/fluxo-caixa/pecas";

/** Linhas de receita na ordem da configuração; "Outras receitas" sempre por último, em cinza. */
const CORES_LINHA = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)"];

export function AbaMensal({
  extrato,
  extra,
  mensal,
  linhasReceita,
  limite,
  minimo,
}: {
  extrato: Extrato;
  extra: Extra;
  mensal: LinhaMensal[];
  linhasReceita: LinhaReceita[];
  limite: number;
  minimo: number | null;
}) {
  if (!mensal.length) return null;
  const ano = String(extra.ano).slice(2);
  const dezembro = mensal[mensal.length - 1];
  const pior = mensal.reduce((m, l) => (l.acum < m.acum ? l : m), mensal[0]);
  const fechados = mensal.filter((l) => l.status === "fechado" && l.fat > 0);
  const soma = (ls: LinhaMensal[], f: (l: LinhaMensal) => number) => ls.reduce((s, l) => s + f(l), 0);
  const recMedio = fechados.length ? (soma(fechados, (l) => l.ent) / soma(fechados, (l) => l.fat)) * 100 : null;
  const ultimos3 = fechados.slice(-3);
  const rec3 = ultimos3.length ? (soma(ultimos3, (l) => l.ent) / soma(ultimos3, (l) => l.fat)) * 100 : null;
  const iAtual = mensal.findIndex((l) => l.status === "em_curso");

  const FL = extra.faturamentoPorLinha;
  const preferida = [...linhasReceita.map((l) => l.nome), "Receita recorrente"];
  const ordem = [...new Set([...preferida.filter((n) => n in FL.linhas), ...Object.keys(FL.linhas).filter((n) => n !== "Outras receitas"), ...("Outras receitas" in FL.linhas ? ["Outras receitas"] : [])])];
  const corLinha = (nome: string, i: number) => (nome === "Outras receitas" ? "var(--fg-subtle)" : CORES_LINHA[i % CORES_LINHA.length]);
  const totalMes = FL.meses.map((_, i) => ordem.reduce((s, n) => s + (FL.linhas[n][i] ?? 0), 0));
  const maxMes = Math.max(1, ...totalMes);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-fg-muted">
        {fechados.length ? `Jan a ${nomeMes(fechados[fechados.length - 1].mes)} realizado · ` : ""}
        {iAtual >= 0 ? `${nomeMes(mensal[iAtual].mes)} em curso · ` : ""}demais meses projetados
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi rotulo="Caixa próprio hoje" valor={brl(extrato.caixaProprio)} nota={diaMes(extrato.hoje)} />
        <Kpi rotulo="Saldo previsto fim do ano" valor={brl(dezembro.acum)} nota={`Dezembro/${ano}`} tom={dezembro.acum < 0 ? "negativo" : undefined} />
        <Kpi rotulo="Menor saldo projetado" valor={brl(pior.acum)} nota={`Fim de ${nomeMes(pior.mes)}`} tom={pior.acum < (minimo ?? 0) ? "negativo" : undefined} />
        <Kpi
          rotulo={limite > 0 ? "Margem até o limite" : "Limite da conta"}
          valor={limite > 0 ? brl(pior.acum + limite) : "—"}
          nota={limite > 0 ? "No pior fechamento do ano" : "Sem limite cadastrado"}
          tom={limite > 0 && pior.acum + limite < 0 ? "negativo" : undefined}
        />
        <Kpi
          rotulo="Recebimento efetivo"
          valor={recMedio === null ? "—" : pct(recMedio)}
          nota="Entradas ÷ faturado, meses fechados do ano"
          tom={recMedio !== null && recMedio < 90 ? "negativo" : undefined}
        />
      </div>

      <Secao
        titulo={`Entradas, saídas e saldo do mês — ${extra.ano}`}
        dica="Barras mais claras = meses projetados (fluxo diário, títulos em aberto e, se ligada, a regra do dashboard). A linha é o saldo do mês (entradas − saídas)."
        acoes={
          <div className="flex gap-3 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-serie-1" />Entradas</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-serie-2" />Saídas</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-fg" />Saldo do mês</span>
          </div>
        }
      >
        <BarrasMensais meses={mensal.map((l) => ({ rotulo: nomeMes(l.mes), ent: l.ent, sai: l.sai, saldo: l.saldo, projetado: l.status === "projetado" }))} />
      </Secao>

      <Secao titulo="Caixa acumulado no fim de cada mês" dica={limite > 0 ? `Contra o limite das contas (${brl(limite)}).` : undefined}>
        <GraficoSaldo
          pontos={mensal.map((l) => ({ rotulo: nomeMes(l.mes), valor: l.acum, previsto: l.status === "projetado", titulo: `Fim de ${nomeMes(l.mes)}` }))}
          indiceAtual={iAtual}
          limite={limite}
          minimo={minimo}
          altura={200}
        />
      </Secao>

      <Secao
        titulo="Detalhe mês a mês"
        dica={`Recebimento efetivo = entradas ÷ faturado do mês.${limite > 0 ? ` Margem até o limite = caixa acumulado + ${brl(limite)}.` : ""}`}
      >
        <div className={tab.wrap}>
          <table className={tab.table}>
            <thead>
              <tr>
                <th className={tab.th}>Mês</th>
                <th className={tab.thR}>Faturado</th>
                <th className={tab.thR}>Entradas</th>
                <th className={tab.thR}>Saídas</th>
                <th className={tab.thR}>Receb. efetivo</th>
                <th className={tab.thR}>Saldo do mês</th>
                <th className={tab.thR}>Caixa acumulado</th>
                {limite > 0 ? <th className={tab.thR}>Margem até o limite</th> : null}
              </tr>
            </thead>
            <tbody>
              {[...mensal].reverse().map((l) => {
                const receb = l.fat > 0 ? l.ent / l.fat : null;
                return (
                  <tr key={l.mes}>
                    <td className={clsx(tab.td, "whitespace-nowrap font-medium")}>
                      {nomeMes(l.mes)}
                      {l.status !== "fechado" ? (
                        <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-normal text-fg-muted">
                          {l.status === "em_curso" ? "em curso" : "projetado"}
                        </span>
                      ) : null}
                    </td>
                    <td className={tab.tdR}>{brl(l.fat)}</td>
                    <td className={tab.tdR}>{brl(l.ent)}</td>
                    <td className={tab.tdR}>{brl(l.sai)}</td>
                    <td className={clsx(tab.tdR, receb !== null && receb < 0.9 && "text-danger")}>{receb === null ? "—" : pct(receb * 100)}</td>
                    <td className={clsx(tab.tdR, "font-semibold", l.saldo < 0 && "text-danger")}>{brl(l.saldo)}</td>
                    <td className={clsx(tab.tdR, "font-semibold", l.acum < 0 && "text-danger")}>{brl(l.acum)}</td>
                    {limite > 0 ? <td className={clsx(tab.tdR, l.acum + limite < 0 && "text-danger")}>{brl(l.acum + limite)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {recMedio !== null && rec3 !== null ? (
          <p className="text-xs text-fg-muted">
            Recebimento efetivo dos meses fechados: últimos 3 meses <b className="text-fg">{pct(rec3)}</b> · ano <b className="text-fg">{pct(recMedio)}</b>
          </p>
        ) : null}
      </Secao>

      {FL.meses.length && ordem.length ? (
        <Secao titulo="Faturamento por linha de receita" dica={`Títulos pelo mês de vencimento, jan/${ano} até o mês corrente.`}>
          <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
            {ordem.map((n, i) => (
              <span key={n} className="inline-flex items-center gap-1.5">
                <i className="size-2.5 rounded-[3px]" style={{ background: corLinha(n, i) }} />
                {n}
              </span>
            ))}
          </div>
          <div className="flex h-44 items-end gap-2 border-b border-border-strong">
            {FL.meses.map((mes, im) => (
              <div key={mes} className="flex h-full flex-1 flex-col justify-end gap-0.5" title={`${nomeMes(mes)}: ${brl(totalMes[im])}`}>
                {ordem.map((n, i) => {
                  const v = FL.linhas[n][im] ?? 0;
                  return v > 0 ? (
                    <i key={n} className="block w-full first:rounded-t-[3px]" style={{ height: `${(v / maxMes) * 100}%`, background: corLinha(n, i) }} />
                  ) : null;
                })}
              </div>
            ))}
          </div>
          <div className={tab.wrap}>
            <table className={tab.table}>
              <thead>
                <tr>
                  <th className={tab.th}>Linha</th>
                  {FL.meses.map((m) => <th key={m} className={tab.thR}>{nomeMes(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {ordem.map((n) => (
                  <tr key={n}>
                    <td className={clsx(tab.td, "whitespace-nowrap")}>{n}</td>
                    {FL.linhas[n].map((v, i) => <td key={i} className={clsx(tab.tdR, "text-xs")}>{v ? k(v) : "—"}</td>)}
                  </tr>
                ))}
                <tr className="bg-surface-muted/60 font-semibold">
                  <td className={clsx(tab.td, "whitespace-nowrap")}>Total</td>
                  {totalMes.map((v, i) => <td key={i} className={clsx(tab.tdR, "text-xs")}>{v ? k(v) : "—"}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </Secao>
      ) : null}
    </div>
  );
}
