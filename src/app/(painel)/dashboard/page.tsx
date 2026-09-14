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
import {
  Badge,
  Button,
  Card,
  Dot,
  EmptyHint,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { empresaAtual, empresasDoUsuario } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import {
  listarAutomacoes,
  listarExecucoes,
  listarLogs,
  metricasDashboard,
  proximasExecucoes,
} from "@/lib/consultas";
import {
  formatarDataHora,
  formatarDuracao,
  rotuloNivel,
  rotuloResultado,
} from "@/lib/tipos";

export const metadata: Metadata = { title: "Dashboard · Painel" };

const nf = new Intl.NumberFormat("pt-BR");

/** Percentual seguro: sem execuções, não existe taxa a mostrar. */
function taxa(parte: number, total: number) {
  return total > 0 ? (parte / total) * 100 : null;
}

function formatarPercentual(valor: number | null) {
  return valor === null ? "—" : `${valor.toFixed(1).replace(".", ",")}%`;
}

export default async function DashboardPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Visão geral dos disparos, do desempenho e dos eventos recentes das automações."
        />
        <EmptyHint>
          Cadastre uma empresa no seletor da barra lateral para ver as métricas.
        </EmptyHint>
      </>
    );
  }

  const agregando = empresa.eh_plataforma;
  const idsEscopo = agregando
    ? (await empresasDoUsuario()).map((e) => e.id)
    : [empresa.id];

  const [metricas, automacoes, execucoes, logs, agendadas] = await Promise.all([
    metricasDashboard(idsEscopo),
    listarAutomacoes(idsEscopo),
    listarExecucoes(idsEscopo, 5),
    listarLogs(idsEscopo, 20),
    proximasExecucoes(idsEscopo),
  ]);

  const { serie30d, serie14d, porHora, total, sucessos, erros } = metricas;
  const taxaSucesso = taxa(sucessos, sucessos + erros);

  // Comparação entre as duas metades da série. Sem período anterior não há
  // variação a calcular — dividir por zero daria Infinity na tela.
  const metade = Math.floor(serie30d.length / 2);
  const somar = (inicio: number, fim: number) =>
    serie30d.slice(inicio, fim).reduce((s, d) => s + d.sucesso + d.erro, 0);
  const periodoAtual = somar(metade, serie30d.length);
  const periodoAnterior = somar(0, metade);
  const variacao =
    periodoAnterior > 0
      ? ((periodoAtual - periodoAnterior) / periodoAnterior) * 100
      : null;

  const hoje = serie30d[serie30d.length - 1];
  const disparosHoje = hoje.sucesso + hoje.erro;

  const emAndamento = execucoes.filter((e) => e.resultado === "em_andamento").length;
  const errosRecentes = logs.filter((l) => l.nivel === "erro");

  const ativas = automacoes.filter((a) => a.status === "ativa").length;

  const topAutomacoes = [...automacoes]
    .filter((a) => a.execucoes30d > 0)
    .sort((a, b) => b.execucoes30d - a.execucoes30d)
    .slice(0, 5)
    .map((a) => ({
      rotulo: agregando ? `${a.nome} · ${a.empresa}` : a.nome,
      valor: a.execucoes30d,
      detalhe: a.gatilho,
    }));

  // Agrupa as execuções pelo gatilho real de cada automação.
  const porGatilho = new Map<string, number>();
  for (const automacao of automacoes) {
    if (automacao.execucoes30d === 0) continue;
    porGatilho.set(
      automacao.gatilho,
      (porGatilho.get(automacao.gatilho) ?? 0) + automacao.execucoes30d,
    );
  }
  const disparosPorGatilho = [...porGatilho.entries()]
    .map(([rotulo, valor]) => ({ rotulo, valor }))
    .sort((a, b) => b.valor - a.valor);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          agregando
            ? "Visão geral de todos os clientes da Proos — disparos, desempenho e eventos recentes."
            : "Visão geral dos disparos, do desempenho e dos eventos recentes das automações."
        }
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
            {nf.format(total)}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {variacao === null
              ? "Sem período anterior para comparar"
              : `${variacao >= 0 ? "▲" : "▼"} ${Math.abs(variacao)
                  .toFixed(1)
                  .replace(".", ",")}% vs. 15 dias anteriores`}
          </p>
          <div className="mt-3">
            <Sparkline valores={serie30d.map((d) => d.sucesso + d.erro)} />
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Taxa de sucesso
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatarPercentual(taxaSucesso)}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {nf.format(erros)} execuções com erro no período
          </p>
          <div className="mt-3">
            <Sparkline
              valores={serie30d.map((d) => taxa(d.sucesso, d.sucesso + d.erro) ?? 0)}
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
            <Sparkline valores={porHora} />
          </div>
        </Card>

        <KpiAutomacoesAtivas ativas={ativas} total={automacoes.length} />
      </div>

      {/* --------------------------- Alerta de falhas -------------------------- */}
      {errosRecentes.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-border-strong p-4">
          <div className="flex items-start gap-3">
            <IconAlerta className="mt-0.5 size-5 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium">
                {errosRecentes.length} falhas registradas recentemente
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
      {total === 0 ? (
        <EmptyHint>
          Nenhuma execução nos últimos 30 dias. Os gráficos aparecem assim que as
          automações começarem a rodar.
        </EmptyHint>
      ) : (
        <>
          <ChartCard
            title="Disparos por dia"
            hint="Total de execuções iniciadas nos últimos 30 dias."
            aside={
              <span className="text-xs tabular-nums text-fg-subtle">
                média {nf.format(Math.round(total / serie30d.length))}/dia
              </span>
            }
          >
            <AreaChart
              pontos={serie30d.map((d) => ({
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
                colunas={serie14d.map((d) => ({ rotulo: d.rotulo, valor: d.erro }))}
                rotularCada={3}
                sufixo="erros"
                tom="danger"
              />
            </ChartCard>

            <ChartCard
              title="Volume por hora"
              hint="Distribuição dos disparos ao longo do dia."
            >
              <ColumnChart
                colunas={porHora.map((valor, hora) => ({
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
                  { rotulo: "Sucesso", valor: sucessos, tom: "success" },
                  {
                    rotulo: "Erro",
                    valor: erros,
                    variant: "hachurado",
                    tom: "danger",
                  },
                ]}
              />
            </ChartCard>

            <ChartCard
              title="Disparos por gatilho"
              hint="Como as execuções foram iniciadas nos últimos 30 dias."
            >
              {disparosPorGatilho.length > 0 ? (
                <RankedBars itens={disparosPorGatilho} />
              ) : (
                <EmptyHint>Sem execuções para agrupar por gatilho.</EmptyHint>
              )}
            </ChartCard>
          </div>
        </>
      )}

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
          {topAutomacoes.length > 0 ? (
            <RankedBars itens={topAutomacoes} sufixo="exec." />
          ) : (
            <EmptyHint>Nenhuma automação executada no período.</EmptyHint>
          )}
        </ChartCard>

        <ChartCard title="Próximas execuções" hint="Agendamentos previstos.">
          {agendadas.length > 0 ? (
            <ul className="divide-y divide-border">
              {agendadas.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.automacao}</p>
                    <p className="truncate text-xs text-fg-subtle">{item.gatilho}</p>
                  </div>
                  <Badge tone="outline" className="shrink-0 tabular-nums">
                    {formatarDataHora(item.quando)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint>Nenhuma execução agendada.</EmptyHint>
          )}
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

      {execucoes.length === 0 ? (
        <EmptyHint>Nenhuma execução registrada ainda.</EmptyHint>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Execução</Th>
              <Th>Automação</Th>
              {agregando ? <Th>Empresa</Th> : null}
              <Th>Resultado</Th>
              <Th>Início</Th>
              <Th className="text-right">Duração</Th>
            </tr>
          </thead>
          <tbody>
            {execucoes.map((execucao) => (
              <tr key={execucao.id} className="hover:bg-surface-muted/50">
                <Td className="font-mono text-xs text-fg-muted">
                  {execucao.id.slice(0, 8)}
                </Td>
                <Td className="font-medium">{execucao.automacao}</Td>
                {agregando ? (
                  <Td className="text-fg-muted">{execucao.empresa}</Td>
                ) : null}
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
              </tr>
            ))}
          </tbody>
        </Table>
      )}

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

      {logs.length === 0 ? (
        <EmptyHint>Nenhum log emitido ainda.</EmptyHint>
      ) : (
        <Card className="divide-y divide-border">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex gap-3 px-4 py-3 hover:bg-surface-muted/50"
            >
              <span className="w-16 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-fg-subtle">
                {new Date(log.horario).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
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
      )}
    </>
  );
}
