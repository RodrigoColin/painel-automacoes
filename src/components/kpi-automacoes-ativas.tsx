"use client";

import Link from "next/link";
import { useAutomacoes } from "@/lib/use-automacoes";
import { Card } from "@/components/ui";

/**
 * Único KPI do dashboard que precisa refletir o cadastro em tempo real —
 * criar ou excluir uma automação muda esta contagem na hora.
 */
export function KpiAutomacoesAtivas() {
  const { automacoes } = useAutomacoes();
  const ativas = automacoes.filter((a) => a.status === "ativa").length;

  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        Automações ativas
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {ativas}
        <span className="text-base font-normal text-fg-subtle">
          /{automacoes.length}
        </span>
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        {automacoes.length - ativas} pausadas ou em rascunho
      </p>
      <div className="mt-3">
        <Link
          href="/automacoes"
          className="text-xs font-medium text-fg underline underline-offset-4 hover:text-fg-muted"
        >
          Gerenciar automações
        </Link>
      </div>
    </Card>
  );
}
