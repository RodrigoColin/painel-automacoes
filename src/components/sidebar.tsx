"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { AlternadorTema } from "@/components/alternador-tema";
import { EmpresaSwitcher } from "@/components/empresa-switcher";
import { sair } from "@/app/(auth)/login/acoes";
import { iniciais, type Empresa } from "@/lib/tipos";
import {
  IconAutomacoes,
  IconClose,
  IconConfiguracoes,
  IconDashboard,
  IconHistorico,
  IconMenu,
  IconUsuarios,
} from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/automacoes", label: "Automações", icon: IconAutomacoes },
  { href: "/historico", label: "Histórico", icon: IconHistorico },
  { href: "/usuarios", label: "Usuários", icon: IconUsuarios },
  { href: "/configuracoes", label: "Configurações", icon: IconConfiguracoes },
];

export function Sidebar({
  empresas,
  empresaAtual,
  usuario,
}: {
  empresas: Empresa[];
  empresaAtual: Empresa | null;
  usuario: { nome: string; email: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Barra superior — apenas mobile */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="grid size-9 place-items-center rounded-md border border-border text-fg-muted hover:bg-surface-muted"
        >
          <IconMenu className="size-4.5" />
        </button>
        <EmpresaSwitcher empresas={empresas} empresaAtual={empresaAtual} />
      </div>

      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center gap-1 border-b border-border px-3">
          <EmpresaSwitcher
            empresas={empresas}
            empresaAtual={empresaAtual}
            onNavegar={() => setOpen(false)}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-muted lg:hidden"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Geral
          </p>
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-surface-muted font-medium text-fg"
                    : "text-fg-muted hover:bg-surface-muted hover:text-fg"
                )}
              >
                <Icon className="size-4.5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <AlternadorTema />

          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-medium text-fg-muted">
              {iniciais(usuario.nome) || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{usuario.nome}</p>
              <p className="truncate text-xs text-fg-subtle">{usuario.email}</p>
            </div>
          </div>
          <form action={sair}>
            <button
              type="submit"
              className="w-full rounded-md px-2 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
