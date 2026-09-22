"use client";

import { useMemo, useState } from "react";
import { Badge, Card, EmptyHint, StatCard } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { brl, brlInteiro } from "@/lib/omie/formatacao";
import type { ContaFluxo, DiaFluxo, FluxoCaixa, MovimentoFluxo } from "@/lib/omie/fluxo-caixa";

/**
 * Visão diária do fluxo de caixa.
 *
 * Tudo aqui é apresentação: os números chegam prontos do servidor
 * (`lib/omie/fluxo-caixa.ts`). O horizonte e o dia selecionado são estado de
 * tela — trocar de 15 para 45 dias não consulta o Omie de novo.
 *
 * Cores: entradas em serie-1 e saídas em serie-2, como receber e pagar no
 * resto do painel. Vermelho e âmbar ficam só para estado (abaixo do mínimo).
 */

const HORIZONTES = [15, 30, 45] as const;
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * Valor compacto escrito à mão: a notação compacta do `Intl` sai diferente no
 * Node e no navegador ("mil" × "k"), e isso quebra a hidratação.
 */
function compacto(valor: number) {
  const absoluto = Math.abs(valor);
  const sinal = valor < 0 ? "−" : "";
  if (absoluto >= 1_000_000) return `${sinal}R$ ${(absoluto / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (absoluto >= 1_000) return `${sinal}R$ ${Math.round(absoluto / 1_000)}k`;
  return `${sinal}R$ ${Math.round(absoluto)}`;
}

const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const rotuloDia = (iso: string) => `${SEMANA[diaDaSemana(iso)]}, ${diaMes(iso)}`;

export function FluxoCaixaDiario({ fluxo }: { fluxo: FluxoCaixa }) {
  const [horizonte, setHorizonte] = useState<(typeof HORIZONTES)[number]>(30);
  const [selecionado, setSelecionado] = useState(fluxo.hoje);
  const [tipoTitulos, setTipoTitulos] = useState<"todos" | "receber" | "pagar">("todos");

  const dias = useMemo(() => {
    const indiceHoje = fluxo.dias.findIndex((d) => d.data === fluxo.hoje);
    return fluxo.dias.slice(0, indiceHoje + horizonte + 1);
  }, [fluxo, horizonte]);

  const futuros = dias.filter((d) => d.tipo !== "realizado");
  const entradas = futuros.reduce((soma, d) => soma + d.entradas, 0);
  const saidas = futuros.reduce((soma, d) => soma + d.saidas, 0);
  const pior = futuros.reduce((menor, d) => (d.saldo < menor.saldo ? d : menor), futuros[0]);
  const ultimo = dias[dias.length - 1];
  const minimo = fluxo.saldoMinimo;
  const abaixo = minimo !== null && pior.saldo < minimo;

  const noCaixa = useMemo(
    () => new Set(fluxo.contas.filter((c) => c.somaNoCaixa).map((c) => c.codigo)),
    [fluxo.contas],
  );
  const diaSelecionado = dias.find((d) => d.data === selecionado) ?? dias.find((d) => d.tipo === "hoje")!;
  const movimentosDoDia = fluxo.movimentos.filter(
    (m) => m.data === diaSelecionado.data && noCaixa.has(m.conta),
  );

  const limiteSemana = fluxo.dias[fluxo.dias.findIndex((d) => d.data === fluxo.hoje) + 7]?.data ?? ultimo.data;
  const titulos = fluxo.movimentos
    .filter((m) => !m.realizado && m.data >= fluxo.hoje && m.data <= limiteSemana && noCaixa.has(m.conta))
    .filter((m) => tipoTitulos === "todos" || (tipoTitulos === "receber") === m.valor > 0)
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
    .slice(0, 12);

  return (
    <div className="space-y-5">
      {abaixo ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning"
        >
          <strong className="font-semibold">Atenção ao caixa em {rotuloDia(pior.data)}.</strong>
          <span>
            O saldo projetado chega a <span className="tabular-nums">{brlInteiro.format(pior.saldo)}</span>, abaixo do
            saldo mínimo de <span className="tabular-nums">{brlInteiro.format(minimo)}</span>. Faltam{" "}
            <span className="font-semibold tabular-nums">{brlInteiro.format(minimo - pior.saldo)}</span>.
          </span>
        </div>
      ) : null}

      {fluxo.avisos.map((aviso) => (
        <p key={aviso} className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-fg-muted">
          {aviso}
        </p>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          {diaMes(dias[0].data)} a {diaMes(ultimo.data)} · realizado até ontem, previsto de hoje em diante · pela data
          em que o dinheiro entra ou sai da conta
        </p>
        <div role="group" aria-label="Horizonte" className="flex rounded-md border border-border bg-surface p-0.5">
          {HORIZONTES.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={h === horizonte}
              onClick={() => setHorizonte(h)}
              className={clsx(
                "h-8 rounded px-3 text-xs font-medium tabular-nums transition-colors",
                h === horizonte ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-muted",
              )}
            >
              {h} dias
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Caixa próprio hoje" value={brlInteiro.format(fluxo.caixaProprio)} hint="Contas e aplicações de liquidez imediata" />
        <StatCard label="Entradas previstas" value={brlInteiro.format(entradas)} hint={`De hoje a ${diaMes(ultimo.data)}`} />
        <StatCard label="Saídas previstas" value={brlInteiro.format(saidas)} hint={`De hoje a ${diaMes(ultimo.data)}`} />
        <StatCard label="Saldo projetado final" value={brlInteiro.format(ultimo.saldo)} hint={`Em ${rotuloDia(ultimo.data)}`} />
        <Card className={clsx("p-4", abaixo && "border-danger/50")}>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Menor saldo do período</p>
          <p className={clsx("mt-2 text-2xl font-semibold tabular-nums", (abaixo || pior.saldo < 0) && "text-danger")}>
            {brlInteiro.format(pior.saldo)}
          </p>
          <p className="mt-1 text-xs text-fg-muted">Ocorre em {rotuloDia(pior.data)}</p>
        </Card>
      </div>

      <Contas fluxo={fluxo} />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold">Evolução diária do saldo</h2>
            <p className="text-xs text-fg-muted">Caixa próprio no fim de cada dia.</p>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-serie-1" />Realizado</li>
            <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-serie-1" />Previsto</li>
            {minimo !== null ? (
              <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-warning" />Saldo mínimo</li>
            ) : null}
          </ul>
        </div>
        <GraficoSaldo dias={dias} hoje={fluxo.hoje} minimo={minimo} pior={pior} selecionado={diaSelecionado.data} />
      </Card>

      <Card className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold">Entradas e saídas por dia</h2>
              <p className="text-xs text-fg-muted">Clique em um dia para ver o que compõe o movimento.</p>
            </div>
            <ul className="flex gap-4 text-xs text-fg-muted">
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-serie-1" />Entradas</li>
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-serie-2" />Saídas</li>
            </ul>
          </div>
          <Barras dias={dias} selecionado={diaSelecionado.data} aoSelecionar={setSelecionado} />
        </div>
        <DetalheDoDia dia={diaSelecionado} movimentos={movimentosDoDia} />
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold">Entra e sai nos próximos 7 dias</h2>
            <p className="text-xs text-fg-muted">
              Maiores valores previstos, já líquidos de retenções, pela data em que caem na conta.
            </p>
          </div>
          <div role="group" aria-label="Tipo" className="flex rounded-md border border-border bg-surface p-0.5">
            {(["todos", "receber", "pagar"] as const).map((tipo) => (
              <button
                key={tipo}
                type="button"
                aria-pressed={tipo === tipoTitulos}
                onClick={() => setTipoTitulos(tipo)}
                className={clsx(
                  "h-8 rounded px-3 text-xs font-medium transition-colors",
                  tipo === tipoTitulos ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-muted",
                )}
              >
                {tipo === "todos" ? "Todos" : tipo === "receber" ? "A receber" : "A pagar"}
              </button>
            ))}
          </div>
        </div>
        {titulos.length === 0 ? (
          <EmptyHint>Nada previsto para os próximos 7 dias.</EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  <th className="border-b border-border py-2 pr-3">Cai na conta</th>
                  <th className="border-b border-border py-2 pr-3">Vencimento</th>
                  <th className="border-b border-border py-2 pr-3">Cliente / fornecedor</th>
                  <th className="border-b border-border py-2 pr-3">Categoria</th>
                  <th className="border-b border-border py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {titulos.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap border-b border-border py-2.5 pr-3 font-medium tabular-nums">{rotuloDia(m.data)}</td>
                    <td className="border-b border-border py-2.5 pr-3 tabular-nums text-fg-muted">
                      {m.vencimento ? diaMes(m.vencimento) : "—"}
                    </td>
                    <td className="max-w-[18rem] truncate border-b border-border py-2.5 pr-3">{m.nome}</td>
                    <td className="border-b border-border py-2.5 pr-3 text-fg-muted">{m.categoria}</td>
                    <td
                      className={clsx(
                        "border-b border-border py-2.5 text-right font-medium tabular-nums",
                        m.valor < 0 && "text-fg-muted",
                      )}
                    >
                      {m.valor < 0 ? "−" : "+"}
                      {brl.format(Math.abs(m.valor))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------- Contas -------------------------------- */

function Contas({ fluxo }: { fluxo: FluxoCaixa }) {
  const temGarantida = fluxo.contas.some((c) => c.tipo === "garantida");
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-semibold">Posição por conta hoje</h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
          <div className="flex gap-1.5">
            <dt>Caixa próprio</dt>
            <dd className="font-semibold tabular-nums text-fg">{brl.format(fluxo.caixaProprio)}</dd>
          </div>
          {temGarantida ? (
            <>
              <div className="flex gap-1.5">
                <dt>Limite de crédito livre</dt>
                <dd className="font-semibold tabular-nums text-fg">{brl.format(fluxo.limiteLivre)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Liquidez total</dt>
                <dd className="font-semibold tabular-nums text-fg">
                  {brl.format(fluxo.caixaProprio + fluxo.limiteLivre)}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {fluxo.contas.map((conta) => (
          <CartaoConta key={conta.codigo} conta={conta} hoje={fluxo.hoje} />
        ))}
      </div>
    </Card>
  );
}

function CartaoConta({ conta, hoje }: { conta: ContaFluxo; hoje: string }) {
  const papel =
    conta.tipo === "garantida"
      ? "Dívida · não soma no caixa"
      : conta.tipo === "aplicacao"
        ? conta.somaNoCaixa
          ? "Aplicação · soma no caixa"
          : "Aplicação sem liquidez · não soma"
        : "Conta corrente";
  const uso = conta.tipo === "garantida" && conta.limite > 0 ? Math.min(1, Math.max(0, -conta.saldo) / conta.limite) : null;

  // Conciliação em dia: conciliado até pelo menos dois dias corridos atrás.
  const atraso = conta.conciliadoAte
    ? Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${conta.conciliadoAte}T12:00:00Z`)) / 86_400_000)
    : null;

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted/50 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium" title={conta.descricao}>
          {conta.descricao}
        </p>
        {conta.conciliadoAte ? (
          <Badge tone={atraso !== null && atraso > 4 ? "warning" : "success"} className="shrink-0 tabular-nums">
            Conciliado até {diaMes(conta.conciliadoAte)}
          </Badge>
        ) : (
          <Badge tone="outline" className="shrink-0">Sem conciliação</Badge>
        )}
      </div>
      <p className={clsx("text-xl font-semibold tabular-nums", conta.saldo < 0 && "text-danger", !conta.somaNoCaixa && conta.saldo >= 0 && "text-fg-muted")}>
        {brl.format(conta.saldo)}
      </p>
      {uso !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-serie-2" style={{ width: `${uso * 100}%` }} />
        </div>
      ) : null}
      <p className="text-xs text-fg-muted">
        {papel}
        {uso !== null ? ` · limite ${brlInteiro.format(conta.limite)} · uso ${Math.round(uso * 100)}%` : ""}
        {conta.pendentesConciliacao > 0
          ? ` · ${conta.pendentesConciliacao} lançamento${conta.pendentesConciliacao > 1 ? "s" : ""} a conciliar`
          : ""}
      </p>
    </div>
  );
}

/* ------------------------------ Gráfico do saldo ------------------------- */

function GraficoSaldo({
  dias,
  hoje,
  minimo,
  pior,
  selecionado,
}: {
  dias: DiaFluxo[];
  hoje: string;
  minimo: number | null;
  pior: DiaFluxo;
  selecionado: string;
}) {
  const L = 1000;
  const A = 260;
  const valores = dias.map((d) => d.saldo).concat(minimo ?? [], 0);
  let menor = Math.min(...valores);
  let maior = Math.max(...valores);
  const folga = (maior - menor || 1) * 0.12;
  menor -= folga;
  maior += folga;

  const x = (i: number) => (i / Math.max(1, dias.length - 1)) * L;
  const y = (v: number) => (1 - (v - menor) / (maior - menor)) * A;
  const linha = (trecho: { d: DiaFluxo; i: number }[]) =>
    trecho.map(({ d, i }, n) => `${n ? "L" : "M"}${x(i).toFixed(1)} ${y(d.saldo).toFixed(1)}`).join(" ");

  const indexados = dias.map((d, i) => ({ d, i }));
  const indiceHoje = dias.findIndex((d) => d.data === hoje);
  const indicePior = dias.findIndex((d) => d.data === pior.data);
  const indiceSel = dias.findIndex((d) => d.data === selecionado);
  const marcas = [0, 1, 2, 3, 4].map((n) => menor + ((maior - menor) / 4) * n);
  const passo = dias.length > 40 ? 7 : dias.length > 25 ? 4 : 2;

  return (
    <div>
      <div className="relative ml-14 h-[260px]">
        {marcas.map((valor) => (
          <div key={valor} className="absolute inset-x-0" style={{ top: `${(y(valor) / A) * 100}%` }}>
            <div className="border-t border-border/70" />
            <span className="absolute -left-14 -top-2 w-12 text-right text-[11px] tabular-nums text-fg-subtle">
              {compacto(valor)}
            </span>
          </div>
        ))}
        <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path d={`M0 ${y(0)} L${L} ${y(0)}`} className="stroke-border-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none" />
          {minimo !== null ? (
            <path d={`M0 ${y(minimo)} L${L} ${y(minimo)}`} className="stroke-warning" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" fill="none" />
          ) : null}
          {indiceSel >= 0 ? (
            <path d={`M${x(indiceSel)} 0 L${x(indiceSel)} ${A}`} className="stroke-border-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none" />
          ) : null}
          <path d={linha(indexados.slice(0, indiceHoje + 1))} className="stroke-serie-1" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />
          <path d={linha(indexados.slice(indiceHoje))} className="stroke-serie-1" strokeWidth="2.5" strokeDasharray="7 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        <Marcador esquerda={x(indiceHoje) / L} topo={y(dias[indiceHoje].saldo) / A} className="bg-serie-1" />
        <Marcador esquerda={x(indicePior) / L} topo={y(pior.saldo) / A} className="border-2 border-danger bg-surface" />
        <p
          className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded bg-fg px-2 py-1 text-[11px] text-bg"
          style={{
            left: `${Math.min(88, Math.max(12, (x(indicePior) / L) * 100))}%`,
            top: `${Math.min(86, (y(pior.saldo) / A) * 100 + 5)}%`,
          }}
        >
          Menor saldo <span className="tabular-nums">{brlInteiro.format(pior.saldo)}</span> · {diaMes(pior.data)}
        </p>
      </div>
      <div className="relative ml-14 mt-2 h-4">
        {dias.map((d, i) =>
          i % passo === 0 ? (
            <span
              key={d.data}
              className={clsx(
                "absolute -translate-x-1/2 text-[11px] tabular-nums text-fg-subtle",
                (i / passo) % 2 === 1 && "hidden sm:inline",
              )}
              style={{ left: `${(x(i) / L) * 100}%` }}
            >
              {diaMes(d.data)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Marcador({ esquerda, topo, className }: { esquerda: number; topo: number; className: string }) {
  return (
    <span
      className={clsx("absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full", className)}
      style={{ left: `${esquerda * 100}%`, top: `${topo * 100}%` }}
    />
  );
}

/* --------------------------------- Barras -------------------------------- */

function Barras({
  dias,
  selecionado,
  aoSelecionar,
}: {
  dias: DiaFluxo[];
  selecionado: string;
  aoSelecionar: (data: string) => void;
}) {
  const teto = Math.max(1, ...dias.map((d) => Math.max(d.entradas, d.saidas)));
  return (
    <div className="overflow-x-auto">
      <div className="flex" style={{ minWidth: `${dias.length * 18}px` }}>
        {dias.map((d) => {
          const fimDeSemana = diaDaSemana(d.data) % 6 === 0;
          const diaUm = d.data.endsWith("-01");
          return (
            <button
              key={d.data}
              type="button"
              aria-pressed={d.data === selecionado}
              aria-label={`${rotuloDia(d.data)}: entradas ${brlInteiro.format(d.entradas)}, saídas ${brlInteiro.format(d.saidas)}`}
              onClick={() => aoSelecionar(d.data)}
              className={clsx(
                "flex min-w-0 flex-1 flex-col items-center rounded px-px pb-1 transition-colors",
                d.data === selecionado ? "bg-surface-muted" : "hover:bg-surface-muted/60",
              )}
            >
              <span className="flex h-24 w-full items-end justify-center">
                <span
                  className={clsx("w-[70%] max-w-4 rounded-t-sm bg-serie-1", d.tipo === "realizado" && "opacity-70")}
                  style={{ height: `${(d.entradas / teto) * 100}%` }}
                />
              </span>
              <span className="h-px w-full bg-border-strong" />
              <span className="flex h-24 w-full items-start justify-center">
                <span
                  className={clsx("w-[70%] max-w-4 rounded-b-sm bg-serie-2", d.tipo === "realizado" && "opacity-70")}
                  style={{ height: `${(d.saidas / teto) * 100}%` }}
                />
              </span>
              <span
                className={clsx(
                  "mt-1.5 text-[10px] tabular-nums",
                  d.tipo === "hoje" ? "font-bold text-accent" : fimDeSemana ? "text-fg-subtle" : "text-fg-muted",
                )}
              >
                {d.data.slice(8, 10)}
              </span>
              <span className="h-3 text-[9px] text-fg-subtle">{diaUm ? MESES[Number(d.data.slice(5, 7)) - 1] : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetalheDoDia({ dia, movimentos }: { dia: DiaFluxo; movimentos: MovimentoFluxo[] }) {
  return (
    <aside className="space-y-3 rounded-md border border-border bg-surface-muted/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{rotuloDia(dia.data)}</h3>
        <Badge tone={dia.tipo === "hoje" ? "strong" : dia.tipo === "realizado" ? "success" : "neutral"}>
          {dia.tipo === "hoje" ? "Hoje" : dia.tipo === "realizado" ? "Realizado" : "Previsto"}
        </Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-fg-muted">Entradas</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{compacto(dia.entradas)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Saídas</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{compacto(dia.saidas)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Saldo final</dt>
          <dd className={clsx("mt-0.5 text-sm font-semibold tabular-nums", dia.saldo < 0 && "text-danger")}>
            {compacto(dia.saldo)}
          </dd>
        </div>
      </dl>
      <div className="border-t border-border" />
      {movimentos.length === 0 ? (
        <p className="text-xs text-fg-muted">Sem movimento neste dia.</p>
      ) : (
        <ul className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
          {movimentos.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5">
              <span className={clsx("size-2 shrink-0 rounded-full", m.valor > 0 ? "bg-serie-1" : "bg-serie-2")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium" title={m.nome}>{m.nome}</span>
                <span className="block truncate text-[11px] text-fg-muted">
                  {m.categoria}
                  {m.realizado ? "" : " · previsto"}
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-medium tabular-nums">
                {m.valor < 0 ? "−" : "+"}
                {brlInteiro.format(Math.abs(m.valor))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
