import type { Metadata } from "next";
import { Suspense } from "react";
import { EsqueletoTela } from "@/components/esqueletos";
import { AbaInadimplencia } from "@/components/fluxo-caixa/aba-inadimplencia";
import { StatusAtualizacao } from "@/components/fluxo-caixa/status-atualizacao";
import { ConfiguracaoOmie } from "@/components/resumo-omie";
import { EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, exigirTela, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { obterPacoteFluxoCaixa, ultimasExecucoes } from "@/lib/fluxo-caixa/dados";
import { credenciaisDaEmpresa } from "@/lib/omie/resumo";

export const metadata: Metadata = { title: "Inadimplência · Painel" };

/**
 * Inadimplência da empresa selecionada: maiores devedores, aging e
 * reincidência. Vem do mesmo pacote do fluxo de caixa (container `caixa`,
 * atualizado às 10h e às 16h) — não consulta o Omie ao abrir.
 */
export default async function InadimplenciaPage() {
  await exigirTela("inadimplencia");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Inadimplência" />
        <EmptyHint>Cadastre uma empresa para acompanhar a inadimplência.</EmptyHint>
      </>
    );
  }

  if (empresa.eh_plataforma) {
    return (
      <>
        <PageHeader title="Inadimplência" description="Maiores devedores e aging de cada cliente, a partir do Omie." />
        <EmptyHint>Selecione um cliente no seletor da barra lateral para ver a inadimplência dele.</EmptyHint>
      </>
    );
  }

  return (
    <Suspense key={empresa.id} fallback={<EsqueletoTela titulo="Inadimplência" descricao={empresa.nome} />}>
      <ConteudoInadimplencia empresa={empresa} />
    </Suspense>
  );
}

async function ConteudoInadimplencia({ empresa }: { empresa: { id: string; nome: string } }) {
  const [pacote, execucoes, ehAdmin] = await Promise.all([
    obterPacoteFluxoCaixa(empresa.id),
    ultimasExecucoes(empresa.id),
    souAdminPlataforma(),
  ]);

  const status = (
    <StatusAtualizacao atualizadoEm={pacote?.atualizadoEm ?? null} execucoes={execucoes} mostrarErro={ehAdmin} />
  );

  if (!pacote) {
    const acesso = await credenciaisDaEmpresa(empresa.id);
    return (
      <>
        <PageHeader
          title="Inadimplência"
          description={empresa.nome}
          actions={acesso.estado === "ok" ? status : undefined}
        />
        {acesso.estado !== "ok" ? (
          <ConfiguracaoOmie estado={acesso} ehAdminPlataforma={ehAdmin} />
        ) : (
          <EmptyHint>
            Ainda não há dados calculados para esta empresa. São atualizados todo dia às 10h e às 16h; use &quot;Atualizar
            agora&quot; no Fluxo de caixa para gerar já — a primeira rodada pode levar vários minutos.
          </EmptyHint>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Inadimplência"
        description={`${empresa.nome} · maiores devedores e aging a partir do Omie`}
        actions={status}
      />
      <AbaInadimplencia extra={pacote.extra} />
    </>
  );
}
