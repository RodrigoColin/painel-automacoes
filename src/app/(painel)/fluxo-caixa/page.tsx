import type { Metadata } from "next";
import { BotaoAtualizarOmie } from "@/components/botao-atualizar-omie";
import { FluxoCaixaDiario } from "@/components/fluxo-caixa";
import { FormConfigFluxoCaixa } from "@/components/form-config-fluxo-caixa";
import { ConfiguracaoOmie } from "@/components/resumo-omie";
import { Badge, EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { contasParaConfigurar, obterFluxoCaixa } from "@/lib/omie/fluxo-caixa";

export const metadata: Metadata = { title: "Fluxo de caixa · Painel" };

// Uma chamada ao Omie por conta e por mês da janela, com espera entre elas:
// a primeira abertura depois do cache vencer pode passar de meio minuto.
export const maxDuration = 300;

/**
 * Fluxo de caixa diário da empresa selecionada, lido do extrato do Omie.
 *
 * O cliente vê a posição e a projeção; a Proos (admin da plataforma) vê também
 * o bloco de configuração, onde marca o que é caixa, o que é dívida e o saldo
 * mínimo. Sem visão agregada: cada cliente tem a própria conta no Omie.
 */
export default async function FluxoCaixaPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Fluxo de caixa" />
        <EmptyHint>Cadastre uma empresa para acompanhar o fluxo de caixa.</EmptyHint>
      </>
    );
  }

  if (empresa.eh_plataforma) {
    return (
      <>
        <PageHeader
          title="Fluxo de caixa"
          description="Posição diária, entradas, saídas e saldo projetado de cada cliente, direto do Omie."
        />
        <EmptyHint>
          Selecione um cliente no seletor da barra lateral para ver o fluxo de caixa dele.
        </EmptyHint>
      </>
    );
  }

  const [estado, ehAdminPlataforma] = await Promise.all([
    obterFluxoCaixa(empresa.id),
    souAdminPlataforma(),
  ]);

  if (estado.estado !== "ok") {
    return (
      <>
        <PageHeader title="Fluxo de caixa" description={empresa.nome} />
        <ConfiguracaoOmie estado={estado} ehAdminPlataforma={ehAdminPlataforma} />
      </>
    );
  }

  const { fluxo } = estado;
  const contas = ehAdminPlataforma ? await contasParaConfigurar(empresa.id) : [];

  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description={`${empresa.nome} · posição de hoje e projeção pelo extrato do Omie`}
        actions={
          <>
            <Badge tone="outline" className="tabular-nums">
              Atualizado em{" "}
              {new Date(fluxo.consultadoEm).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Badge>
            <BotaoAtualizarOmie alvo="fluxo-caixa" />
          </>
        }
      />

      <FluxoCaixaDiario fluxo={fluxo} />

      {ehAdminPlataforma ? (
        <FormConfigFluxoCaixa empresaId={empresa.id} saldoMinimo={fluxo.saldoMinimo} contas={contas} />
      ) : null}
    </>
  );
}
