"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";

export function Toggle({
  defaultChecked = false,
  checked: checkedProp,
  onChange,
  label,
  disabled = false,
}: {
  defaultChecked?: boolean;
  /** Informe junto de `onChange` para usar o toggle de forma controlada. */
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const [interno, setInterno] = useState(defaultChecked);
  const controlado = checkedProp !== undefined;
  const checked = controlado ? checkedProp : interno;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!controlado) setInterno((v) => !v);
        onChange?.(!checked);
      }}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "border-accent bg-accent" : "border-border-strong bg-surface-muted"
      )}
    >
      <span
        className={clsx(
          "size-3.5 rounded-full bg-surface shadow-sm transition-transform",
          checked ? "translate-x-4.5 bg-accent-fg" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
