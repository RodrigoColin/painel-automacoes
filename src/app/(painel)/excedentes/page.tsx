import type { Metadata } from "next";
import Link from "next/link";
import { EmptyHint, PageHeader } from "@/components/ui";
import { PainelExcedentes } from "@/components/excedentes/painel-excedentes";
import { empresaAtual, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";

export const metadata: Metadata = { title: "Excedentes · Painel" };

/**
 * Excedentes OYSTR: a planilha mensal de excedentes vira uma OS por
 * contrato no Omie, na etapa Faturar — o portal NUNCA fatura. O plano é
 * montado no worker (só leitura); nada é escrito no Omie antes da
 * aprovação explícita do analista. Especificação: skill
 * excedentes-oystr-omie; gabarito de novembro/2026.
 */
export default async function ExcedentesPage() {
  await exigirTela("excedentes");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Excedentes" />
        <EmptyHint>Selecione uma empresa para processar excedentes.</EmptyHint>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Excedentes"
        description={`${empresa.nome} · planilha mensal → OSs na etapa Faturar (nunca fatura)`}
        actions={
          <Link
            href="/excedentes/de-para"
            className="text-xs font-medium text-brand hover:underline"
          >
            De/Para de serviços
          </Link>
        }
      />
      <PainelExcedentes empresaId={empresa.id} />
    </>
  );
}
