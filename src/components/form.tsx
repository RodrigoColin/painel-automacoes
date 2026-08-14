import { Children } from "react";
import { clsx } from "@/lib/clsx";
import { Card } from "@/components/ui";
import { Toggle } from "@/components/toggle";

/* ------------------------------------------------------------------
   Primitivos de formulário compartilhados entre as telas de
   configuração e de criação de automação.
   ------------------------------------------------------------------ */

export const classesControle =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-ring";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(classesControle, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        classesControle,
        "h-auto min-h-24 py-2 font-mono text-xs leading-relaxed",
        className
      )}
      {...props}
    />
  );
}

type Opcao = string | { valor: string; rotulo: string };

export function Select({
  options,
  className,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  options: Opcao[];
}) {
  return (
    <select
      className={clsx(
        "h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
        className
      )}
      {...props}
    >
      {options.map((opcao) => {
        const { valor, rotulo } =
          typeof opcao === "string" ? { valor: opcao, rotulo: opcao } : opcao;
        return (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        );
      })}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  layout = "stacked",
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** `inline` alinha rótulo e controle lado a lado em telas largas. */
  layout?: "stacked" | "inline";
  children: React.ReactNode;
}) {
  return (
    <label
      className={clsx(
        layout === "inline"
          ? "grid gap-2 sm:grid-cols-[1fr_260px] sm:items-center sm:gap-4"
          : "block space-y-1.5"
      )}
    >
      <span>
        <span className="block text-sm font-medium">
          {label}
          {required ? (
            <span className="text-fg-subtle" aria-hidden="true">
              {" *"}
            </span>
          ) : null}
        </span>
        {hint ? <span className="block text-xs text-fg-subtle">{hint}</span> : null}
      </span>
      <span className="block space-y-1.5">
        {children}
        {error ? (
          <span role="alert" className="block text-xs font-medium text-fg">
            {error}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function SwitchField({
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
      </div>
      <Toggle
        label={label}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={onChange}
      />
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  // `Children.toArray` descarta null/false, então blocos condicionais não
  // deixam linhas vazias com separador dentro do card.
  const linhas = Children.toArray(children);

  return (
    <section className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-8">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-fg-muted">{description}</p>
      </div>
      <Card className="divide-y divide-border">
        {linhas.map((linha, i) => (
          <div key={i} className="p-4">
            {linha}
          </div>
        ))}
      </Card>
    </section>
  );
}
