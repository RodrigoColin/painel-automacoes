import type { Metadata } from "next";
import {
  Badge,
  Button,
  Dot,
  EmptyHint,
  PageHeader,
  SearchInput,
  StatCard,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { nivelDot, toneResultado } from "@/lib/status-cores";
import { empresaAtual } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarExecucoes } from "@/lib/consultas";
import {
  formatarDataHora,
  formatarDuracao,
  rotuloResultado,
} from "@/lib/tipos";

export const metadata: Metadata = { title: "Histórico · Painel" };

export default async function HistoricoPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const execucoes = empresa ? await listarExecucoes(empresa.id) : [];

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

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Buscar por automação ou ID" />
        <Button variant="secondary">Período</Button>
        <Button variant="secondary">Resultado</Button>
        <Button variant="ghost">Limpar filtros</Button>
      </div>

      {execucoes.length === 0 ? (
        <EmptyHint>
          Nenhuma execução registrada ainda. Assim que uma automação rodar, ela
          aparece aqui.
        </EmptyHint>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Execução</Th>
              <Th>Automação</Th>
              <Th>Resultado</Th>
              <Th>Início</Th>
              <Th className="text-right">Duração</Th>
              <Th>Origem</Th>
            </tr>
          </thead>
          <tbody>
            {execucoes.map((execucao) => (
              <tr key={execucao.id} className="hover:bg-surface-muted/50">
                <Td className="font-mono text-xs text-fg-muted">
                  {execucao.id.slice(0, 8)}
                </Td>
                <Td className="font-medium">{execucao.automacao}</Td>
                <Td>
                  <Badge tone={toneResultado[execucao.resultado]}>
                    <Dot level={nivelDot(toneResultado[execucao.resultado])} />
                    {rotuloResultado[execucao.resultado]}
                  </Badge>
                </Td>
                <Td className="text-fg-muted tabular-nums">
                  {formatarDataHora(execucao.inicio)}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatarDuracao(execucao.duracaoMs)}
                </Td>
                <Td className="text-fg-muted">{execucao.origem}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-subtle">
          Exibindo {execucoes.length} de {execucoes.length} execuções.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled>
            Anterior
          </Button>
          <Button variant="secondary" disabled>
            Próxima
          </Button>
        </div>
      </div>
    </>
  );
}
