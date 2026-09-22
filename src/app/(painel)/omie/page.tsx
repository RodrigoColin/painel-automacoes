import type { Metadata } from "next";
import Link from "next/link";
import { BotaoAtualizarOmie } from "@/components/botao-atualizar-omie";
import { BotaoChavesOmie } from "@/components/form-chaves-omie";
import { AbaFaturamento } from "@/components/omie-faturamento";
import { AbaFinanceiro, ConfiguracaoOmie, identificacaoOmie } from "@/components/resumo-omie";
import { Badge, Card, EmptyHint, PageHeader } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { empresaAtual, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { lerFaturamentoOmie } from "@/lib/omie/faturamento";
import { obterResumoOmie, statusDasChaves } from "@/lib/omie/resumo";

export const metadata: Metadata = { title: "Resumo Omie · Painel" };

type Aba = "faturamento" | "financeiro";

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "faturamento", rotulo: "Faturamento e recorrência" },
  { id: "financeiro", rotulo: "Financeiro" },
];

/**
 * Resumo do Omie da empresa selecionada, em duas abas:
 *
 * - Faturamento e recorrência: OS faturadas sincronizadas no banco (por
 *   categoria, por cliente, MRR, churn).
 * - Financeiro: saldo, contas a receber e a pagar, consultados ao vivo.
 *
 * Abas separadas, e não uma página só, também por cor: nas categorias RPA e
 * Presto são azul e laranja, as mesmas de receber e pagar no financeiro — na
 * mesma tela, a mesma cor significaria duas coisas.
 *
 * Sem visão agregada: cada cliente tem a própria conta no Omie.
 */
export default async function ResumoOmiePage({ searchParams }: PageProps<"/omie">) {
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
          description="Faturamento, recorrência e financeiro puxados do Omie de cada cliente."
        />
        <EmptyHint>
          Selecione um cliente no seletor da barra lateral para ver o resumo do Omie dele.
        </EmptyHint>
      </>
    );
  }

  const parametros = await searchParams;
  const aba: Aba = parametros.aba === "financeiro" ? "financeiro" : "faturamento";
  const mes = typeof parametros.mes === "string" ? parametros.mes : undefined;

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

  const faturamento = aba === "faturamento" ? await lerFaturamentoOmie(empresa.id, mes) : null;

  return (
    <>
      {cabecalho}

      <nav aria-label="Seções do resumo" className="-mt-2 flex gap-1 border-b border-border">
        {ABAS.map((item) => {
          const ativa = item.id === aba;
          return (
            <Link
              key={item.id}
              href={item.id === "faturamento" ? "/omie" : "/omie?aba=financeiro"}
              aria-current={ativa ? "page" : undefined}
              className={clsx(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                ativa
                  ? "border-accent font-medium text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {item.rotulo}
            </Link>
          );
        })}
      </nav>

      {aba === "financeiro" ? (
        estado.estado === "ok" ? (
          <AbaFinanceiro resumo={estado.resumo} />
        ) : (
          <ConfiguracaoOmie estado={estado} ehAdminPlataforma={ehAdminPlataforma} />
        )
      ) : faturamento ? (
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
