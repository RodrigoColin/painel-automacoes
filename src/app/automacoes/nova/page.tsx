import type { Metadata } from "next";
import Link from "next/link";
import { FormNovaAutomacao } from "@/components/form-nova-automacao";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Nova automação · Painel" };

export default function NovaAutomacaoPage() {
  return (
    <>
      <div className="text-xs text-fg-subtle">
        <Link href="/automacoes" className="hover:text-fg">
          Automações
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-fg-muted">Nova automação</span>
      </div>

      <PageHeader
        title="Nova automação"
        description="Escolha o motor de execução e configure como a automação será disparada."
      />

      <FormNovaAutomacao />
    </>
  );
}
