import type { Metadata } from "next";
import { EmptyHint, PageHeader } from "@/components/ui";
import { FormExecutarConciliacao } from "@/components/form-executar-conciliacao";
import { empresaAtual, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";

export const metadata: Metadata = { title: "Conciliação Bancária · Painel" };

/**
 * Primeiro degrau da Conciliação Bancária: só upload de extrato + confirmação
 * de que foi lido (linhas, período, movimento) — sem casar título ainda.
 * Roda o motor Python local via `acoes-conciliacao.ts`; só funciona com o
 * Portal Proos rodando localmente (`next dev`), na mesma máquina que tem o
 * repo proos-omie-mcp. Decisão explícita do usuário, 2026-09-22.
 */
export default async function ConciliacaoBancariaPage() {
  await exigirTela("conciliacao-bancaria");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Conciliação Bancária" />
        <EmptyHint>Cadastre uma empresa para enviar um extrato.</EmptyHint>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Conciliação Bancária"
        description={`${empresa.nome} · envie um extrato e confirme que foi processado`}
      />
      <FormExecutarConciliacao empresaId={empresa.id} />
    </>
  );
}
