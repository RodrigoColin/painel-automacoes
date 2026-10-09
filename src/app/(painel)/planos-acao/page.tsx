import type { Metadata } from "next";
import { Suspense } from "react";
import { EsqueletoTela } from "@/components/esqueletos";
import { PainelPlanos } from "@/components/planos-acao/painel-planos";
import { EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, exigirTela, verificarSessao } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarCards, listarTarefasAbertas, responsaveisPossiveis } from "@/lib/planos-acao/consultas";
import { sincronizarInadimplencia } from "@/lib/planos-acao/sincronizacao";

export const metadata: Metadata = { title: "Planos de ação · Painel" };

const DESCRICAO = "Cards por etapa, com tarefas, responsáveis e histórico.";

/**
 * Quadro de planos de ação da empresa selecionada. Clientes inadimplentes
 * viram card sozinhos (ver `sincronizarInadimplencia`); os demais são criados
 * à mão.
 */
export default async function PlanosAcaoPage() {
  await exigirTela("planos-acao");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Planos de ação" description={DESCRICAO} />
        <EmptyHint>Cadastre uma empresa para acompanhar os planos de ação.</EmptyHint>
      </>
    );
  }

  return (
    <Suspense key={empresa.id} fallback={<EsqueletoTela titulo="Planos de ação" descricao={empresa.nome} />}>
      <Conteudo empresa={empresa} />
    </Suspense>
  );
}

async function Conteudo({
  empresa,
}: {
  empresa: { id: string; nome: string; eh_plataforma: boolean; papel: string };
}) {
  const { userId } = await verificarSessao();

  // O cron já faz isto a cada 10 minutos; aqui garante que quem abre a tela
  // logo depois de uma rodada do fluxo de caixa não veja o quadro atrasado.
  // Sai cedo quando não há pacote novo, e uma falha não derruba a tela.
  if (!empresa.eh_plataforma) {
    try {
      await sincronizarInadimplencia(empresa.id);
    } catch (erro) {
      console.error("Planos de ação: sincronização da inadimplência falhou.", erro);
    }
  }

  const [cards, tarefas, responsaveis] = await Promise.all([
    listarCards(empresa.id),
    listarTarefasAbertas(empresa.id),
    responsaveisPossiveis(empresa.id),
  ]);

  // "Hoje" no fuso do painel, resolvido no servidor: prazo vencido não pode
  // depender do relógio de quem abre a tela.
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  return (
    <>
      <PageHeader title="Planos de ação" description={`${empresa.nome} · ${DESCRICAO.toLowerCase()}`} />
      <PainelPlanos
        empresaId={empresa.id}
        cards={cards}
        tarefas={tarefas}
        responsaveis={responsaveis}
        userId={userId}
        hoje={hoje}
        podeEscrever={empresa.papel !== "leitor"}
      />
    </>
  );
}
