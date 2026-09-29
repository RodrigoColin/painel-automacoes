"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { brl, diaMes, diaRotulo, k } from "@/lib/fluxo-caixa/calculos";

/* ------------------------------------------------------------------
   Gráficos da tela de fluxo de caixa, em SVG/CSS. Um eixo só por
   gráfico; grade em linha fina sólida; tracejado só para o que é
   projeção ou limite. Entradas = --serie-1, saídas = --serie-2.
   Todo valor também está numa tabela da mesma aba.
   ------------------------------------------------------------------ */

type Ponto = { rotulo: string; valor: number; previsto: boolean; titulo: string };

function escala(valores: number[], folga = 0.12) {
  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  const f = (hi - lo || 1) * folga;
  lo -= f;
  hi += f;
  return { lo, hi };
}

/**
 * Linha de saldo: trecho realizado sólido, previsto tracejado; limite da
 * conta e saldo mínimo como linhas de referência; o menor saldo marcado.
 */
export function GraficoSaldo({
  pontos,
  indiceAtual,
  limite,
  minimo,
  altura = 240,
  rotuloEixo = (p) => p.rotulo,
}: {
  pontos: Ponto[];
  /** Último ponto realizado (hoje / mês em curso); -1 se tudo é previsto. */
  indiceAtual: number;
  limite: number;
  minimo: number | null;
  altura?: number;
  rotuloEixo?: (p: Ponto) => string;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  if (pontos.length < 2) return null;

  const W = 1000;
  const A = altura;
  const topo = 16;
  const base = 8;
  const refs = [0, ...(limite > 0 ? [-limite] : []), ...(minimo !== null ? [minimo] : [])];
  const { lo, hi } = escala([...pontos.map((p) => p.valor), ...refs]);
  const X = (i: number) => (i / (pontos.length - 1)) * W;
  const Y = (v: number) => topo + (1 - (v - lo) / (hi - lo)) * (A - topo - base);
  const trecho = (de: number, ate: number) =>
    pontos
      .slice(de, ate + 1)
      .map((p, n) => `${n ? "L" : "M"}${X(de + n).toFixed(1)} ${Y(p.valor).toFixed(1)}`)
      .join(" ");
  // Menor saldo daqui para a frente (o passado já aconteceu).
  const inicioFuturo = Math.max(0, indiceAtual);
  const iPior = pontos.reduce((m, p, i) => (i >= inicioFuturo && p.valor < pontos[m].valor ? i : m), inicioFuturo);
  const ticks = [0, 1, 2, 3, 4].map((n) => lo + ((hi - lo) / 4) * n);
  const passo = pontos.length > 40 ? 7 : pontos.length > 25 ? 4 : pontos.length > 13 ? 2 : 1;
  const ativo = foco ?? iPior;

  return (
    <div>
      <div className="relative pl-14" style={{ height: A }}>
        {ticks.map((v) => (
          <div key={v} className="absolute inset-x-0 pl-14" style={{ top: Y(v) }}>
            <div className="border-t border-border" />
            <span className="absolute left-0 -translate-y-1/2 text-[10px] tabular-nums text-fg-subtle">{k(v)}</span>
          </div>
        ))}
        <svg viewBox={`0 0 ${W} ${A}`} preserveAspectRatio="none" className="absolute inset-y-0 left-14 right-0 h-full w-[calc(100%-3.5rem)] overflow-visible" aria-hidden="true">
          <path d={`${trecho(0, pontos.length - 1)} L${W} ${A} L0 ${A} Z`} fill="var(--serie-1)" opacity="0.08" />
          <path d={`M0 ${Y(0)} L${W} ${Y(0)}`} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {minimo !== null ? (
            <path d={`M0 ${Y(minimo)} L${W} ${Y(minimo)}`} stroke="var(--warning)" strokeWidth="1.5" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
          ) : null}
          {limite > 0 ? (
            <path d={`M0 ${Y(-limite)} L${W} ${Y(-limite)}`} stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          ) : null}
          {indiceAtual > 0 ? (
            <path d={trecho(0, indiceAtual)} stroke="var(--serie-1)" strokeWidth="2.5" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          ) : null}
          <path d={trecho(Math.max(0, indiceAtual), pontos.length - 1)} stroke="var(--serie-1)" strokeWidth="2" strokeDasharray="7 5" fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {ativo !== null ? (
            <path d={`M${X(ativo)} 0 L${X(ativo)} ${A}`} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        <div className="absolute inset-y-0 left-14 right-0">
          {indiceAtual >= 0 ? (
            <span
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-serie-1 ring-2 ring-surface"
              style={{ left: `${(X(indiceAtual) / W) * 100}%`, top: Y(pontos[indiceAtual].valor) }}
            />
          ) : null}
          <span
            className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-danger bg-surface"
            style={{ left: `${(X(iPior) / W) * 100}%`, top: Y(pontos[iPior].valor) }}
          />
          {ativo !== null ? (
            <span
              className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-sm"
              style={{
                left: `${Math.min(85, Math.max(15, (X(ativo) / W) * 100))}%`,
                top: Math.min(A - 40, Y(pontos[ativo].valor) + 10),
              }}
            >
              {ativo === iPior && foco === null ? "Menor saldo · " : ""}
              {pontos[ativo].titulo} · <b className="tabular-nums">{brl(pontos[ativo].valor)}</b>
            </span>
          ) : null}
          {/* Faixas de hover maiores que a marca, com foco por teclado. */}
          {pontos.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${p.titulo}: saldo ${brl(p.valor)}`}
              onMouseEnter={() => setFoco(i)}
              onMouseLeave={() => setFoco(null)}
              onFocus={() => setFoco(i)}
              onBlur={() => setFoco(null)}
              className="absolute inset-y-0 -translate-x-1/2 focus-visible:outline-none"
              style={{ left: `${(X(i) / W) * 100}%`, width: `${Math.max(100 / pontos.length, 1.5)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="relative ml-14 mt-1 h-4">
        {pontos.map((p, i) =>
          i % passo ? null : (
            <span key={i} className="absolute -translate-x-1/2 text-[10px] tabular-nums text-fg-subtle" style={{ left: `${(X(i) / W) * 100}%` }}>
              {rotuloEixo(p)}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/** Entradas para cima, saídas para baixo, um par por dia; clique seleciona o dia. */
export function BarrasDiarias({
  dias,
  selecionado,
  onSelecionar,
}: {
  dias: { data: string; entradas: number; saidas: number; tipo: string }[];
  selecionado: string;
  onSelecionar: (data: string) => void;
}) {
  const teto = Math.max(1, ...dias.map((d) => Math.max(d.entradas, d.saidas)));
  return (
    <div className="flex h-52 gap-0.5" role="group" aria-label="Entradas e saídas por dia">
      {dias.map((d) => {
        const fimDeSemana = [0, 6].includes(new Date(`${d.data}T12:00:00Z`).getUTCDay());
        const ativo = d.data === selecionado;
        return (
          <button
            key={d.data}
            type="button"
            aria-pressed={ativo}
            title={`${diaRotulo(d.data)} · entradas ${brl(d.entradas)} · saídas ${brl(d.saidas)}`}
            onClick={() => onSelecionar(d.data)}
            className={clsx(
              "group flex min-w-0 flex-1 flex-col rounded-sm px-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ativo ? "bg-surface-muted" : "hover:bg-surface-muted/60",
            )}
          >
            <span className="flex flex-1 items-end justify-center">
              <i
                className={clsx("block w-full max-w-3 rounded-t-[3px] bg-serie-1", d.tipo === "realizado" && "opacity-60")}
                style={{ height: `${(d.entradas / teto) * 100}%` }}
              />
            </span>
            <span className="h-px w-full bg-border-strong" />
            <span className="flex flex-1 items-start justify-center">
              <i
                className={clsx("block w-full max-w-3 rounded-b-[3px] bg-serie-2", d.tipo === "realizado" && "opacity-60")}
                style={{ height: `${(d.saidas / teto) * 100}%` }}
              />
            </span>
            <span
              className={clsx(
                "mt-1 text-center text-[9px] tabular-nums",
                d.tipo === "hoje" ? "font-semibold text-accent" : fimDeSemana ? "text-fg-subtle/60" : "text-fg-subtle",
              )}
            >
              {d.data.slice(8)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Entradas e saídas por mês (barras) com o saldo do mês (linha), no mesmo eixo em R$. */
export function BarrasMensais({
  meses,
}: {
  meses: { rotulo: string; ent: number; sai: number; saldo: number; projetado: boolean }[];
}) {
  const H = 240;
  const topo = Math.max(1, ...meses.map((m) => Math.max(m.ent, m.sai, m.saldo)));
  const piso = Math.min(0, ...meses.map((m) => m.saldo));
  const hi = topo * 1.06;
  const lo = piso < 0 ? piso * 1.15 : 0;
  const Y = (v: number) => 8 + ((hi - v) / (hi - lo)) * (H - 16);
  const y0 = Y(0);
  const cx = (i: number) => ((i + 0.5) / meses.length) * 100;
  const pontos = meses.map((m, i) => `${cx(i)},${Y(m.saldo).toFixed(1)}`).join(" ");

  return (
    <div>
      <div className="relative" style={{ height: H }}>
        <div className="absolute inset-x-0 border-t border-border-strong" style={{ top: y0 }} />
        <div className="absolute inset-0 flex">
          {meses.map((m) => (
            <div
              key={m.rotulo}
              className="relative flex-1"
              title={`${m.rotulo}: entradas ${brl(m.ent)} · saídas ${brl(m.sai)} · saldo do mês ${brl(m.saldo)}`}
            >
              <i
                className={clsx("absolute left-[16%] w-[32%] rounded-t-[3px] bg-serie-1", m.projetado && "opacity-50")}
                style={{ top: Y(m.ent), height: Math.max(y0 - Y(m.ent), 1) }}
              />
              <i
                className={clsx("absolute right-[16%] w-[32%] rounded-t-[3px] bg-serie-2", m.projetado && "opacity-50")}
                style={{ top: Y(m.sai), height: Math.max(y0 - Y(m.sai), 1) }}
              />
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <polyline points={pontos} fill="none" stroke="var(--fg)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {meses.map((m, i) => (
          <span
            key={m.rotulo}
            className={clsx(
              "pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface",
              m.saldo < 0 ? "bg-danger" : "bg-fg",
            )}
            style={{ left: `${cx(i)}%`, top: Y(m.saldo) }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex">
        {meses.map((m) => (
          <span key={m.rotulo} className="flex-1 text-center text-[10px] tabular-nums text-fg-subtle">
            {m.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Colunas simples de uma série (aging por mês de vencimento). */
export function Colunas({ itens }: { itens: { rotulo: string; valor: number }[] }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div>
      <div className="flex h-48 items-end gap-1 border-b border-border-strong">
        {itens.map((i) => (
          <div key={i.rotulo} className="flex h-full flex-1 flex-col items-center justify-end" title={`${i.rotulo}: ${brl(i.valor)}`}>
            <span className="mb-1 whitespace-nowrap text-[10px] tabular-nums text-fg-muted">{k(i.valor)}</span>
            <i className="block w-3/4 rounded-t-[3px] bg-serie-2" style={{ height: `${Math.max((i.valor / max) * 85, 1)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        {itens.map((i) => (
          <span key={i.rotulo} className="flex-1 text-center text-[10px] tabular-nums text-fg-subtle">
            {i.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}

export const rotuloDia = (p: { rotulo: string }) => diaMes(p.rotulo);
