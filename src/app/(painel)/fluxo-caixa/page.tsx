import type { Metadata } from "next";
import { Suspense } from "react";
import { EsqueletoTela } from "@/components/esqueletos";
import { PainelFluxoCaixa } from "@/components/fluxo-caixa/painel-fluxo-caixa";
import { StatusAtualizacao } from "@/components/fluxo-caixa/status-atualizacao";
import { FormConfigFluxoCaixa } from "@/components/form-config-fluxo-caixa";
import { ConfiguracaoOmie } from "@/components/resumo-omie";
import { EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, exigirTela, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { configVisual, obterPacoteFluxoCaixa, ultimasExecucoes } from "@/lib/fluxo-caixa/dados";
import { contasParaConfigurar } from "@/lib/omie/fluxo-caixa";
import { credenciaisDaEmpresa } from "@/lib/omie/resumo";

export const metadata: Metadata = { title: "Fluxo de caixa · Painel" };

/**
 * Fluxo de caixa da empresa selecionada: posição diária, visão por categoria,
 * visão mensal e inadimplência.
 *
 * Não consulta o Omie ao abrir: lê o pacote que o container `caixa` grava às
 * 10h e às 16h (ou quando alguém pede "Atualizar agora"). A Proos (admin da
 * plataforma) vê também o bloco de configuração.
 */
export default async function FluxoCaixaPage() {
  await exigirTela("fluxo-caixa");
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
        <PageHeader title="Fluxo de caixa" description="Posição diária, categorias, visão mensal e inadimplência de cada cliente, a partir do Omie." />
        <EmptyHint>Selecione um cliente no seletor da barra lateral para ver o fluxo de caixa dele.</EmptyHint>
      </>
    );
  }

  return (
    <Suspense key={empresa.id} fallback={<EsqueletoTela titulo="Fluxo de caixa" descricao={empresa.nome} />}>
      <ConteudoFluxoCaixa empresa={empresa} />
    </Suspense>
  );
}

async function ConteudoFluxoCaixa({ empresa }: { empresa: { id: string; nome: string } }) {
  const [pacote, execucoes, config, ehAdmin] = await Promise.all([
    obterPacoteFluxoCaixa(empresa.id),
    ultimasExecucoes(empresa.id),
    configVisual(empresa.id),
    souAdminPlataforma(),
  ]);

  const status = <StatusAtualizacao atualizadoEm={pacote?.atualizadoEm ?? null} execucoes={execucoes} mostrarErro={ehAdmin} />;

  if (!pacote) {
    const acesso = await credenciaisDaEmpresa(empresa.id);
    return (
      <>
        <PageHeader title="Fluxo de caixa" description={empresa.nome} actions={acesso.estado === "ok" ? status : undefined} />
        {acesso.estado !== "ok" ? (
          <ConfiguracaoOmie estado={acesso} ehAdminPlataforma={ehAdmin} />
        ) : (
          <EmptyHint>
            Ainda não há fluxo de caixa calculado para esta empresa. Ele é atualizado todo dia às 10h e às 16h; use
            &quot;Atualizar agora&quot; para gerar já — a primeira rodada pode levar vários minutos.
          </EmptyHint>
        )}
        {ehAdmin && acesso.estado === "ok" ? <BlocoConfiguracao empresaId={empresa.id} config={config} categorias={[]} /> : null}
      </>
    );
  }

  const categorias = [
    ...new Set([
      ...pacote.extrato.movimentos.map((m) => m.categoria),
      ...Object.values(pacote.extra.catmes).flatMap((c) => Object.keys(c)),
    ]),
  ]
    .filter((c) => !c.includes("%)"))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return (
    <>
      <PageHeader title="Fluxo de caixa" description={`${empresa.nome} · posição, projeção e inadimplência a partir do Omie`} actions={status} />

      {pacote.checagem?.avisos.length && ehAdmin ? (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm">
          <b>Avisos da última rodada:</b> {pacote.checagem.avisos.join(" · ")}
        </div>
      ) : null}

      <PainelFluxoCaixa
        extrato={pacote.extrato}
        extra={pacote.extra}
        saldoMinimo={config.saldoMinimo}
        categoriasGrupo={config.categoriasGrupo}
        linhasReceita={config.linhasReceita}
      />

      {ehAdmin ? <BlocoConfiguracao empresaId={empresa.id} config={config} categorias={categorias} /> : null}
    </>
  );
}

async function BlocoConfiguracao({
  empresaId,
  config,
  categorias,
}: {
  empresaId: string;
  config: Awaited<ReturnType<typeof configVisual>>;
  categorias: string[];
}) {
  const contas = await contasParaConfigurar(empresaId);
  return (
    <FormConfigFluxoCaixa
      empresaId={empresaId}
      saldoMinimo={config.saldoMinimo}
      contas={contas}
      categorias={categorias}
      categoriasGrupo={config.categoriasGrupo}
      linhasReceita={config.linhasReceita}
    />
  );
}
