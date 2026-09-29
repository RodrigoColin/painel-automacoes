"use client";

import { Card } from "@/components/ui";
import { clsx } from "@/lib/clsx";

export function Secao({
  titulo,
  dica,
  acoes,
  className,
  children,
}: {
  titulo: React.ReactNode;
  dica?: React.ReactNode;
  acoes?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={clsx("flex flex-col gap-4 p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">{titulo}</h2>
          {dica ? <p className="text-xs text-fg-muted">{dica}</p> : null}
        </div>
        {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
      </div>
      {children}
    </Card>
  );
}

export function Kpi({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string;
  valor: string;
  nota?: React.ReactNode;
  tom?: "negativo" | "positivo";
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{rotulo}</span>
      <span
        className={clsx(
          "text-2xl font-semibold",
          tom === "negativo" && "text-danger",
          tom === "positivo" && "text-success",
        )}
      >
        {valor}
      </span>
      {nota ? <span className="text-xs text-fg-muted">{nota}</span> : null}
    </Card>
  );
}

export function Segmentado<T extends string>({
  rotulo,
  opcoes,
  valor,
  onMudar,
}: {
  rotulo: string;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  onMudar: (valor: T) => void;
}) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={o.valor === valor}
          onClick={() => onMudar(o.valor)}
          className={clsx(
            "h-8 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o.valor === valor ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

export function BotaoLeve(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        "inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        props.className,
      )}
    />
  );
}

/** Classes das tabelas da tela (densas, números alinhados à direita). */
export const tab = {
  wrap: "overflow-x-auto",
  table: "w-full border-collapse text-sm",
  th: "border-b border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle whitespace-nowrap",
  thR: "border-b border-border px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle whitespace-nowrap",
  td: "border-b border-border px-3 py-2 align-top",
  tdR: "border-b border-border px-3 py-2 text-right tabular-nums whitespace-nowrap",
};

export const tomValor = (v: number) => (v < 0 ? "text-danger" : "");
