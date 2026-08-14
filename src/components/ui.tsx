import { clsx } from "@/lib/clsx";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-border bg-surface",
        className
      )}
      {...props}
    />
  );
}

export type VarianteBotao = "primary" | "secondary" | "ghost";

/** Classes do botão, expostas para que um `<Link>` possa ter a mesma aparência. */
export function classesBotao(
  variant: VarianteBotao = "secondary",
  className?: string
) {
  return clsx(
    "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "disabled:pointer-events-none disabled:opacity-50",
    variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
    variant === "secondary" &&
      "border border-border bg-surface text-fg hover:bg-surface-muted",
    variant === "ghost" && "text-fg-muted hover:bg-surface-muted hover:text-fg",
    className
  );
}

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: VarianteBotao;
}) {
  return <button className={classesBotao(variant, className)} {...props} />;
}

/**
 * `success`, `warning` e `danger` são reservados para rótulos de estado —
 * o resto da interface permanece na escala neutra.
 */
export type ToneBadge =
  | "neutral"
  | "strong"
  | "outline"
  | "success"
  | "warning"
  | "danger";

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: ToneBadge;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-muted text-fg-muted",
        tone === "strong" && "bg-accent text-accent-fg",
        tone === "outline" && "border border-border-strong text-fg-muted",
        tone === "success" && "bg-success-bg text-success",
        tone === "warning" && "bg-warning-bg text-warning",
        tone === "danger" && "bg-danger-bg text-danger",
        className
      )}
      {...props}
    />
  );
}

export function Dot({
  level = "muted",
}: {
  /** `current` herda a cor do texto — usado dentro dos badges de estado. */
  level?: "on" | "off" | "muted" | "current";
}) {
  return (
    <span
      className={clsx(
        "size-1.5 shrink-0 rounded-full",
        level === "on" && "bg-fg",
        level === "off" && "bg-fg-subtle",
        level === "muted" && "bg-border-strong",
        level === "current" && "bg-current"
      )}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </Card>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          {children}
        </table>
      </div>
    </Card>
  );
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={clsx(
        "border-b border-border bg-surface-muted/60 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle",
        className
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={clsx("border-b border-border px-4 py-3 align-middle", className)}
      {...props}
    />
  );
}

export function SearchInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value?: string;
  onChange?: (valor: string) => void;
}) {
  return (
    <label className="relative flex-1 sm:max-w-xs">
      <span className="sr-only">{placeholder}</span>
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-4.3-4.3" strokeLinecap="round" />
      </svg>
    </label>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-fg-subtle">
      {children}
    </p>
  );
}
