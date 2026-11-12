import type { Metadata } from "next";
import Link from "next/link";
import { EmptyHint, PageHeader } from "@/components/ui";
import { TabelaDePara } from "@/components/excedentes/tabela-de-para";
import { empresaAtual, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";

export const metadata: Metadata = { title: "De/Para de serviços · Excedentes · Painel" };

/**
 * De/Para serviço recorrente → serviço excedente. O banco é a fonte da
 * verdade (o xlsx do SharePoint virou cópia exportada — decisão Rodrigo
 * 2026-11-12). Toda alteração fica no histórico (quem, quando, o quê).
 */
export default async function DeParaPage() {
  await exigirTela("excedentes");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="De/Para de serviços" />
        <EmptyHint>Selecione uma empresa.</EmptyHint>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="De/Para de serviços"
        description={`${empresa.nome} · serviço recorrente → serviço excedente (fonte da verdade)`}
        actions={
          <Link href="/excedentes" className="text-xs font-medium text-brand hover:underline">
            ← Excedentes
          </Link>
        }
      />
      <TabelaDePara empresaId={empresa.id} />
    </>
  );
}
