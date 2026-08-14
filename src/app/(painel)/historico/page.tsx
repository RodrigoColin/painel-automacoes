import type { Metadata } from "next";
import {
  Badge,
  Button,
  Dot,
  PageHeader,
  SearchInput,
  StatCard,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { execucoes, rotuloResultado } from "@/lib/data";
import { nivelDot, toneResultado } from "@/lib/status-cores";

export const metadata: Metadata = { title: "Histórico · Painel" };

export default function HistoricoPage() {
  const sucessos = execucoes.filter((e) => e.resultado === "sucesso").length;
  const erros = execucoes.filter((e) => e.resultado === "erro").length;

  return (
    <>
      <PageHeader
        title="Histórico"
        description="Registro das execuções recentes, com resultado e duração."
        actions={<Button variant="secondary">Exportar CSV</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Execuções" value={String(execucoes.length)} hint="Últimas 24 horas" />
        <StatCard label="Sucesso" value={String(sucessos)} hint="Concluídas sem falha" />
        <StatCard label="Erros" value={String(erros)} hint="Requerem atenção" />
        <StatCard label="Duração média" value="—" hint="Placeholder" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Buscar por automação ou ID" />
        <Button variant="secondary">Período</Button>
        <Button variant="secondary">Resultado</Button>
        <Button variant="ghost">Limpar filtros</Button>
      </div>

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
              <Td className="font-mono text-xs text-fg-muted">{execucao.id}</Td>
              <Td className="font-medium">{execucao.automacao}</Td>
              <Td>
                <Badge tone={toneResultado[execucao.resultado]}>
                  <Dot level={nivelDot(toneResultado[execucao.resultado])} />
                  {rotuloResultado[execucao.resultado]}
                </Badge>
              </Td>
              <Td className="text-fg-muted tabular-nums">{execucao.inicio}</Td>
              <Td className="text-right tabular-nums">{execucao.duracao}</Td>
              <Td className="text-fg-muted">{execucao.origem}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

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
