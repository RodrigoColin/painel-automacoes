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
  ListaMovimentos,
  SeletorMesReferencia,
  TabelaClientesFaturamento,
} from "@/components/omie-faturamento-interativo";
import { Card } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import type { CategoriaFaturamento, DadosFaturamento, Mes } from "@/lib/omie/faturamento";
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

function EixoY({ max }: { max: number }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 flex w-14 flex-col justify-between text-right text-[10px] tabular-nums text-fg-subtle">
      {[1, 2 / 3, 1 / 3, 0].map((t) => (
        <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
          {brlCompacto.format(max * t)}
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
}: {
  meses: Mes[];
  categorias: CategoriaFaturamento[];
  /** [mês][categoria] */
  valores: number[][];
}) {
  const totais = valores.map((linha) => linha.reduce((s, v) => s + v, 0));
  const max = escalaMaxima(totais);

  return (
    <figure className="m-0">
      <div className="relative pl-16">
        <EixoY max={max} />
        <div className="relative flex h-60 items-end border-b border-border-strong">
          <Grade />
          {meses.map((mes, iMes) => (
            <div
              key={mes.chave}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${mes.rotulo}${mes.parcial ? " (parcial)" : ""} · total ${brlInteiro.format(totais[iMes])}`}
            >
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
                      title={`${categoria.descricao} · ${mes.rotulo} · ${brlInteiro.format(valor)}`}
                      className={clsx("min-h-px w-full last:rounded-t-[4px]", FUNDO_CATEGORIA[categoria.slot])}
                      style={{ flexGrow: valor, flexBasis: 0 }}
                    />
                  );
                })}
              </div>
              <span className="sr-only">
                {mes.rotulo}: {brlInteiro.format(totais[iMes])}
              </span>
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

/**
 * Linhas mensais (2px) com uma faixa de hover por mês: a linha-guia acompanha
 * o mês e o tooltip lista todas as séries de uma vez.
 */
function LinhasMensais({
  meses,
  series,
}: {
  meses: Mes[];
  series: { rotulo: string; cor: string; valores: number[]; destaque?: boolean }[];
}) {
  const W = 1000;
  const H = 240;
  const max = escalaMaxima(series.flatMap((s) => s.valores));
  const x = (i: number) => (meses.length > 1 ? (i / (meses.length - 1)) * W : W / 2);
  const y = (v: number) => H - (v / max) * H;

  return (
    <figure className="m-0">
      <div className="relative pl-16">
        <EixoY max={max} />
        <div className="relative h-60 border-b border-border-strong">
          <Grade />
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={series.map((s) => s.rotulo).join(", ")}
          >
            {series.map((serie) => (
              <path
                key={serie.rotulo}
                d={serie.valores.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={serie.cor}
                strokeWidth={serie.destaque ? 2.5 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {/* Faixas de hover centradas em cada mês (largura de um intervalo), com a
              linha-guia no meio: o leitor mira o mês, não a linha de 2px. */}
          {meses.map((mes, i) => {
            const largura = meses.length > 1 ? 100 / (meses.length - 1) : 100;
            const centro = meses.length > 1 ? (i / (meses.length - 1)) * 100 : 50;
            return (
              <div
                key={mes.chave}
                className="group absolute inset-y-0"
                style={{ left: `${centro - largura / 2}%`, width: `${largura}%` }}
                title={[
                  `${mes.rotulo}${mes.parcial ? " (parcial)" : ""}`,
                  ...series.map((s) => `${s.rotulo}: ${brlInteiro.format(s.valores[i])}`),
                ].join("\n")}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-1/2 w-px bg-border-strong opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="relative mt-2 h-4 pl-16 text-[10px] text-fg-subtle">
        <div className="relative h-full">
          {meses.map((mes, i) => (
            <span
              key={mes.chave}
              className={clsx("absolute -translate-x-1/2", i % 2 === 1 && "hidden sm:inline")}
              style={{ left: meses.length > 1 ? `${(i / (meses.length - 1)) * 100}%` : "50%" }}
            >
              {mes.rotuloCurto}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

/* --------------------------------- Seções -------------------------------- */

function Kpi({
  rotulo,
  valor,
  variacao,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  variacao?: { texto: string; tom: string } | null;
  detalhe: string;
}) {
  return (
    <Card className="border-l-4 border-l-cat-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{rotulo}</p>
      <p className="mt-2 text-2xl font-semibold">{valor}</p>
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

  const totalAnterior = dados.comparativo.reduce((s, c) => s + c.anterior, 0);
  const totalReferencia = dados.comparativo.reduce((s, c) => s + c.referencia, 0);

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
        hint="Ordens de serviço faturadas no Omie (ListarOS), por categoria e mês — a mesma base do resumo diário por e-mail."
        legend={<Legenda categorias={categorias} />}
      >
        <ColunasEmpilhadas meses={meses} categorias={categorias} valores={dados.porMesCategoria} />
        {meses.at(-1)?.parcial ? (
          <p className="text-xs italic text-fg-subtle">
            {meses.at(-1)!.rotulo} é parcial — faturamento até a última sincronização.
          </p>
        ) : null}

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">
            Comparativo {anterior.rotulo} → {referencia.rotulo}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm lg:max-w-3xl">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-subtle">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">Categoria</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{anterior.rotulo}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{referencia.rotulo}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Var. R$</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Var. %</th>
                </tr>
              </thead>
              <tbody>
                {dados.comparativo.map((linha, i) => {
                  const diferenca = linha.referencia - linha.anterior;
                  return (
                    <tr key={linha.codigo} className="border-b border-border">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className={clsx("size-2.5 rounded-[3px]", FUNDO_CATEGORIA[categorias[i].slot])} />
                          {categorias[i].descricao}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{brlInteiro.format(linha.anterior)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brlInteiro.format(linha.referencia)}</td>
                      <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(diferenca))}>{variacaoReais(diferenca)}</td>
                      <td className={clsx("py-2 pl-3 text-right tabular-nums", tomVariacao(diferenca))}>
                        {formatarPercentual(variacaoPercentual(linha.anterior, linha.referencia))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Total geral</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brlInteiro.format(totalAnterior)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brlInteiro.format(totalReferencia)}</td>
                  <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(totalReferencia - totalAnterior))}>
                    {variacaoReais(totalReferencia - totalAnterior)}
                  </td>
                  <td className={clsx("py-2 pl-3 text-right tabular-nums", tomVariacao(totalReferencia - totalAnterior))}>
                    {formatarPercentual(variacaoPercentual(totalAnterior, totalReferencia))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </ChartCard>

      {/* ------------------------- Faturamento por cliente ------------------------- */}
      <ChartCard
        title="Faturamento por cliente"
        hint={`${referencia.rotulo} com variação contra ${anterior.rotulo} — clique num cliente para ver a composição por categoria e o histórico.`}
      >
        <TabelaClientesFaturamento
          clientes={dados.clientes}
          categorias={categorias}
          meses={meses}
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

        <ChartCard
          title="MRR mensal"
          hint="Faturamento das categorias recorrentes emitido no Omie, mês a mês. O último mês é parcial."
          legend={
            <>
              <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
                <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-fg" />
                Total
              </span>
              {r.categorias.map((c) => (
                <span key={c.codigo} className="inline-flex items-center gap-2 text-xs text-fg-muted">
                  <span aria-hidden="true" className={clsx("h-0.5 w-4 rounded-full", FUNDO_CATEGORIA[c.slot])} />
                  {c.descricao}
                </span>
              ))}
            </>
          }
        >
          <LinhasMensais
            meses={meses}
            series={[
              { rotulo: "Total", cor: "var(--fg)", valores: r.mrrPorMes.map((m) => m.total), destaque: true },
              ...r.categorias.map((c, i) => ({
                rotulo: c.descricao,
                cor: c.slot > 0 ? `var(--cat-${c.slot})` : "var(--fg-subtle)",
                valores: r.mrrPorMes.map((m) => m.porCategoria[i]),
              })),
            ]}
          />
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <ChartCard
            title="Composição do MRR"
            hint="Categorias recorrentes empilhadas, por mês."
            legend={<Legenda categorias={r.categorias} />}
          >
            <ColunasEmpilhadas
              meses={meses}
              categorias={r.categorias}
              valores={r.mrrPorMes.map((m) => m.porCategoria)}
            />
          </ChartCard>

          <ChartCard
            title={`Churn — ${referencia.rotulo}`}
            hint={`Clientes recorrentes em ${anterior.rotulo} sem faturamento recorrente em ${referencia.rotulo}.`}
          >
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-2xl font-semibold text-danger">{numero.format(r.saidas.length)}</p>
                <p className="text-xs uppercase tracking-wider text-fg-subtle">Saídas</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-success">{numero.format(r.novos.length)}</p>
                <p className="text-xs uppercase tracking-wider text-fg-subtle">Novos</p>
              </div>
              <div>
                <p className={clsx("text-2xl font-semibold", tomVariacao(r.novos.length - r.saidas.length))}>
                  {r.novos.length - r.saidas.length > 0 ? "+" : ""}
                  {numero.format(r.novos.length - r.saidas.length)}
                </p>
                <p className="text-xs uppercase tracking-wider text-fg-subtle">Saldo</p>
              </div>
            </div>

            {/* Barra de proporção: MRR ganho × MRR perdido no mês, com valores escritos. */}
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-muted">
                {mrrGanho + mrrPerdido > 0 ? (
                  <>
                    <div className="h-full min-w-[4px] rounded-full bg-success" style={{ flexGrow: mrrGanho }} title={`MRR ganho · ${brlInteiro.format(mrrGanho)}`} />
                    <div className="h-full min-w-[4px] rounded-full bg-danger" style={{ flexGrow: mrrPerdido }} title={`MRR perdido · ${brlInteiro.format(mrrPerdido)}`} />
                  </>
                ) : null}
              </div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2 rounded-full bg-success" />
                    MRR de novos clientes
                  </span>
                  <span className="tabular-nums text-success">+{brlInteiro.format(mrrGanho)}</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
                    MRR perdido com saídas
                  </span>
                  <span className="tabular-nums text-danger">−{brlInteiro.format(mrrPerdido)}</span>
                </li>
              </ul>
              <p className="text-xs text-fg-subtle">
                Saída bruta: ainda não cruzada com o status do contrato no Omie (cancelado, suspenso ou
                só um mês sem faturar).
              </p>
            </div>
          </ChartCard>
        </div>

        <Card className="space-y-4 p-4 sm:p-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">
              Movimentação {anterior.rotulo} → {referencia.rotulo}
            </h2>
            <p className="text-xs text-fg-muted">
              {numero.format(r.novos.length)} novos clientes (+{brlInteiro.format(mrrGanho)} de MRR) e{" "}
              {numero.format(r.saidas.length)} saídas brutas (−{brlInteiro.format(mrrPerdido)}).
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ListaMovimentos titulo="Novos clientes" itens={r.novos} tipo="entrada" />
            <ListaMovimentos titulo="Churn" itens={r.saidas} tipo="saida" />
          </div>
        </Card>

        <p className="text-xs text-fg-subtle">
          Regras: categoria recorrente é a que tem “Recorrente” no nome; MRR é o faturado nelas no mês;
          cliente recorrente faturou alguma delas no mês; churn rate = saídas ÷ clientes recorrentes do mês
          anterior. Referência {indiceRef >= 0 ? referencia.rotulo : "—"}.
        </p>
      </section>
    </>
  );
}
