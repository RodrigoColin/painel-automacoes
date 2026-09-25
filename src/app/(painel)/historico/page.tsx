import type { Metadata } from "next";
import { Button, PageHeader, StatCard } from "@/components/ui";
import { ListaExecucoes } from "@/components/lista-execucoes";
import { empresaAtual, empresasDoUsuario, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarExecucoes } from "@/lib/consultas";
import { formatarDuracao } from "@/lib/tipos";

export const metadata: Metadata = { title: "Histórico · Painel" };

export default async function HistoricoPage() {
  await exigirTela("historico");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const agregando = empresa?.eh_plataforma ?? false;

  const idsEscopo = agregando
    ? (await empresasDoUsuario()).map((e) => e.id)
    : empresa
      ? [empresa.id]
      : [];

  const execucoes = await listarExecucoes(idsEscopo, 200);

  const sucessos = execucoes.filter((e) => e.resultado === "sucesso").length;
  const erros = execucoes.filter((e) => e.resultado === "erro").length;

  const comDuracao = execucoes.filter((e) => e.duracaoMs !== null);
  const duracaoMedia =
    comDuracao.length > 0
      ? Math.round(
          comDuracao.reduce((soma, e) => soma + (e.duracaoMs ?? 0), 0) /
            comDuracao.length,
        )
      : null;

  return (
    <>
      <PageHeader
        title="Histórico"
        description="Registro das execuções recentes, com resultado e duração."
        actions={<Button variant="secondary">Exportar CSV</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Execuções"
          value={String(execucoes.length)}
          hint="Mais recentes"
        />
        <StatCard label="Sucesso" value={String(sucessos)} hint="Concluídas sem falha" />
        <StatCard label="Erros" value={String(erros)} hint="Requerem atenção" />
        <StatCard
          label="Duração média"
          value={formatarDuracao(duracaoMedia)}
          hint="Entre as execuções concluídas"
        />
      </div>

      <ListaExecucoes execucoes={execucoes} mostrarEmpresa={agregando} />
    </>
  );
}
