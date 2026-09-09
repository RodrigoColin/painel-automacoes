import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormNovaAutomacao } from "@/components/form-nova-automacao";
import { PageHeader } from "@/components/ui";
import { souAdminPlataforma, verificarSessao } from "@/lib/dal";
import { workflowsDisponiveis } from "@/lib/n8n-vinculo";

export const metadata: Metadata = { title: "Nova automação · Painel" };

export default async function NovaAutomacaoPage() {
  // Mantido pelo efeito colateral: redireciona para /login sem sessão.
  await verificarSessao();

  // Esconder o botão na listagem não basta: esta URL é acessível direto.
  if (!(await souAdminPlataforma())) redirect("/automacoes");

  // Lista os workflows do n8n ainda não vinculados, para o seletor do
  // formulário. Roda no servidor porque depende da chave de API.
  const disponiveis = await workflowsDisponiveis();

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

      <FormNovaAutomacao
        workflows={"workflows" in disponiveis ? disponiveis.workflows : []}
        erroWorkflows={"erro" in disponiveis ? disponiveis.erro : null}
      />
    </>
  );
}
