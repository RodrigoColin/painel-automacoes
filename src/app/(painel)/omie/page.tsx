import type { Metadata } from "next";
import { Suspense } from "react";
import { BotaoAtualizarOmie } from "@/components/botao-atualizar-omie";
import { BotaoChavesOmie } from "@/components/form-chaves-omie";
import { EsqueletoTela } from "@/components/esqueletos";
import { AbaFaturamento } from "@/components/omie-faturamento";
import { ConfiguracaoOmie, identificacaoOmie } from "@/components/resumo-omie";
import { Badge, Card, EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, souAdminPlataforma, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { FormConfigRecorrencia } from "@/components/form-config-recorrencia";
import { lerConfigRecorrencia, lerFaturamentoOmie } from "@/lib/omie/faturamento";
import { obterResumoOmie, statusDasChaves } from "@/lib/omie/resumo";

export const metadata: Metadata = { title: "Resumo Omie · Painel" };

/**
 * Resumo do Omie da empresa selecionada: faturamento e recorrência — OS
 * faturadas sincronizadas no banco (por categoria, por cliente, MRR, churn).
 *
 * Sem visão agregada: cada cliente tem a própria conta no Omie.
 */
export default async function ResumoOmiePage({ searchParams }: PageProps<"/omie">) {
  await exigirTela("omie");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Resumo Omie" />
        <EmptyHint>Cadastre uma empresa para consultar o Omie.</EmptyHint>
      </>
    );
  }

  // As chaves do Omie ficam na pasta do cliente no Infisical, e a Proos não
  // tem pasta própria — o app só cria pasta para empresa cliente.
  if (empresa.eh_plataforma) {
    return (
      <>
        <PageHeader
          title="Resumo Omie"
          description="Faturamento e recorrência puxados do Omie de cada cliente."
        />
        <EmptyHint>
          Selecione um cliente no seletor da barra lateral para ver o resumo do Omie dele.
        </EmptyHint>
      </>
    );
  }

  const parametros = await searchParams;
  const mes = typeof parametros.mes === "string" ? parametros.mes : undefined;

  // O que depende do Omie/Infisical fica atrás de um Suspense: a tela troca
  // na hora, com o nome do cliente já no cabeçalho, e o conteúdo entra quando
  // chegar. A `key` refaz o placeholder a cada troca de cliente ou mês.
  return (
    <Suspense
      key={`${empresa.id}:${mes ?? ""}`}
      fallback={
        <EsqueletoTela
          titulo="Resumo Omie"
          descricao={`${empresa.nome} · consultando o Omie…`}
          aviso="A primeira consulta de cada cliente pode levar alguns segundos."
        />
      }
    >
      <ConteudoOmie empresa={empresa} mes={mes} />
    </Suspense>
  );
}

async function ConteudoOmie({
  empresa,
  mes,
}: {
  empresa: { id: string; nome: string };
  mes: string | undefined;
}) {
  const [estado, ehAdminPlataforma] = await Promise.all([
    obterResumoOmie(empresa.id),
    souAdminPlataforma(),
  ]);

  // Chaves são geridas só pela Proos; o cliente vê o resumo, não o botão.
  const chaves = ehAdminPlataforma ? (
    <BotaoChavesOmie empresaId={empresa.id} status={statusDasChaves(estado)} />
  ) : null;

  const resumo = estado.estado === "ok" ? estado.resumo : null;
  const semIntegracao = estado.estado === "sem-infisical" || estado.estado === "sem-chaves";

  const cabecalho = (
    <PageHeader
      title="Resumo Omie"
      description={identificacaoOmie(empresa.nome, resumo)}
      actions={chaves}
    />
  );

  if (semIntegracao) {
    return (
      <>
        {cabecalho}
        <ConfiguracaoOmie estado={estado} ehAdminPlataforma={ehAdminPlataforma} />
      </>
    );
  }

  const faturamento = await lerFaturamentoOmie(empresa.id, mes);
  // Só a Proos configura o que é recorrente; carrega os candidatos (categorias
  // faturadas) apenas quando há faturamento e quem olha é admin.
  const configRecorrencia =
    ehAdminPlataforma && faturamento ? await lerConfigRecorrencia(empresa.id) : null;

  return (
    <>
      {cabecalho}

      {faturamento ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fg-subtle">
              Fonte: Omie, ordens de serviço faturadas · última competência fechada:{" "}
              <span className="font-medium text-fg-muted">
                {faturamento.mesesReferencia.at(-1)?.rotulo ?? "—"}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {faturamento.sincronizadoEm ? (
                <Badge tone="outline" className="tabular-nums">
                  Sincronizado em{" "}
                  {new Date(faturamento.sincronizadoEm).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Badge>
              ) : null}
              <BotaoAtualizarOmie alvo="faturamento" />
            </div>
          </div>
          <AbaFaturamento dados={faturamento} />
          {configRecorrencia ? (
            <FormConfigRecorrencia empresaId={empresa.id} categorias={configRecorrencia} />
          ) : null}
        </>
      ) : (
        <Card className="flex flex-col items-start gap-3 p-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Faturamento ainda não sincronizado</h2>
            <p className="text-sm text-fg-muted">
              A primeira sincronização busca no Omie as ordens de serviço faturadas dos últimos 13
              meses e pode levar cerca de 2 minutos. Depois disso, a tela abre na hora e é atualizada
              todo dia automaticamente.
            </p>
          </div>
          <BotaoAtualizarOmie alvo="faturamento" rotulo="Sincronizar faturamento" />
        </Card>
      )}
    </>
  );
}
