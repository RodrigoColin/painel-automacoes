"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { consultarVariacaoDia, solicitarVariacaoDia } from "@/lib/fluxo-caixa/acoes-variacao";
import { clsx } from "@/lib/clsx";
import { brl, k, nomeMes } from "@/lib/fluxo-caixa/calculos";
import type { Extra, VariacaoItem, VariacaoRef } from "@/lib/fluxo-caixa/tipos";
import { Secao, Segmentado, tab } from "@/components/fluxo-caixa/pecas";

const ORDEM_REFS = ["1d", "7d", "15d", "30d"];
const ROTULOS: Record<string, string> = { "1d": "ontem", "7d": "7 dias atrás", "15d": "15 dias atrás", "30d": "30 dias atrás" };
const SEM_DETALHE = "(sem detalhe por cliente)";

function dataBr(iso?: string) {
  return iso ? iso.split("-").reverse().join("/") : "";
}

type CausaId = "real" | "novo" | "mud";

/** Rótulo em linguagem de negócio para (natureza, causa dominante, sinal). */
function rotuloNegocio(natureza: "receita" | "despesa", causa: CausaId, positivo: boolean): string {
  if (natureza === "receita") {
    if (causa === "real") return positivo ? "entrou acima do previsto" : "entrou abaixo do previsto";
    if (causa === "novo") return positivo ? "faturamento novo" : "faturamento cancelado";
    return positivo ? "projeção de receita maior" : "projeção de receita menor";
  }
  if (causa === "real") return positivo ? "pagamos menos que o previsto" : "pagamos mais que o previsto";
  if (causa === "novo") return positivo ? "despesa removida" : "despesa nova";
  return positivo ? "despesa menor" : "despesa maior";
}

/** Explicação de 1 frase para cada rótulo — a chave "fato × previsão" (tooltip). */
function dicaNegocio(natureza: "receita" | "despesa", causa: CausaId, positivo: boolean): string {
  if (causa === "real") {
    return natureza === "receita"
      ? `Fato: no mês corrente ${positivo ? "entrou mais" : "entrou menos"} dinheiro do que a base anterior projetava.`
      : `Fato: no mês corrente ${positivo ? "saiu menos" : "saiu mais"} dinheiro do que a base anterior projetava.`;
  }
  if (causa === "novo") {
    return positivo === (natureza === "receita")
      ? "Título/contrato novo no sistema — não existia na base anterior."
      : "Lançamento que existia na base anterior e foi cancelado/removido.";
  }
  return `Previsão (meses futuros): a ${natureza} projetada de quem já existia ${(natureza === "receita") === positivo ? "aumentou" : "diminuiu"} — nada entrou ou saiu do caixa ainda.`;
}

type Evento = {
  categoria: string;
  natureza: "receita" | "despesa";
  total: number;
  rotulo: string;
  rotuloDica: string;
  clientes: { cliente: string; delta: number; rotulo: string; dica: string }[];
};

/** Agrega os itens das causas em variações POR CATEGORIA, separadas por natureza.
 * Formato novo: item já é a categoria, com clientes aninhados (lista de categorias completa —
 * os subtotais reconciliam com os totais das causas). Formato antigo: item por cliente. */
function montarEventos(v: VariacaoRef): { receitas: Evento[]; despesas: Evento[] } {
  const buckets: [CausaId, VariacaoItem[]][] = [
    ["real", v.causas.realizacao?.itens ?? []],
    ["novo", v.causas.novoLancamento?.itens ?? []],
    ["mud", v.causas.mudancaReal?.itens ?? []],
  ];
  const mapa = new Map<string, Evento & { porCausa: Record<CausaId, number> }>();
  for (const [causa, itens] of buckets) {
    for (const it of itens) {
      const nat = it.natureza ?? (it.delta > 0 ? "receita" : "despesa");
      const chave = `${nat}|${it.categoria}`;
      const ev = mapa.get(chave) ?? {
        categoria: it.categoria,
        natureza: nat,
        total: 0,
        rotulo: "",
        rotuloDica: "",
        clientes: [],
        porCausa: { real: 0, novo: 0, mud: 0 },
      };
      ev.total += it.delta;
      ev.porCausa[causa] += it.delta;
      if (it.clientes?.length) {
        for (const c of it.clientes) {
          ev.clientes.push({ cliente: c.cliente, delta: c.delta, rotulo: rotuloNegocio(nat, causa, c.delta > 0), dica: dicaNegocio(nat, causa, c.delta > 0) });
        }
      } else if (it.cliente) {
        ev.clientes.push({ cliente: it.cliente, delta: it.delta, rotulo: rotuloNegocio(nat, causa, it.delta > 0), dica: dicaNegocio(nat, causa, it.delta > 0) });
      }
      mapa.set(chave, ev);
    }
  }
  const eventos = [...mapa.values()]
    .filter((e) => Math.abs(e.total) >= 1)
    .map((e) => {
      const dominante = (Object.entries(e.porCausa) as [CausaId, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0];
      e.rotulo = rotuloNegocio(e.natureza, dominante, e.total > 0);
      e.rotuloDica = dicaNegocio(e.natureza, dominante, e.total > 0);
      e.clientes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return e;
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return {
    receitas: eventos.filter((e) => e.natureza === "receita"),
    despesas: eventos.filter((e) => e.natureza === "despesa"),
  };
}

type PassoCascata = { nome: string; delta?: number; nivel?: number; cor?: string };

/**
 * Gráfico em cascata (waterfall/"ponte"): do número da data-base ao de hoje, cada causa é
 * uma barra flutuante que sobe (verde) ou desce (vermelho) de onde a anterior parou. Os
 * níveis (início/fim) são barras neutras ancoradas na base do gráfico.
 */
function Cascata({ passos }: { passos: PassoCascata[] }) {
  const COL = 128;
  const W = Math.max(560, passos.length * COL);
  const H = 240;
  const padT = 26;
  const padB = 44;

  // nível acumulado ao fim de cada passo (sem mutação — regra de render)
  const niveis = passos.reduce<number[]>((acc, p) => {
    const prev = acc.length ? acc[acc.length - 1] : (p.nivel ?? 0);
    return [...acc, p.nivel !== undefined ? p.nivel : prev + (p.delta ?? 0)];
  }, []);
  const pontos: { passo: PassoCascata; de: number; ate: number }[] = passos.map((p, i) => ({
    passo: p,
    de: i === 0 ? niveis[0] : niveis[i - 1],
    ate: niveis[i],
  }));
  const valores = pontos.flatMap((p) => [p.de, p.ate]);
  const vMin = Math.min(...valores);
  const vMax = Math.max(...valores);
  const folga = Math.max(1, (vMax - vMin) * 0.14);
  const y = (v: number) => padT + ((vMax + folga - v) / (vMax - vMin + 2 * folga)) * (H - padT - padB);
  const fundo = y(vMin - folga);

  const barW = 64;
  const cx = (i: number) => i * COL + COL / 2;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 560 }} className="block w-full" role="img" aria-label="Ponte da variação">
        {pontos.map((p, i) => {
          const nivel = p.passo.nivel !== undefined;
          const topo = nivel ? Math.min(y(p.ate), fundo) : Math.min(y(p.de), y(p.ate));
          const base = nivel ? Math.max(y(p.ate), fundo) : Math.max(y(p.de), y(p.ate));
          const alt = Math.max(2, base - topo);
          const valor = nivel ? p.ate : (p.passo.delta ?? 0);
          const cor = p.passo.cor ?? (nivel ? "var(--fg-subtle)" : valor >= 0 ? "var(--success)" : "var(--danger)");
          const nome = p.passo.nome;
          const linhas = nome.length > 14 ? [nome.slice(0, nome.lastIndexOf(" ", 14) > 3 ? nome.lastIndexOf(" ", 14) : 14), nome.slice(nome.lastIndexOf(" ", 14) > 3 ? nome.lastIndexOf(" ", 14) + 1 : 14)] : [nome];
          return (
            <g key={i}>
              {i < pontos.length - 1 ? (
                <line x1={cx(i) + barW / 2} y1={y(p.ate)} x2={cx(i + 1) - barW / 2} y2={y(p.ate)} stroke="var(--fg-subtle)" strokeDasharray="3 4" strokeWidth={1} opacity={0.7} />
              ) : null}
              <rect x={cx(i) - barW / 2} y={topo} width={barW} height={alt} rx={3} fill={cor} opacity={nivel ? 0.55 : 0.9}>
                <title>{`${nome}: ${brl(valor)}`}</title>
              </rect>
              <text x={cx(i)} y={topo - 7} textAnchor="middle" fontSize={12} fontWeight={700} fill={nivel ? "var(--fg)" : cor} style={{ fontVariantNumeric: "tabular-nums" }}>
                {!nivel && valor > 0 ? "+" : ""}{k(valor)}
              </text>
              {linhas.map((l, j) => (
                <text key={j} x={cx(i)} y={H - padB + 16 + j * 13} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">
                  {l}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Resumo de 1 linha da variação (vs. 7 dias atrás), para o TOPO do painel — visível em
 * todas as abas; clicar leva à aba "Variação". Some quando não há snapshot de referência.
 */
export function ResumoVariacao({ extra, onVer }: { extra: Extra; onVer: () => void }) {
  const refs = extra.variacao ?? {};
  const v = refs["7d"] ?? refs[ORDEM_REFS.find((r) => refs[r]) ?? ""];
  if (!v) return null;
  const deltaAno = v.causas.deltaFimAnoComRegra ?? v.causas.deltaFimAno;
  const { receitas, despesas } = montarEventos(v);
  const top = [...receitas, ...despesas].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))[0];
  if (Math.abs(deltaAno) < 1 && !top) return null;
  const neg = deltaAno < 0;
  return (
    <button
      type="button"
      onClick={onVer}
      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        Desde {dataBr(v.refData)}: caixa de fim do ano{" "}
        <b className={clsx("tabular-nums", neg && "text-danger")}>{deltaAno > 0 ? "+" : ""}{k(deltaAno)}</b>
        {top ? (
          <span className="text-fg-muted"> · principal: {top.categoria} ({top.total > 0 ? "+" : ""}{k(top.total)} — {top.rotulo})</span>
        ) : null}
      </span>
      <span className="shrink-0 font-medium text-accent">Ver por quê →</span>
    </button>
  );
}

type EstadoLivre = { data: string; status: "carregando" | "pronta" | "erro"; resultado?: VariacaoRef; erro?: string };

export function AbaVariacao({
  extra,
  empresaId,
  datasPacotes = [],
}: {
  extra: Extra;
  empresaId?: string;
  datasPacotes?: string[];
}) {
  const refs = extra.variacao ?? {};
  const disponiveis = ORDEM_REFS.filter((r) => refs[r]);
  const [ref, setRef] = useState<string>(disponiveis.includes("7d") ? "7d" : (disponiveis[0] ?? "7d"));
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [livre, setLivre] = useState<EstadoLivre | null>(null);

  // datas elegíveis p/ comparação livre: tudo que tem pacote, menos o pacote atual (a 1ª)
  const datasLivres = datasPacotes.slice(1, 61);

  async function escolherDataLivre(data: string) {
    if (!data || !empresaId) return;
    setRef("livre");
    setLivre({ data, status: "carregando" });
    const r = await solicitarVariacaoDia(empresaId, data);
    if (r.status === "pronta") setLivre({ data, status: "pronta", resultado: r.resultado });
    else if (r.status === "erro") setLivre({ data, status: "erro", erro: r.erro });
    // na_fila/calculando: o useEffect abaixo faz o polling
  }

  // polling do cálculo sob demanda (o worker resolve em segundos; durante uma
  // rodada longa ele espera a vez — por isso sem timeout curto)
  useEffect(() => {
    if (!livre || livre.status !== "carregando" || !empresaId) return;
    const data = livre.data;
    const timer = setInterval(async () => {
      const r = await consultarVariacaoDia(empresaId, data);
      if (r.status === "pronta") setLivre({ data, status: "pronta", resultado: r.resultado });
      else if (r.status === "erro") setLivre({ data, status: "erro", erro: r.erro });
    }, 4000);
    return () => clearInterval(timer);
  }, [livre, empresaId]);

  const v: VariacaoRef | undefined =
    ref === "livre" ? livre?.resultado : (refs[ref] ?? (disponiveis[0] ? refs[disponiveis[0]] : undefined));
  const eventos = useMemo(() => (v ? montarEventos(v) : { receitas: [], despesas: [] }), [v]);

  const seletor = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {disponiveis.length ? (
          <Segmentado
            rotulo="Comparar com"
            valor={ref}
            onMudar={(r) => { setRef(r); }}
            opcoes={disponiveis.map((r) => ({ valor: r, rotulo: ROTULOS[r] ?? r }))}
          />
        ) : null}
        {empresaId && datasLivres.length ? (
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            outra data:
            <select
              value={ref === "livre" ? (livre?.data ?? "") : ""}
              onChange={(e) => escolherDataLivre(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">—</option>
              {datasLivres.map((d) => (
                <option key={d} value={d}>{dataBr(d)}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <span className="text-xs text-fg-muted">
        Base: {dataBr(ref === "livre" ? livre?.data : v?.refData)} → hoje · caixa acumulado · R$
      </span>
    </div>
  );

  if (ref === "livre" && livre && livre.status !== "pronta") {
    return (
      <div className="flex flex-col gap-5">
        {seletor}
        <Secao titulo={`O que mudou desde ${dataBr(livre.data)}`} dica="Cálculo sob demanda, feito pelo mesmo motor das comparações rápidas.">
          {livre.status === "carregando" ? (
            <p className="text-sm text-fg-muted">
              Calculando a variação desde {dataBr(livre.data)}… normalmente leva segundos. Se uma atualização do fluxo
              de caixa estiver em andamento, o cálculo entra logo depois dela.
            </p>
          ) : (
            <p className="text-sm text-danger">{livre.erro ?? "Falha no cálculo — tente de novo."}</p>
          )}
        </Secao>
      </div>
    );
  }

  if (!v) {
    return (
      <Secao titulo="Variação" dica="O que mudou de um período para o outro.">
        <p className="text-sm text-fg-muted">
          Ainda não há histórico suficiente para a ponte de variação. Assim que houver um snapshot de alguns dias atrás
          (as rodadas gravam um por dia), esta aba passa a mostrar <strong>por que o caixa mudou</strong>.
        </p>
      </Secao>
    );
  }

  const alvoMes = v.alvos[v.mesCorrente];
  const alvoAno = v.alvos[v.fimAno];
  const deltaMes = alvoMes?.deltaComRegra ?? alvoMes?.delta ?? 0;
  const deltaAno = v.causas.deltaFimAnoComRegra ?? v.causas.deltaFimAno;
  const premissa = v.causas.premissa ?? 0;
  const ancoragem = v.causas.ancoragem ?? 0;
  const timing = v.causas.deslocamentoTiming;
  // Recebimentos: nominais por cliente. Pagamentos: UMA linha pelo total da categoria
  // (decisão do Rodrigo, caso folha — recorrência com valor-padrão gera pares falsos por
  // funcionário; o que interessa é a linha "Salários" como um todo). Itens de despesa COM
  // cliente são do formato antigo (por funcionário) e ficam de fora.
  const timingItens = (v.causas.deslocamentoTimingItens ?? []).filter((t) =>
    (t.natureza ?? "receita") === "receita" ? !!t.cliente && t.cliente !== SEM_DETALHE : !t.cliente,
  );
  const timingReceb =
    v.causas.deslocamentoTimingRecebimentos ??
    timingItens.filter((t) => (t.natureza ?? "receita") === "receita").reduce((s, t) => s + t.valor, 0);
  const timingPag = v.causas.deslocamentoTimingPagamentos ?? 0;

  const totR = eventos.receitas.reduce((s, e) => s + e.total, 0);
  const totD = eventos.despesas.reduce((s, e) => s + e.total, 0);
  const maiorReceita = eventos.receitas[0];
  const maiorDespesa = eventos.despesas[0];

  // Frase executiva: o movimento dominante primeiro, em português de gente.
  const partes: string[] = [];
  if (Math.abs(totR) >= 1 && maiorReceita) partes.push(`${totR > 0 ? "entrou" : "saiu da projeção"} ${brl(Math.abs(totR))} em receitas (principalmente ${maiorReceita.categoria})`);
  if (Math.abs(totD) >= 1 && maiorDespesa) partes.push(`${totD < 0 ? "as despesas pesaram" : "as despesas aliviaram"} ${brl(Math.abs(totD))} (${maiorDespesa.categoria})`);
  if (Math.abs(premissa) >= 1) partes.push(`a média ${premissa > 0 ? "repôs" : "devolveu"} ${brl(Math.abs(premissa))} de cobertura projetada`);

  return (
    <div className="flex flex-col gap-5">
      {seletor}

      <Secao titulo={`O que mudou desde ${dataBr(v.refData)}`} dica="A variação do caixa projetado, explicada em linguagem de negócio. Clique numa linha para abrir os clientes.">
        <p className="text-sm">
          O caixa projetado de <strong>fim do ano</strong> {deltaAno > 0 ? "melhorou" : deltaAno < 0 ? "piorou" : "não mudou"}{" "}
          <strong className={clsx(deltaAno < 0 && "text-danger")}>{brl(Math.abs(deltaAno))}</strong>
          {partes.length ? <>: {partes.join("; ")}.</> : "."}
          {timingReceb >= 1 ? (
            <> Além disso, <strong>{brl(timingReceb)}</strong> em recebimentos apenas mudou de mês (timing) — não altera o ano.</>
          ) : null}
        </p>
      </Secao>

      <div className="grid gap-4 sm:grid-cols-2">
        <Alvo
          titulo={`Fim de ${nomeMes(v.mesCorrente)} (mês corrente)`}
          delta={deltaMes}
          de={alvoMes ? { acumA: alvoMes.acumAComRegra ?? alvoMes.acumA, acumB: alvoMes.acumBComRegra ?? alvoMes.acumB } : undefined}
        />
        <Alvo
          titulo={`Fim do ano (${nomeMes(v.fimAno)})`}
          delta={deltaAno}
          de={alvoAno ? { acumA: alvoAno.acumAComRegra ?? alvoAno.acumA, acumB: alvoAno.acumBComRegra ?? alvoAno.acumB } : undefined}
        />
      </div>

      {(() => {
        if (!alvoAno) return null;
        const inicio = alvoAno.acumAComRegra ?? alvoAno.acumA;
        const fim = alvoAno.acumBComRegra ?? alvoAno.acumB;
        const ajustes = ancoragem + (v.causas.residuo ?? 0);
        const passos: PassoCascata[] = [
          { nome: `Projeção ${dataBr(v.refData)}`, nivel: inicio },
          ...(Math.abs(totR) >= 1 ? [{ nome: "Receitas", delta: totR }] : []),
          ...(Math.abs(totD) >= 1 ? [{ nome: "Despesas", delta: totD }] : []),
          ...(Math.abs(premissa) >= 1
            ? [{ nome: premissa > 0 ? "Média repôs cobertura" : "Média repôs menos", delta: premissa, cor: "var(--warning)" }]
            : []),
          ...(Math.abs(ajustes) >= 1 ? [{ nome: "Ajustes", delta: ajustes }] : []),
          { nome: "Projeção hoje", nivel: fim },
        ];
        if (passos.length < 3) return null; // sem causa relevante, a cascata não conta nada
        return (
          <Secao
            titulo="A ponte da variação"
            dica={`Do caixa de fim do ano projetado em ${dataBr(v.refData)} ao projetado hoje: verde puxa pra cima, vermelho pra baixo. A barra âmbar é premissa — a projeção pela média (6 meses) repondo cobertura sem contrato lançado ainda, não dinheiro realizado.`}
          >
            <Cascata passos={passos} />
          </Secao>
        );
      })()}

      <BlocoNatureza
        titulo="Receitas — o que mudou"
        dica={'Chave de leitura: "entrou..." = fato no mês corrente · "faturamento novo/cancelado" = título que surgiu ou saiu do sistema · "projeção..." = expectativa dos meses futuros mudou. Passe o mouse no rótulo para a explicação.'}
        total={totR}
        eventos={eventos.receitas}
        abertos={abertos}
        setAbertos={setAbertos}
        vazio="Nenhuma variação de receita relevante no período."
      />
      <BlocoNatureza
        titulo="Despesas — o que mudou"
        dica={'Chave de leitura: "pagamos..." = fato no mês corrente · "despesa nova/removida" = lançamento que surgiu ou saiu do sistema · "despesa maior/menor" = projeção futura mudou. Passe o mouse no rótulo para a explicação.'}
        total={totD}
        eventos={eventos.despesas}
        abertos={abertos}
        setAbertos={setAbertos}
        vazio="Nenhuma variação de despesa relevante no período."
      />

      {Math.abs(premissa) >= 1 || Math.abs(ancoragem) >= 1 ? (
        <Secao titulo="Projeção pela média e ajustes" dica="A parte da variação que é premissa do modelo, não fato de cliente: a regra do dashboard completa cada categoria de receita futura até a média de 6 meses quando a cobertura real (contratos/títulos lançados) está abaixo dela.">
          <div className="flex flex-col gap-1.5 text-sm">
            {Math.abs(premissa) >= 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => setAbertos({ ...abertos, media: !abertos.media })}
                  className="flex items-baseline justify-between gap-3 rounded px-1 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>
                    <span className="mr-1 text-fg-muted">{abertos.media ? "▾" : "▸"}</span>
                    {premissa > 0
                      ? "Média repôs cobertura — categorias perderam contrato/título lançado e a regra completou a diferença pela média"
                      : "Média repôs menos — contrato/título real lançado substituiu a premissa (ou a média caiu)"}
                  </span>
                  <b className={clsx("tabular-nums", premissa < 0 && "text-danger")}>{premissa > 0 ? "+" : ""}{k(premissa)}</b>
                </button>
                {abertos.media && (v.causas.premissaItens?.length ?? 0) > 0 ? (
                  <div className="mb-1 ml-5 overflow-x-auto rounded-lg border border-border">
                    <table className={tab.table}>
                      <tbody>
                        {(v.causas.premissaItens ?? []).map((it, i) => (
                          <tr key={i}>
                            <td className={clsx(tab.td, "text-xs")}>{it.categoria}</td>
                            <td className={clsx(tab.td, "text-xs text-fg-muted")}>
                              {it.delta > 0 ? "média repondo a mais" : "média repondo a menos"}
                            </td>
                            <td className={clsx(tab.tdR, "text-xs tabular-nums", it.delta < 0 && "text-danger")}>{brl(it.delta)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
            {Math.abs(ancoragem) >= 1 ? (
              <div className="flex items-baseline justify-between gap-3 text-fg-muted">
                <span>Ajuste técnico de ancoragem no caixa real do mês</span>
                <b className="tabular-nums">{k(ancoragem)}</b>
              </div>
            ) : null}
          </div>
        </Secao>
      ) : null}

      {timing >= 1 ? (
        <Secao
          titulo="Só mudou de mês (timing)"
          dica="Dinheiro que saiu de um mês e reapareceu em outro — o total do ano não muda; muda em qual mês ele se move. Recebimentos aparecem por cliente; pagamentos pelo total da categoria (ex.: a linha Salários inteira, sem detalhe por favorecido)."
        >
          {timingItens.length ? (
            <div className={clsx(tab.wrap, "-mx-4 sm:-mx-5")}>
              <table className={clsx(tab.table, "min-w-max")}>
                <tbody>
                  {timingItens.map((t, i) => {
                    const receita = (t.natureza ?? "receita") === "receita";
                    return (
                      <tr key={i}>
                        <td className={clsx(tab.td, "max-w-72 truncate text-sm")} title={receita ? t.cliente : t.categoria}>
                          {receita ? t.cliente : t.categoria}
                        </td>
                        <td className={clsx(tab.td, "text-xs text-fg-muted")}>
                          {receita ? `${t.categoria} · recebimento` : "pagamento · total da categoria"}
                        </td>
                        <td className={clsx(tab.td, "whitespace-nowrap text-xs text-fg-muted")}>{nomeMes(t.de)} → {nomeMes(t.para)}</td>
                        <td className={clsx(tab.tdR, "tabular-nums text-sm")}>{brl(t.valor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : timingReceb + timingPag >= 1 ? (
            <p className="text-sm text-fg-muted">
              {brl(timingReceb + timingPag)} mudaram de mês dentro do ano (sem detalhe neste pacote).
            </p>
          ) : null}
        </Secao>
      ) : null}

      {Math.abs(v.causas.residuo) >= 1 ? (
        <p className="text-xs text-fg-subtle">Resíduo não atribuído: {brl(v.causas.residuo)}.</p>
      ) : null}
    </div>
  );
}

function BlocoNatureza({
  titulo,
  dica,
  total,
  eventos,
  abertos,
  setAbertos,
  vazio,
}: {
  titulo: string;
  dica?: string;
  total: number;
  eventos: Evento[];
  abertos: Record<string, boolean>;
  setAbertos: (a: Record<string, boolean>) => void;
  vazio: string;
}) {
  const LIMIAR = 1000;
  const principais = eventos.filter((e) => Math.abs(e.total) >= LIMIAR);
  const menores = eventos.filter((e) => Math.abs(e.total) < LIMIAR);
  const somaMenores = menores.reduce((s, e) => s + e.total, 0);
  const maxAbs = Math.max(1, ...eventos.map((e) => Math.abs(e.total)));

  return (
    <Secao
      titulo={titulo}
      dica={dica}
      acoes={<b className={clsx("tabular-nums text-sm", total < 0 && "text-danger")}>{total > 0 ? "+" : ""}{k(total)}</b>}
    >
      {eventos.length === 0 ? (
        <p className="text-sm text-fg-muted">{vazio}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {principais.map((e) => {
            const chave = `${e.natureza}|${e.categoria}`;
            const aberto = abertos[chave];
            const neg = e.total < 0;
            const clientes = e.clientes.filter((c) => c.cliente !== SEM_DETALHE);
            // resto = o total da categoria menos os clientes exibidos (clientes truncados no
            // pacote + parcela sem detalhe por cliente, ex.: projeções)
            const semDetalhe = e.total - clientes.reduce((s, c) => s + c.delta, 0);
            return (
              <Fragment key={chave}>
                <button
                  type="button"
                  onClick={() => setAbertos({ ...abertos, [chave]: !aberto })}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="w-3 text-fg-muted">{aberto ? "▾" : "▸"}</span>
                      <span className="font-medium">{e.categoria}</span>
                      <span className="cursor-help text-xs text-fg-muted underline decoration-dotted underline-offset-2" title={e.rotuloDica}>{e.rotulo}</span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <span className={clsx("block h-full rounded-full", neg ? "bg-danger" : "bg-success")} style={{ width: `${(Math.abs(e.total) / maxAbs) * 100}%` }} />
                    </span>
                  </span>
                  <b className={clsx("tabular-nums text-sm", neg && "text-danger")}>{e.total > 0 ? "+" : ""}{k(e.total)}</b>
                </button>
                {aberto ? (
                  <div className="mb-1 ml-6 overflow-x-auto rounded-lg border border-border">
                    <table className={tab.table}>
                      <tbody>
                        {clientes.map((c, i) => (
                          <tr key={i}>
                            <td className={clsx(tab.td, "max-w-72 truncate text-xs")} title={c.cliente}>{c.cliente}</td>
                            <td className={clsx(tab.td, "cursor-help text-xs text-fg-muted")} title={c.dica}>{c.rotulo}</td>
                            <td className={clsx(tab.tdR, "text-xs tabular-nums", c.delta < 0 && "text-danger")}>{brl(c.delta)}</td>
                          </tr>
                        ))}
                        {Math.abs(semDetalhe) >= 1 ? (
                          <tr className="text-fg-muted">
                            <td className={clsx(tab.td, "text-xs")}>(demais clientes e parcelas sem detalhe)</td>
                            <td className={tab.td} />
                            <td className={clsx(tab.tdR, "text-xs tabular-nums", semDetalhe < 0 && "text-danger")}>{brl(semDetalhe)}</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
          {Math.abs(somaMenores) >= 1 ? (
            <div className="flex items-baseline justify-between gap-3 px-3 py-1 text-xs text-fg-muted">
              <span>⋯ outras {menores.length} variações menores</span>
              <b className={clsx("tabular-nums", somaMenores < 0 && "text-danger")}>{somaMenores > 0 ? "+" : ""}{k(somaMenores)}</b>
            </div>
          ) : null}
        </div>
      )}
    </Secao>
  );
}

function Alvo({ titulo, delta, de }: { titulo: string; delta: number; de?: { acumA: number; acumB: number } }) {
  const neg = delta < 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{titulo}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", neg && "text-danger")}>
        {delta > 0 ? "+" : ""}
        {brl(delta)}
      </div>
      {de ? (
        <div className="mt-1 text-xs text-fg-muted tabular-nums">
          {brl(de.acumA)} → {brl(de.acumB)}
        </div>
      ) : null}
    </div>
  );
}
