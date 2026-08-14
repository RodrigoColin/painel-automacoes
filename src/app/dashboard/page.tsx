import type { Metadata } from "next";
import Link from "next/link";
import {
  AreaChart,
  ChartCard,
  ColumnChart,
  RankedBars,
  RateMeter,
  Sparkline,
} from "@/components/charts";
import { IconAlerta } from "@/components/icons";
import { KpiAutomacoesAtivas } from "@/components/kpi-automacoes-ativas";
import { nivelDot, toneNivelLog, toneResultado } from "@/lib/status-cores";
import { Badge, Button, Card, Dot, PageHeader, Table, Td, Th } from "@/components/ui";
import {
  automacoes,
  causasErro,
  disparosPorGatilho,
  disparosPorHora,
  execucoes,
  logs,
  proximasExecucoes,
  rotuloNivel,
  rotuloResultado,
  serieDisparos14d,
  serieDisparos30d,
} from "@/lib/data";

export const metadata: Metadata = { title: "Dashboard · Painel" };

const nf = new Intl.NumberFormat("pt-BR");

export default function DashboardPage() {
  /* --- Agregados dos últimos 30 dias --- */
  const totalSucesso = serieDisparos30d.reduce((s, d) => s + d.sucesso, 0);
  const totalErro = serieDisparos30d.reduce((s, d) => s + d.erro, 0);
  const totalDisparos = totalSucesso + totalErro;
  const taxaSucesso = (totalSucesso / totalDisparos) * 100;

  /* Comparação entre os dois períodos de 15 dias da série. */
  const metade = Math.floor(serieDisparos30d.length / 2);
  const somar = (inicio: number, fim: number) =>
    serieDisparos30d
      .slice(inicio, fim)
      .reduce((s, d) => s + d.sucesso + d.erro, 0);
  const periodoAtual = somar(metade, serieDisparos30d.length);
  const periodoAnterior = somar(0, metade);
  const variacao = ((periodoAtual - periodoAnterior) / periodoAnterior) * 100;

  const hoje = serieDisparos30d[serieDisparos30d.length - 1];
  const disparosHoje = hoje.sucesso + hoje.erro;

  const emAndamento = execucoes.filter((e) => e.resultado === "em_andamento").length;
  const comFalha = execucoes.filter((e) => e.resultado === "erro");
  const errosRecentes = logs.filter((l) => l.nivel === "erro");

  const topAutomacoes = [...automacoes]
    .sort((a, b) => b.execucoes30d - a.execucoes30d)
    .slice(0, 5)
    .map((a) => ({
      rotulo: a.nome,
      valor: a.execucoes30d,
      detalhe: a.gatilho,
    }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral dos disparos, do desempenho e dos eventos recentes das automações."
        actions={
          <>
            <Button variant="secondary">Últimos 30 dias</Button>
            <Button variant="secondary">Exportar</Button>
          </>
        }
      />

      {/* ----------------------------- Indicadores ---------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Disparos (30d)
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {nf.format(totalDisparos)}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1).replace(".", ",")}%
            {" vs. 15 dias anteriores"}
          </p>
          <div className="mt-3">
            <Sparkline valores={serieDisparos30d.map((d) => d.sucesso + d.erro)} />
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Taxa de sucesso
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {taxaSucesso.toFixed(1).replace(".", ",")}%
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {nf.format(totalErro)} execuções com erro no período
          </p>
          <div className="mt-3">
            <Sparkline
              valores={serieDisparos30d.map(
                (d) => (d.sucesso / (d.sucesso + d.erro)) * 100
              )}
            />
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Disparos hoje
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {nf.format(disparosHoje)}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {emAndamento} execução{emAndamento === 1 ? "" : "ões"} em andamento
          </p>
          <div className="mt-3">
            <Sparkline valores={disparosPorHora} />
          </div>
        </Card>

        <KpiAutomacoesAtivas />
      </div>

      {/* --------------------------- Alerta de falhas -------------------------- */}
      {errosRecentes.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-border-strong p-4">
          <div className="flex items-start gap-3">
            <IconAlerta className="mt-0.5 size-4.5 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium">
                {errosRecentes.length} falhas registradas nas últimas horas
              </p>
              <p className="text-xs text-fg-muted">
                Automações afetadas:{" "}
                {[...new Set(errosRecentes.map((l) => l.automacao))].join(", ")}.
              </p>
            </div>
          </div>
          <Button variant="secondary">Ver diagnóstico</Button>
        </Card>
      ) : null}

      {/* ------------------------------- Gráficos ------------------------------ */}
      <ChartCard
        title="Disparos por dia"
        hint="Total de execuções iniciadas nos últimos 30 dias."
        aside={
          <span className="text-xs tabular-nums text-fg-subtle">
            média {nf.format(Math.round(totalDisparos / serieDisparos30d.length))}/dia
          </span>
        }
      >
        <AreaChart
          pontos={serieDisparos30d.map((d) => ({
            rotulo: d.rotulo,
            valor: d.sucesso + d.erro,
          }))}
          sufixo="disparos"
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Erros por dia"
          hint="Execuções encerradas com falha nos últimos 14 dias."
        >
          <ColumnChart
            colunas={serieDisparos14d.map((d) => ({
              rotulo: d.rotulo,
              valor: d.erro,
            }))}
            rotularCada={3}
            sufixo="erros"
            tom="danger"
          />
        </ChartCard>

        <ChartCard
          title="Volume por hora"
          hint="Distribuição média dos disparos ao longo do dia."
        >
          <ColumnChart
            colunas={disparosPorHora.map((valor, hora) => ({
              rotulo: `${String(hora).padStart(2, "0")}h`,
              valor,
            }))}
            rotularCada={4}
            sufixo="disparos"
          />
        </ChartCard>

        <ChartCard
          title="Sucesso × erro"
          hint="Proporção dos resultados no período de 30 dias."
        >
          <RateMeter
            segmentos={[
              { rotulo: "Sucesso", valor: totalSucesso, tom: "success" },
              {
                rotulo: "Erro",
                valor: totalErro,
                variant: "hachurado",
                tom: "danger",
              },
            ]}
          />

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Principais causas de erro
            </p>
            <RankedBars
              itens={causasErro.map((c) => ({ rotulo: c.rotulo, valor: c.total }))}
              sufixo="ocorr."
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Disparos por gatilho"
          hint="Como as execuções foram iniciadas nos últimos 30 dias."
        >
          <RankedBars itens={disparosPorGatilho.map((g) => ({ rotulo: g.rotulo, valor: g.total }))} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Automações mais executadas"
          hint="Volume individual nos últimos 30 dias."
          aside={
            <Link
              href="/automacoes"
              className="text-xs font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
            >
              Ver todas
            </Link>
          }
        >
          <RankedBars itens={topAutomacoes} sufixo="exec." />
        </ChartCard>

        <ChartCard
          title="Próximas execuções"
          hint="Agendamentos e janelas previstas."
        >
          <ul className="divide-y divide-border">
            {proximasExecucoes.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.automacao}</p>
                  <p className="truncate text-xs text-fg-subtle">{item.gatilho}</p>
                </div>
                <Badge tone="outline" className="shrink-0 tabular-nums">
                  {item.quando}
                </Badge>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      {/* ---------------------------- Execuções recentes ----------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Execuções recentes</h2>
          <p className="text-xs text-fg-muted">
            Últimos disparos registrados, com resultado e duração.
          </p>
        </div>
        <Link
          href="/historico"
          className="text-xs font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
        >
          Ver histórico completo
        </Link>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Execução</Th>
            <Th>Automação</Th>
            <Th>Resultado</Th>
            <Th>Início</Th>
            <Th className="text-right">Duração</Th>
          </tr>
        </thead>
        <tbody>
          {execucoes.slice(0, 5).map((execucao) => (
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
            </tr>
          ))}
        </tbody>
      </Table>

      {/* --------------------------------- Logs -------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Logs</h2>
          <p className="text-xs text-fg-muted">
            Eventos emitidos pelas automações em tempo quase real.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost">Somente erros</Button>
          <Button variant="secondary">Abrir console</Button>
        </div>
      </div>

      <Card className="divide-y divide-border">
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 px-4 py-3 hover:bg-surface-muted/50">
            <span className="w-16 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-fg-subtle">
              {log.horario}
            </span>
            <Badge
              tone={toneNivelLog[log.nivel]}
              className="h-5 shrink-0 self-start"
            >
              <Dot level={nivelDot(toneNivelLog[log.nivel])} />
              {rotuloNivel[log.nivel]}
            </Badge>
            <div className="min-w-0">
              <p className="text-sm">{log.mensagem}</p>
              <p className="mt-0.5 text-xs text-fg-subtle">{log.automacao}</p>
            </div>
          </div>
        ))}
      </Card>

      <p className="text-xs text-fg-subtle">
        {comFalha.length} execução{comFalha.length === 1 ? "" : "ões"} com erro nas últimas
        24 horas · dados de placeholder.
      </p>
    </>
  );
}
