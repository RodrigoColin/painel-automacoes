import Link from "next/link";
import { Card } from "@/components/ui";

/**
 * Era um componente de cliente porque lia o `localStorage`. Com os dados vindo
 * do servidor, a contagem chega pronta e não há estado a sincronizar.
 */
export function KpiAutomacoesAtivas({
  ativas,
  total,
}: {
  ativas: number;
  total: number;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
        Automações ativas
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {ativas}
        <span className="text-base font-normal text-fg-subtle">/{total}</span>
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        {total - ativas} pausadas ou em rascunho
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
