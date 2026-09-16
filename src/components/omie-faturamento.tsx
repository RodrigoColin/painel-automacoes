/**
 * Aba "Faturamento e recorrência" do Resumo Omie.
 *
 * Tudo aqui lê o faturamento já sincronizado no banco (`lib/omie/faturamento`)
 * — nenhuma chamada ao Omie na renderização. Os pedaços interativos (tabela
 * de clientes, seletor de mês, listas) ficam em `omie-faturamento-interativo`.
 *
 * Cores: cada categoria de faturamento tem um slot fixo da paleta categórica
 * validada (recorrentes primeiro — RPA azul, Presto laranja). Verde e vermelho
 * de estado só aparecem em variação, entrada e saída, sempre com sinal escrito.
 */

import { ChartCard } from "@/components/charts";
import { IconAlerta } from "@/components/icons";
import {
  BotaoExportarMovimentacao,
  ComparativoCategorias,
  ListaMovimentos,
  ListaSemFaturamento,
  SeletorMesCompacto,
  SeletorMesReferencia,
  TabelaChurnMensal,
  TabelaClientesFaturamento,
  TabelaHistoricoMrr,
} from "@/components/omie-faturamento-interativo";
import { Card } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import type { CategoriaFaturamento, DadosFaturamento, Mes, MovimentoMensal } from "@/lib/omie/faturamento";
import {
  brlCompacto,
  brlInteiro,
  FUNDO_CATEGORIA,
  formatarPercentual,
  numero,
  tomVariacao,
  variacaoPercentual,
  variacaoReais,
} from "@/lib/omie/formatacao";

/* ------------------------------ Peças visuais ----------------------------- */

function escalaMaxima(valores: number[]) {
  const max = Math.max(...valores, 1);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const passo = magnitude / 2;
  return Math.ceil(max / passo) * passo;
}

function Legenda({ categorias }: { categorias: CategoriaFaturamento[] }) {
  return (
    <>
      {categorias.map((c) => (
        <span key={c.codigo} className="inline-flex items-center gap-2 text-xs text-fg-muted">
          <span aria-hidden="true" className={clsx("size-2.5 rounded-[3px]", FUNDO_CATEGORIA[c.slot])} />
          {c.descricao}
        </span>
      ))}
    </>
  );
}

function EixoY({ max, formatar = brlCompacto.format }: { max: number; formatar?: (valor: number) => string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 flex w-14 flex-col justify-between text-right text-[10px] tabular-nums text-fg-subtle">
      {[1, 2 / 3, 1 / 3, 0].map((t) => (
        <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
          {formatar(max * t)}
        </span>
      ))}
    </div>
  );
}

function Grade() {
  return (
    <>
      {[0, 1 / 3, 2 / 3].map((t) => (
        <div
          key={t}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-border"
          style={{ top: `${t * 100}%` }}
        />
      ))}
    </>
  );
}

/**
 * Colunas empilhadas por mês. Cada coluna ≤ 24px, 2px de superfície entre
 * segmentos, topo arredondado; mês em curso esmaecido e marcado com "*".
 * Hover mostra o valor do segmento; a tabela ao lado traz todos os números.
 */
function ColunasEmpilhadas({
  meses,
  categorias,
  valores,
  altura = "h-60",
}: {
  meses: Mes[];
  categorias: CategoriaFaturamento[];
  /** [mês][categoria] */
  valores: number[][];
  altura?: string;
}) {
  const totais = valores.map((linha) => linha.reduce((s, v) => s + v, 0));
  const max = escalaMaxima(totais);

  return (
    <figure className="m-0">
      <div className="relative pl-16">
        <EixoY max={max} />
        <div className={clsx("relative flex items-end border-b border-border-strong", altura)}>
          <Grade />
          {meses.map((mes, iMes) => (
            <div
              key={mes.chave}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={[
                `${mes.rotulo}${mes.parcial ? " (parcial)" : ""} · total ${brlInteiro.format(totais[iMes])}`,
                ...categorias
                  .map((categoria, iCat) => [categoria, valores[iMes][iCat]] as const)
                  .filter(([, valor]) => valor > 0)
                  .map(([categoria, valor]) => `${categoria.descricao}: ${brlInteiro.format(valor)}`),
              ].join("\n")}
            >
              {totais[iMes] > 0 ? (
                <span className="mb-1 block text-center text-[9px] font-medium tabular-nums text-fg-subtle">
                  {brlCompacto.format(totais[iMes])}
                </span>
              ) : null}
              <div
                className={clsx(
                  "mx-auto flex w-full max-w-6 flex-col-reverse gap-[2px] transition-opacity group-hover:opacity-80",
                  mes.parcial && "opacity-50",
                )}
                style={{ height: `${(totais[iMes] / max) * 100}%` }}
              >
                {categorias.map((categoria, iCat) => {
                  const valor = valores[iMes][iCat];
                  if (valor <= 0) return null;
                  return (
                    <div
                      key={categoria.codigo}
                      className={clsx("min-h-px w-full last:rounded-t-[4px]", FUNDO_CATEGORIA[categoria.slot])}
                      style={{ flexGrow: valor, flexBasis: 0 }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex pl-16 text-[10px] text-fg-subtle">
        {meses.map((mes, i) => (
          <span key={mes.chave} className="min-w-0 flex-1 text-center">
            {/* No celular, rótulo mês sim, mês não — senão os nomes se atropelam. */}
            <span className={clsx(i % 2 === 1 && "hidden sm:inline")}>{mes.rotuloCurto}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

type BarraCascata = {
  chave: string;
  rotulo: string;
  tipo: "total" | "aumento" | "queda";
  de: number;
  ate: number;
  titulo: string;
};

/**
 * Monta a sequência de barras da cascata: saldo inicial (total) → +novos
 * (flutuante) → −churn (flutuante) → saldo final (total), encadeado mês a
 * mês — o saldo final de um mês é o saldo inicial do próximo, então só uma
 * barra "total" aparece entre eles.
 */
function construirCascata(historico: MovimentoMensal[]): BarraCascata[] {
  const barras: BarraCascata[] = [];
  const primeiro = historico[0];
  if (!primeiro) return barras;

  let atual = primeiro.saldoInicial ?? primeiro.saldoFinal;
  if (primeiro.saldoInicial !== null) {
    barras.push({
      chave: `${primeiro.mes.chave}-inicio`,
      rotulo: primeiro.mes.rotuloCurto,
      tipo: "total",
      de: 0,
      ate: atual,
      titulo: `Saldo inicial de ${primeiro.mes.rotulo} · ${numero.format(atual)} contratos`,
    });
  }

  for (const m of historico) {
    if (m.novos) {
      const novoAtual = atual + m.novos;
      barras.push({
        chave: `${m.mes.chave}-novos`,
        rotulo: "",
        tipo: "aumento",
        de: atual,
        ate: novoAtual,
        titulo: `${m.mes.rotulo} · Novos +${numero.format(m.novos)}`,
      });
      atual = novoAtual;
    }
    if (m.saidas) {
      const novoAtual = atual - m.saidas;
      barras.push({
        chave: `${m.mes.chave}-churn`,
        rotulo: "",
        tipo: "queda",
        de: atual,
        ate: novoAtual,
        titulo: `${m.mes.rotulo} · Churn −${numero.format(m.saidas)}`,
      });
      atual = novoAtual;
    }
    barras.push({
      chave: `${m.mes.chave}-final`,
      rotulo: m.mes.rotuloCurto,
      tipo: "total",
      de: 0,
      ate: m.saldoFinal,
      titulo: `${m.mes.rotulo}${m.mes.parcial ? " (parcial)" : ""} · Saldo ${numero.format(m.saldoFinal)} contratos`,
    });
    atual = m.saldoFinal;
  }

  return barras;
}

const COR_CASCATA: Record<BarraCascata["tipo"], string> = {
  total: "bg-cat-1",
  aumento: "bg-success",
  queda: "bg-danger",
};

/**
 * Cascata do saldo de contratos recorrentes: barras "total" cheias (saldo
 * inicial, saldo de cada mês) e barras flutuantes mostrando só o que mudou
 * (novos entrando, churn saindo) entre uma e outra.
 */
function CascataContratos({
  historico,
  alturaGrafico = "h-60",
}: {
  historico: MovimentoMensal[];
  alturaGrafico?: string;
}) {
  const barras = construirCascata(historico);
  const max = escalaMaxima(barras.map((b) => Math.max(b.de, b.ate)));

  return (
    <figure className="m-0">
      <div className="relative pl-16">
        <EixoY max={max} formatar={(valor) => numero.format(Math.round(valor))} />
        <div className={clsx("relative border-b border-border-strong", alturaGrafico)}>
          <Grade />
          <div className="flex h-full items-end">
            {barras.map((barra) => {
              const base = Math.min(barra.de, barra.ate);
              const altura = Math.abs(barra.ate - barra.de);
              const rotuloValor =
                barra.tipo === "total"
                  ? numero.format(barra.ate)
                  : `${barra.tipo === "aumento" ? "+" : "−"}${numero.format(altura)}`;
              return (
                <div key={barra.chave} className="group relative h-full min-w-0 flex-1" title={barra.titulo}>
                  <div
                    className="absolute inset-x-0 flex justify-center"
                    style={{ bottom: `calc(${((base + altura) / max) * 100}% + 2px)` }}
                  >
                    <span
                      className={clsx(
                        "whitespace-nowrap tabular-nums",
                        barra.tipo === "total"
                          ? "text-[9px] font-medium text-fg-subtle"
                          : "text-[10px] font-semibold",
                        barra.tipo === "aumento" && "text-success",
                        barra.tipo === "queda" && "text-danger",
                      )}
                    >
                      {rotuloValor}
                    </span>
                  </div>
                  <div
                    className={clsx(
                      "absolute mx-auto rounded-t-[4px] transition-opacity group-hover:opacity-80",
                      COR_CASCATA[barra.tipo],
                      barra.tipo === "total" ? "w-full max-w-5 opacity-80" : "w-full max-w-7",
                    )}
                    style={{
                      left: 0,
                      right: 0,
                      bottom: `${(base / max) * 100}%`,
                      height: `${Math.max((altura / max) * 100, 0.5)}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 flex pl-16 text-[10px] text-fg-subtle">
        {barras.map((barra) => (
          <span key={barra.chave} className="min-w-0 flex-1 text-center">
            {barra.rotulo}
          </span>
        ))}
      </div>
    </figure>
  );
}

/* --------------------------------- Seções -------------------------------- */

function Kpi({
  rotulo,
  valor,
  tomValor,
  variacao,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  /** Cor do número principal — só quando o valor em si já é um sinal (ex.: MRR líquido). */
  tomValor?: string;
  variacao?: { texto: string; tom: string } | null;
  detalhe: string;
}) {
  return (
    <Card className="border-l-4 border-l-cat-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{rotulo}</p>
      <p className={clsx("mt-2 text-2xl font-semibold", tomValor)}>{valor}</p>
      <p className="mt-1 text-xs text-fg-muted">
        {variacao ? <span className={clsx("font-semibold", variacao.tom)}>{variacao.texto}</span> : null}{" "}
        {detalhe}
      </p>
    </Card>
  );
}

function sinalSeta(valor: number) {
  return valor > 0 ? "▲" : valor < 0 ? "▼" : "■";
}

export function AbaFaturamento({ dados }: { dados: DadosFaturamento }) {
  const { meses, referencia, anterior, categorias, recorrencia: r } = dados;

  // Só o ano corrente no gráfico de movimento — os meses anteriores
  // (carga inicial de 13 meses) não interessam pra ver a tendência do ano.
  const anoAtual = meses.at(-1)?.chave.slice(0, 4) ?? "";
  const historicoDoAno = r.historicoMensal.filter((m) => m.mes.chave >= `${anoAtual}-01`);

  const variacaoMrr = variacaoPercentual(r.mrrAnterior, r.mrrReferencia);
  const deltaClientes = r.clientesReferencia - r.clientesAnterior;
  const deltaChurn =
    r.churnRate !== null && r.churnRateAnterior !== null ? r.churnRate - r.churnRateAnterior : null;

  const indiceRef = meses.findIndex((m) => m.chave === referencia.chave);
  const mrrPerdido = r.saidas.reduce((s, c) => s + c.mrr, 0);
  const mrrGanho = r.novos.reduce((s, c) => s + c.mrr, 0);

  return (
    <>
      {dados.erroSincronizacao ? (
        <Card className="flex items-start gap-3 p-4">
          <IconAlerta className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="text-sm font-medium">A última sincronização falhou</p>
            <p className="text-xs text-fg-muted">
              {dados.erroSincronizacao} Os números abaixo são da sincronização anterior.
            </p>
          </div>
        </Card>
      ) : null}

      {/* ------------------------ Faturamento por categoria ------------------------ */}
      <ChartCard
        title="Faturamento por categoria"
        hint="Ordens de serviço faturadas no Omie (ListarOS), por categoria e mês — a mesma base do resumo diário por e-mail, com o histórico completo do ano."
        legend={<Legenda categorias={categorias} />}
      >
        <ColunasEmpilhadas meses={meses} categorias={categorias} valores={dados.porMesCategoria} />
        {meses.at(-1)?.parcial ? (
          <p className="text-xs italic text-fg-subtle">
            {meses.at(-1)!.rotulo} é parcial — faturamento até a última sincronização.
          </p>
        ) : null}

        <ComparativoCategorias
          categorias={categorias}
          meses={meses}
          mesesReferencia={dados.mesesReferencia}
          porMesCategoria={dados.porMesCategoria}
          referencia={referencia}
          anterior={anterior}
        />
      </ChartCard>

      {/* ------------------------- Faturamento por cliente ------------------------- */}
      <ChartCard
        title="Faturamento por cliente"
        hint={`${referencia.rotulo} com variação vs. ${anterior.rotulo} — clique num cliente para ver a composição por categoria e o histórico do ano.`}
      >
        <TabelaClientesFaturamento
          clientes={dados.clientes}
          categorias={categorias}
          meses={meses}
          mesesReferencia={dados.mesesReferencia}
          referencia={referencia}
          anterior={anterior}
        />
      </ChartCard>

      {/* ---------------------------- Receita recorrente --------------------------- */}
      <section className="space-y-4 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Receita recorrente</h2>
            <p className="text-sm text-fg-muted">
              MRR · ARR · novos clientes · churn — categorias{" "}
              {r.categorias.map((c) => c.descricao).join(" e ") || "recorrentes"}
            </p>
          </div>
          <SeletorMesReferencia meses={dados.mesesReferencia} atual={referencia.chave} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            rotulo={`MRR — ${referencia.rotulo}`}
            valor={brlInteiro.format(r.mrrReferencia)}
            variacao={
              variacaoMrr === null
                ? null
                : { texto: `${sinalSeta(variacaoMrr)} ${formatarPercentual(variacaoMrr)}`, tom: tomVariacao(variacaoMrr) }
            }
            detalhe={`vs. ${anterior.rotulo}`}
          />
          <Kpi
            rotulo="ARR projetado"
            valor={brlCompacto.format(r.mrrReferencia * 12)}
            variacao={
              variacaoMrr === null
                ? null
                : { texto: `${sinalSeta(variacaoMrr)} ${formatarPercentual(variacaoMrr)}`, tom: tomVariacao(variacaoMrr) }
            }
            detalhe="MRR × 12"
          />
          <Kpi
            rotulo="Clientes recorrentes"
            valor={numero.format(r.clientesReferencia)}
            variacao={{
              texto: `${sinalSeta(deltaClientes)} ${deltaClientes > 0 ? "+" : ""}${numero.format(deltaClientes)}`,
              tom: tomVariacao(deltaClientes),
            }}
            detalhe={`vs. ${anterior.rotulo} (${numero.format(r.clientesAnterior)})`}
          />
          <Kpi
            rotulo={`Churn rate — ${referencia.rotulo}`}
            valor={r.churnRate === null ? "—" : `${r.churnRate.toFixed(2).replace(".", ",")}%`}
            variacao={
              deltaChurn === null
                ? null
                : {
                    texto: `${sinalSeta(deltaChurn)} ${deltaChurn > 0 ? "+" : "−"}${Math.abs(deltaChurn).toFixed(2).replace(".", ",")} p.p.`,
                    // Churn subindo é ruim: a cor inverte em relação às outras variações.
                    tom: tomVariacao(-deltaChurn),
                  }
            }
            detalhe={
              r.churnRateAnterior === null
                ? `vs. ${anterior.rotulo}`
                : `vs. ${anterior.rotulo} (${r.churnRateAnterior.toFixed(2).replace(".", ",")}%)`
            }
          />
        </div>

        {/* Ponte de MRR do mês: quem entrou, quem saiu, e o saldo dos dois —
            sem tracking de upsell/downsell de quem continua, é o resumo
            possível com os dados disponíveis. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi
            rotulo={`Novo MRR — ${referencia.rotulo}`}
            valor={`+${brlInteiro.format(mrrGanho)}`}
            tomValor="text-success"
            variacao={{
              texto: `${numero.format(r.novos.length)} cliente${r.novos.length === 1 ? "" : "s"} novo${r.novos.length === 1 ? "" : "s"}`,
              tom: "text-success",
            }}
            detalhe="entraram na recorrência"
          />
          <Kpi
            rotulo={`Churn — ${referencia.rotulo}`}
            valor={`−${brlInteiro.format(mrrPerdido)}`}
            tomValor="text-danger"
            variacao={{
              texto: `${numero.format(r.saidas.length)} saída${r.saidas.length === 1 ? "" : "s"}`,
              tom: "text-danger",
            }}
            detalhe="saíram da recorrência"
          />
          <Kpi
            rotulo={`MRR líquido — ${referencia.rotulo}`}
            valor={variacaoReais(mrrGanho - mrrPerdido)}
            tomValor={tomVariacao(mrrGanho - mrrPerdido)}
            variacao={{
              texto: `${sinalSeta(r.novos.length - r.saidas.length)} ${numero.format(Math.abs(r.novos.length - r.saidas.length))} cliente${Math.abs(r.novos.length - r.saidas.length) === 1 ? "" : "s"} de saldo`,
              tom: tomVariacao(r.novos.length - r.saidas.length),
            }}
            detalhe="novo MRR − churn"
          />
        </div>

        <ChartCard
          title="Composição do MRR"
          hint="Categorias recorrentes empilhadas, por mês."
          legend={<Legenda categorias={r.categorias} />}
        >
          <ColunasEmpilhadas
            meses={meses}
            categorias={r.categorias}
            valores={r.mrrPorMes.map((m) => m.porCategoria)}
            altura="h-40"
          />
        </ChartCard>

        <ChartCard
          title="Movimento de contratos"
          hint={`Saldo de contratos recorrentes, mês a mês desde ${historicoDoAno[0]?.mes.rotulo ?? "o início do ano"} — barras cheias são o saldo, flutuantes são novos e churn.`}
          legend={
            <>
              <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
                <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-cat-1" />
                Saldo
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
                <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-success" />
                Novos
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
                <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-danger" />
                Churn
              </span>
            </>
          }
        >
          <CascataContratos historico={historicoDoAno} alturaGrafico="h-40" />
        </ChartCard>

        <ChartCard
          title="Movimentação de clientes recorrentes"
          hint="Saldo, novos, churn e MRR mês a mês, sempre contra o mês anterior."
        >
          <TabelaHistoricoMrr historico={r.historicoMensal} />
        </ChartCard>

        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight">
                Movimentação {anterior.rotulo} → {referencia.rotulo}
              </h2>
              <p className="text-xs text-fg-muted">
                {numero.format(r.novos.length)} novos clientes (+{brlInteiro.format(mrrGanho)} de MRR),{" "}
                {numero.format(r.saidas.length)} saídas brutas (−{brlInteiro.format(mrrPerdido)}) e{" "}
                {numero.format(r.naoFaturados.length)} com contrato suspenso ou ativo sem faturar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <BotaoExportarMovimentacao
                novos={r.novos}
                saidas={r.saidas}
                naoFaturados={r.naoFaturados}
                referencia={referencia}
                anterior={anterior}
              />
              <SeletorMesCompacto meses={dados.mesesReferencia} atual={referencia.chave} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <ListaMovimentos titulo="Novos clientes" itens={r.novos} tipo="entrada" />
            <ListaMovimentos titulo="Churn" itens={r.saidas} tipo="saida" />
            <ListaSemFaturamento itens={r.naoFaturados} />
          </div>
        </Card>

        <ChartCard
          title="Churn — confirmado vs. em revisão"
          hint="Saída de faturamento mês a mês, cruzada com o status do contrato no Omie — só 'confirmado' (cancelado lá) é churn de fato; suspenso/ativo ainda podem ser reativação ou gap de faturamento."
        >
          <TabelaChurnMensal historico={r.historicoMensal} />
        </ChartCard>

        <p className="text-xs text-fg-subtle">
          Regras: categoria recorrente é a que tem “Recorrente” no nome; MRR é o faturado nelas no mês;
          cliente recorrente faturou alguma delas no mês; churn rate = saídas ÷ clientes recorrentes do mês
          anterior. Referência {indiceRef >= 0 ? referencia.rotulo : "—"}.
        </p>
      </section>
    </>
  );
}
