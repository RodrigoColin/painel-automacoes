import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormNovaAutomacao } from "@/components/form-nova-automacao";
import { PageHeader } from "@/components/ui";
import { souAdminPlataforma, verificarSessao } from "@/lib/dal";

export const metadata: Metadata = { title: "Nova automação · Painel" };

export default async function NovaAutomacaoPage() {
  // Mantido pelo efeito colateral: redireciona para /login sem sessão.
  await verificarSessao();

  // Esconder o botão na listagem não basta: esta URL é acessível direto.
  if (!(await souAdminPlataforma())) redirect("/automacoes");

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
        description="Envie o script Python e defina quando ele roda. A automação já nasce ativa."
      />

      <FormNovaAutomacao />
    </>
  );
}
