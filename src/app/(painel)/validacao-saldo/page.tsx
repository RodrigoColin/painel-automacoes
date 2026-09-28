import type { Metadata } from "next";
import { EmptyHint, PageHeader } from "@/components/ui";
import { ValidacaoSaldoDiario } from "@/components/validacao-saldo-diario";
import { empresaAtual, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarValidacaoSaldoDiario } from "@/lib/consultas";

export const metadata: Metadata = { title: "Validação de saldo · Painel" };

/**
 * Saldo do banco (extrato OFX, subido manualmente) x saldo real do Omie,
 * dia a dia — não só o saldo final, porque um saldo final batendo pode
 * esconder dois erros que se cancelam. Gravada por
 * scripts/validar_saldo_diario.py (proos-omie-mcp); sem visão agregada da
 * Admin de propósito, saldo bancário é dado sensível por empresa.
 *
 * Diferente de "Fluxo de caixa": não há caso especial para `eh_plataforma`
 * pedindo "selecione um cliente". Aquela tela pega dado AO VIVO do Omie da
 * empresa selecionada, então a Proos (admin) precisa escolher um cliente
 * pra ter credencial Omie válida. Aqui o dado já está gravado por
 * `empresa_id` — a própria Proos é uma empresa real com conta bancária
 * real (foi a conta que originou esta feature, achado de 2026-09-21), e
 * também é `eh_plataforma`. Mostra o que a empresa selecionada tiver,
 * ponto — sem esconder o caso mais comum.
 */
export default async function ValidacaoSaldoPage() {
  await exigirTela("validacao-saldo");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Validação de saldo" />
        <EmptyHint>Cadastre uma empresa para ver a validação de saldo.</EmptyHint>
      </>
    );
  }

  const linhas = await listarValidacaoSaldoDiario(empresa.id);

  return (
    <>
      <PageHeader
        title="Validação de saldo"
        description={`${empresa.nome} · saldo do banco (extrato OFX) x saldo real do Omie, dia a dia`}
      />
      <ValidacaoSaldoDiario linhas={linhas} />
    </>
  );
}
