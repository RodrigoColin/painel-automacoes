"use client";

import { Fragment, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { clsx } from "@/lib/clsx";
import {
  baixarCsv,
  brl,
  catmesAjustado,
  diaDaSemana,
  diaMes,
  k,
  nomeMes,
  numeroCsv,
  slug,
  type LinhaMensal,
  type ParametrosCenario,
} from "@/lib/fluxo-caixa/calculos";
import {
  GRUPOS_DESPESA,
  GRUPOS_RECEITA,
  dividirCategoria,
  grupoDe,
  grupoPorId,
  type GrupoFluxo,
} from "@/lib/fluxo-caixa/grupos";
import type { Extra, Extrato, Movimento } from "@/lib/fluxo-caixa/tipos";
import { GraficoSaldo } from "@/components/fluxo-caixa/graficos";
import { BotaoLeve, Secao, Segmentado, tab } from "@/components/fluxo-caixa/pecas";

type Grao = "dia" | "mes";
type Bucket = { topo: string; sub: string; apagado: boolean; mes?: string; fechado?: boolean };
type Item = {
  cat: string;
  valor: number;
  nome?: string;
  data?: string;
  doc?: string;
  realizado?: boolean;
  peso: number;
  deslocado?: boolean;
  original?: string;
  valorTitulo?: number;
};

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function AbaCategoria({
  extrato,
  extra,
  movs,
  mensal,
  cenario,
  usaRegra,
  ajustes,
  limite,
  minimo,
  provedor = "omie",
}: {
  extrato: Extrato;
  extra: Extra;
  movs: Movimento[];
  mensal: LinhaMensal[];
  cenario: ParametrosCenario;
  usaRegra: boolean;
  ajustes: Record<string, string>;
  limite: number;
  minimo: number | null;
  provedor?: string;
}) {
  const [grao, setGrao] = useState<Grao>("dia");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [mostraFechados, setMostraFechados] = useState(false);
  const [detalhe, setDetalhe] = useState<{ chave: string; bucket: number } | null>(null);
  const [detalheAno, setDetalheAno] = useState<string | null>(null);
  const hoje = extrato.hoje;
  const mesCur = hoje.slice(0, 7);
  const iHoje = extrato.dias.findIndex((d) => d.data === hoje);

  const { buckets, valores, fontes } = useMemo(() => {
    const valores = new Map<string, number[]>();
    const fontes = new Map<string, Item[][]>();
    let buckets: Bucket[] = [];

    const put = (i: number, categoria: string, valor: number, extras: Partial<Item> = {}) => {
      for (const [cat, peso] of dividirCategoria(categoria)) {
        const v = valor * peso;
        const g = grupoDe(cat, v, ajustes);
        const item: Item = { cat, valor: v, peso, original: categoria, valorTitulo: valor, ...extras };
        for (const chave of [g, `${g}|${cat}`]) {
          const linha = valores.get(chave) ?? Array(buckets.length).fill(0);
          linha[i] += v;
          valores.set(chave, linha);
          const f = fontes.get(chave) ?? buckets.map(() => []);
          f[i].push(item);
          fontes.set(chave, f);
        }
      }
    };

    if (grao === "dia") {
      buckets = extrato.dias.map((d) => ({
        topo: diaMes(d.data),
        sub: SEMANA[diaDaSemana(d.data)],
        apagado: diaDaSemana(d.data) % 6 === 0,
      }));
      const indice = new Map(extrato.dias.map((d, i) => [d.data, i]));
      for (const m of movs) {
        const i = indice.get(m.data);
        if (i !== undefined) {
          put(i, m.categoria, m.valor, { nome: m.nome, data: m.data, doc: m.documento, realizado: m.realizado, deslocado: m.cenario });
        }
      }
    } else {
      const meses = Array.from({ length: 12 }, (_, i) => `${extra.ano}-${String(i + 1).padStart(2, "0")}`);
      buckets = meses.map((mes) => ({
        topo: nomeMes(mes),
        sub: mes < mesCur ? "fechado" : mes === mesCur ? "em curso" : "projetado",
        apagado: mes > mesCur,
        mes,
        fechado: mes < mesCur,
      }));
      const putProjetado = (i: number, categoria: string, v: number) => {
        const projetado = buckets[i].mes! > mesCur;
        if (v > 0 && cenario.frac && projetado) {
          put(i, categoria, v * (1 - cenario.frac));
          if (i + 1 < buckets.length) put(i + 1, categoria, v * cenario.frac, { deslocado: true });
        } else put(i, categoria, v);
      };
      meses.forEach((mes, i) => {
        const cats = usaRegra ? catmesAjustado(extra, mes, mesCur) : (extra.catmes[mes] ?? {});
        for (const [c, v] of Object.entries(cats)) putProjetado(i, c, v);
      });
    }
    return { buckets, valores, fontes };
  }, [grao, extrato, extra, movs, cenario, usaRegra, ajustes, mesCur]);

  const visiveis = buckets.map((b, i) => ({ b, i })).filter(({ b }) => mostraFechados || !b.fechado);
  const somaGrupos = (grupos: GrupoFluxo[]) =>
    buckets.map((_, i) => grupos.reduce((s, g) => s + (valores.get(g.id)?.[i] ?? 0), 0));
  const receitas = somaGrupos(GRUPOS_RECEITA);
  const despesas = somaGrupos(GRUPOS_DESPESA);
  const resultado = receitas.map((v, i) => v + despesas[i]);
  const saldoFim = buckets.map((b, i) =>
    grao === "mes" ? (mensal.find((l) => l.mes === b.mes)?.acum ?? 0) : extrato.dias[i].saldo,
  );
  const total = (linha: number[]) => visiveis.reduce((s, { i }) => s + (linha[i] ?? 0), 0);

  const saidasFuturas = GRUPOS_DESPESA.map((g) => {
    const linha = valores.get(g.id) ?? [];
    const v = -linha.reduce((s, x, i) => s + ((grao === "mes" ? (buckets[i].mes ?? "") >= mesCur : i >= iHoje) ? x : 0), 0);
    return { g, v };
  }).filter((x) => x.v > 0);
  const totalSaidas = saidasFuturas.reduce((s, x) => s + x.v, 0);

  const pontosMensais = mensal.map((l) => ({
    rotulo: nomeMes(l.mes),
    valor: l.acum,
    previsto: l.status === "projetado",
    titulo: `Fim de ${nomeMes(l.mes)}`,
  }));

  function celula(v: number, chave: string | null, i: number, modo: "in" | "out" | "neutro" = "neutro", destaque = false) {
    const clicavel = chave !== null && Math.abs(v) >= 1;
    const conteudo = Math.abs(v) < 1 ? <span className="text-fg-subtle">—</span> : <span className={clsx(v < 0 && "text-danger")}>{k(v)}</span>;
    return (
      <td key={i} className={clsx(tab.tdR, "px-2 text-xs", destaque && "bg-warning-bg", modo === "in" && "text-fg")}>
        {clicavel ? (
          <button type="button" onClick={() => setDetalhe({ chave: chave!, bucket: i })} className="rounded px-1 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {conteudo}
          </button>
        ) : (
          conteudo
        )}
      </td>
    );
  }

  const linhaCabecalho = (rotulo: string, linha: number[]) => (
    <tr className="bg-surface-muted/60 font-semibold">
      <td className={clsx(tab.td, "sticky left-0 bg-surface-muted text-xs uppercase tracking-wider")}>{rotulo}</td>
      {visiveis.map(({ i }) => celula(linha[i] ?? 0, null, i))}
      <td className={clsx(tab.tdR, "text-xs")}>{k(total(linha))}</td>
    </tr>
  );

  const linhasGrupo = (g: GrupoFluxo) => {
    const linha = valores.get(g.id) ?? [];
    const aberto = abertos[g.id];
    const categorias = [...valores.keys()]
      .filter((c) => c.startsWith(`${g.id}|`))
      .sort((a, b) => Math.abs(total(valores.get(b)!)) - Math.abs(total(valores.get(a)!)));
    return (
      <Fragment key={g.id}>
        <tr>
          <td className={clsx(tab.td, "sticky left-0 bg-surface")}>
            <button
              type="button"
              aria-expanded={aberto}
              onClick={() => setAbertos({ ...abertos, [g.id]: !aberto })}
              className="flex items-center gap-2 text-left text-sm font-medium"
            >
              <span className="w-3 text-fg-muted">{aberto ? "▾" : "▸"}</span>
              <i className="size-2.5 shrink-0 rounded-full" style={{ background: g.cor }} />
              {g.nome}
            </button>
          </td>
          {visiveis.map(({ i }) => celula(linha[i] ?? 0, g.id, i, g.sinal > 0 ? "in" : "out"))}
          <td className={clsx(tab.tdR, "text-xs font-semibold")}>{k(total(linha))}</td>
        </tr>
        {aberto
          ? categorias.map((chave) => {
              const l = valores.get(chave)!;
              const nomeCat = chave.split("|")[1];
              return (
                <tr key={chave} className="text-fg-muted">
                  <td className={clsx(tab.td, "sticky left-0 bg-surface pl-10 text-xs")}>
                    {grao === "mes" ? (
                      <button type="button" onClick={() => setDetalheAno(chave)} className="rounded text-left hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {nomeCat}
                      </button>
                    ) : (
                      nomeCat
                    )}
                  </td>
                  {visiveis.map(({ i }) => celula(l[i] ?? 0, chave, i))}
                  <td className={clsx(tab.tdR, "text-xs")}>{k(total(l))}</td>
                </tr>
              );
            })
          : null}
      </Fragment>
    );
  };

  const todosAbertos = [...GRUPOS_RECEITA, ...GRUPOS_DESPESA].every((g) => abertos[g.id]);

  return (
    <div className="flex flex-col gap-4">
      <Secao titulo="Evolução mensal do caixa" dica="Caixa próprio no fim de cada mês do ano: fechados e em curso pelo realizado, os seguintes pela projeção (mudam com o cenário e a regra do dashboard).">
        <GraficoSaldo
          pontos={pontosMensais}
          indiceAtual={mensal.findIndex((l) => l.status === "em_curso")}
          limite={limite}
          minimo={minimo}
          altura={200}
        />
      </Secao>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado rotulo="Agrupar por" valor={grao} onMudar={setGrao} opcoes={[{ valor: "dia", rotulo: "Por dia" }, { valor: "mes", rotulo: "Por mês" }]} />
          <span className="text-xs text-fg-muted">
            {grao === "mes"
              ? `jan a dez/${String(extra.ano).slice(2)} · fechados (realizado), ${nomeMes(mesCur)} em curso, depois projetado · R$`
              : `${diaMes(extrato.dias[0].data)} a ${diaMes(extrato.dias[extrato.dias.length - 1].data)} · realizado até ontem, previsto de hoje em diante · R$`}
          </span>
        </div>
        <div className="flex gap-2">
          {grao === "mes" ? (
            <BotaoLeve onClick={() => setMostraFechados(!mostraFechados)}>{mostraFechados ? "Recolher meses fechados" : "Mostrar meses fechados"}</BotaoLeve>
          ) : null}
          <BotaoLeve onClick={() => setAbertos(Object.fromEntries([...GRUPOS_RECEITA, ...GRUPOS_DESPESA].map((g) => [g.id, !todosAbertos])))}>
            {todosAbertos ? "Recolher categorias" : "Expandir categorias"}
          </BotaoLeve>
        </div>
      </div>

      <Secao
        titulo="Fluxo resumido por categoria"
        dica="Realizado até ontem e previsto de hoje em diante, pelas categorias do Omie. Clique num grupo para abrir as categorias e num valor para ver o que o compõe."
      >
        <div className={clsx(tab.wrap, "-mx-4 sm:-mx-5")}>
          <table className={clsx(tab.table, "min-w-max")}>
            <thead>
              <tr>
                <th className={clsx(tab.th, "sticky left-0 bg-surface")}>Categoria</th>
                {visiveis.map(({ b, i }) => (
                  <th key={i} className={clsx(tab.thR, "px-2", b.apagado && "text-fg-subtle/60")}>
                    <span className="block tabular-nums">{b.topo}</span>
                    <span className="font-normal normal-case tracking-normal">{b.sub}</span>
                  </th>
                ))}
                <th className={tab.thR}>Total</th>
              </tr>
            </thead>
            <tbody>
              {linhaCabecalho("Receitas", receitas)}
              {GRUPOS_RECEITA.map(linhasGrupo)}
              {linhaCabecalho("Despesas", despesas)}
              {GRUPOS_DESPESA.map(linhasGrupo)}
              {linhaCabecalho("Resultado do período", resultado)}
              <tr className="font-semibold">
                <td className={clsx(tab.td, "sticky left-0 bg-surface text-xs uppercase tracking-wider")}>Saldo no fim do período</td>
                {visiveis.map(({ i }) => {
                  const v = saldoFim[i];
                  return celula(v, null, i, "neutro", (limite > 0 && v < -limite) || (minimo !== null && v < minimo));
                })}
                <td className={clsx(tab.tdR, "text-xs")}>{k(saldoFim[saldoFim.length - 1])}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Secao>

      {totalSaidas > 0 ? (
        <Secao titulo="Para onde vai o dinheiro" dica={`Participação de cada grupo nas saídas previstas de ${grao === "mes" ? `${nomeMes(mesCur)} a dez` : "hoje em diante"}.`}>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            {saidasFuturas.map(({ g, v }) => (
              <div key={g.id} title={`${g.nome}: ${brl(v)}`} style={{ width: `${(v / totalSaidas) * 100}%`, background: g.cor }} />
            ))}
          </div>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {[...saidasFuturas].sort((a, b) => b.v - a.v).map(({ g, v }) => (
              <li key={g.id} className="flex items-center gap-2">
                <i className="size-2.5 shrink-0 rounded-full" style={{ background: g.cor }} />
                <span className="flex-1">{g.nome}</span>
                <b className="tabular-nums">{brl(v)}</b>
                <span className="w-10 text-right tabular-nums text-fg-muted">{Math.round((v / totalSaidas) * 100)}%</span>
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      {detalhe ? (
        <DetalheCelula
          chave={detalhe.chave}
          bucket={buckets[detalhe.bucket]}
          itens={fontes.get(detalhe.chave)?.[detalhe.bucket] ?? []}
          lancamentosMes={grao === "mes" ? movs : null}
          ajustes={ajustes}
          hoje={hoje}
          primeiroDia={extrato.dias[0].data}
          provedor={provedor}
          onFechar={() => setDetalhe(null)}
        />
      ) : null}

      {detalheAno && grao === "mes" ? (
        <DetalheCategoriaAno
          grupo={grupoPorId(detalheAno.split("|")[0])!}
          categoria={detalheAno.split("|")[1]}
          totPorMes={valores.get(detalheAno) ?? buckets.map(() => 0)}
          meses={buckets.map((b) => b.mes!)}
          porCliente={extra.porCliente}
          hoje={hoje}
          onFechar={() => setDetalheAno(null)}
        />
      ) : null}
    </div>
  );
}

function DetalheCategoriaAno({
  grupo,
  categoria,
  totPorMes,
  meses,
  porCliente,
  hoje,
  onFechar,
}: {
  grupo: GrupoFluxo;
  categoria: string;
  totPorMes: number[];
  meses: string[];
  porCliente: Extra["porCliente"];
  hoje: string;
  onFechar: () => void;
}) {
  const SEM_DETALHE = "(sem detalhe por cliente)";

  const { nomes, porClienteMes, total } = useMemo(() => {
    const porClienteMes: Record<string, number[]> = {};
    const add = (nome: string, i: number, v: number) => {
      (porClienteMes[nome] ??= meses.map(() => 0))[i] += v;
    };
    meses.forEach((mes, i) => {
      const totCat = totPorMes[i] ?? 0;
      const porCat = porCliente[mes]?.[categoria] ?? {};
      let soma = 0;
      for (const [cli, v] of Object.entries(porCat)) {
        soma += v;
        add(cli, i, v);
      }
      const resto = totCat - soma;
      if (Math.abs(resto) >= 1) add(SEM_DETALHE, i, resto);
    });
    const nomes = Object.keys(porClienteMes)
      .filter((n) => n !== SEM_DETALHE)
      .sort((a, b) => Math.abs(porClienteMes[b].reduce((s, v) => s + v, 0)) - Math.abs(porClienteMes[a].reduce((s, v) => s + v, 0)));
    if (porClienteMes[SEM_DETALHE]) nomes.push(SEM_DETALHE);
    const total = totPorMes.reduce((s, v) => s + (v ?? 0), 0);
    return { nomes, porClienteMes, total };
  }, [categoria, meses, porCliente, totPorMes]);

  function exportar() {
    baixarCsv(`historico_${slug(categoria)}_${hoje}.csv`, [
      ["Categoria", categoria],
      ["Grupo", grupo.nome],
      [],
      ["Fornecedor/Cliente", ...meses.map(nomeMes), "Total"],
      ...nomes.map((nome) => {
        const vals = porClienteMes[nome];
        return [nome, ...vals.map(numeroCsv), numeroCsv(vals.reduce((s, v) => s + v, 0))];
      }),
      ["Total", ...totPorMes.map(numeroCsv), numeroCsv(total)],
    ]);
  }

  return (
    <Modal
      titulo={categoria}
      descricao={`${grupo.nome} · por fornecedor/cliente · ${nomeMes(meses[0])}–${nomeMes(meses[meses.length - 1])} · total ${brl(total)}`}
      onFechar={onFechar}
      largura="xl"
    >
      <div className="space-y-4 overflow-y-auto px-5 py-4">
        <div className="flex justify-end">
          <BotaoLeve onClick={exportar}>Exportar Excel</BotaoLeve>
        </div>
        <div className={clsx(tab.wrap, "-mx-4 sm:-mx-5")}>
          <table className={clsx(tab.table, "min-w-max")}>
            <thead>
              <tr>
                <th className={clsx(tab.th, "sticky left-0 bg-surface")}>Fornecedor/Cliente</th>
                {meses.map((mes) => (
                  <th key={mes} className={tab.thR}>{nomeMes(mes)}</th>
                ))}
                <th className={tab.thR}>Total</th>
              </tr>
            </thead>
            <tbody>
              {nomes.map((nome) => {
                const vals = porClienteMes[nome];
                const t = vals.reduce((s, v) => s + v, 0);
                return (
                  <tr key={nome} className={nome === SEM_DETALHE ? "text-fg-muted" : undefined}>
                    <td className={clsx(tab.td, "sticky left-0 bg-surface max-w-64 truncate")} title={nome}>{nome}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={clsx(tab.tdR, Math.abs(v) < 1 ? "text-fg-subtle" : v < 0 && "text-danger")}>
                        {Math.abs(v) < 1 ? "—" : brl(v)}
                      </td>
                    ))}
                    <td className={clsx(tab.tdR, "font-semibold")}>{brl(t)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-muted/60 font-semibold">
                <td className={clsx(tab.td, "sticky left-0 bg-surface-muted")}>Total</td>
                {totPorMes.map((v, i) => (
                  <td key={i} className={clsx(tab.tdR, v < 0 && "text-danger")}>{brl(v)}</td>
                ))}
                <td className={tab.tdR}>{brl(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {porClienteMes[SEM_DETALHE] ? (
          <p className="text-xs text-fg-muted">
            &quot;{SEM_DETALHE}&quot;: parte do total que não está ligada a um cliente/fornecedor específico (ex.: a regra do dashboard — média histórica usada pra completar meses com cobertura de contrato ainda fina).
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function DetalheCelula({
  chave,
  bucket,
  itens,
  lancamentosMes,
  ajustes,
  hoje,
  primeiroDia,
  provedor = "omie",
  onFechar,
}: {
  chave: string;
  bucket: Bucket;
  itens: Item[];
  lancamentosMes: Movimento[] | null;
  ajustes: Record<string, string>;
  hoje: string;
  primeiroDia: string;
  provedor?: string;
  onFechar: () => void;
}) {
  const [idGrupo, categoria] = chave.split("|");
  const grupo = grupoPorId(idGrupo)!;
  const titulo = categoria ?? grupo.nome;
  const periodo = bucket.mes ? `${bucket.topo} · ${bucket.sub}` : `${bucket.topo} (${bucket.sub})`;
  const total = itens.reduce((s, x) => s + x.valor, 0);

  const composicao = Object.entries(
    itens.reduce<Record<string, number>>((o, x) => ({ ...o, [x.cat]: (o[x.cat] ?? 0) + x.valor }), {}),
  )
    .filter(([, v]) => Math.abs(v) >= 0.005)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  // No mês, os lançamentos individuais vêm do fluxo diário (só cobre o horizonte do extrato).
  let lancamentos: Item[] = itens.filter((x) => x.nome);
  if (lancamentosMes && bucket.mes) {
    const alvo = new Set(categoria ? [categoria] : composicao.map(([c]) => c));
    lancamentos = [];
    for (const m of lancamentosMes) {
      if (!m.data.startsWith(bucket.mes)) continue;
      for (const [cat, peso] of dividirCategoria(m.categoria)) {
        const v = m.valor * peso;
        if (grupoDe(cat, v, ajustes) !== idGrupo || !alvo.has(cat)) continue;
        lancamentos.push({ cat, valor: v, nome: m.nome, data: m.data, doc: m.documento, realizado: m.realizado, peso, original: m.categoria, valorTitulo: m.valor, deslocado: m.cenario });
      }
    }
  }
  lancamentos.sort((a, b) => ((a.data ?? "") < (b.data ?? "") ? -1 : (a.data ?? "") > (b.data ?? "") ? 1 : Math.abs(b.valor) - Math.abs(a.valor)));
  const nota =
    lancamentosMes && bucket.mes && !lancamentos.length
      ? bucket.mes < primeiroDia.slice(0, 7)
        ? `Mês fechado: o valor vem das bases de títulos do ${provedor === "nibo" ? "Nibo" : "Omie"}, sem lançamentos individuais nesta tela.`
        : bucket.mes > hoje.slice(0, 7)
          ? "Mês além do horizonte do fluxo diário: o valor vem da projeção por categoria."
          : null
      : null;

  function exportar() {
    baixarCsv(`detalhe_${slug(`${titulo}_${bucket.mes ?? bucket.topo}`)}_${hoje}.csv`, [
      ["Grupo", "Categoria", "Período", "Total"],
      [grupo.nome, titulo, periodo, numeroCsv(total)],
      [],
      ["Data", "Cliente / fornecedor", "Documento", "Categoria", "Situação", "% do título nesta categoria", "Valor do título", "Valor na categoria"],
      ...lancamentos.map((x) => [
        x.data?.split("-").reverse().join("/") ?? "",
        x.nome ?? "",
        x.doc ?? "",
        x.cat,
        (x.realizado ? "realizado" : "previsto") + (x.deslocado ? " (atraso do cenário)" : ""),
        numeroCsv(x.peso * 100),
        numeroCsv(x.valorTitulo ?? x.valor),
        numeroCsv(x.valor),
      ]),
    ]);
  }

  return (
    <Modal titulo={titulo} descricao={`${grupo.nome} · ${periodo} · total ${brl(total)}`} onFechar={onFechar} largura="xl">
      <div className="space-y-4 overflow-y-auto px-5 py-4">
        <div className="flex justify-end">
          <BotaoLeve onClick={exportar}>Exportar Excel</BotaoLeve>
        </div>
        {!categoria && composicao.length ? (
          <div className={tab.wrap}>
            <table className={tab.table}>
              <thead><tr><th className={tab.th}>Categoria</th><th className={tab.thR}>Valor</th><th className={tab.thR}>%</th></tr></thead>
              <tbody>
                {composicao.map(([c, v]) => (
                  <tr key={c}>
                    <td className={tab.td}>{c}</td>
                    <td className={clsx(tab.tdR, v < 0 && "text-danger")}>{brl(v)}</td>
                    <td className={clsx(tab.tdR, "text-fg-muted")}>{total ? Math.round((v / total) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {nota ? <p className="text-xs text-fg-muted">{nota}</p> : null}
        {lancamentos.length ? (
          <div className={tab.wrap}>
            <table className={tab.table}>
              <thead>
                <tr>
                  <th className={tab.th}>Data</th>
                  <th className={tab.th}>Cliente / fornecedor</th>
                  {categoria ? null : <th className={tab.th}>Categoria</th>}
                  <th className={tab.th}>Situação</th>
                  <th className={tab.thR}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.slice(0, 300).map((x, i) => (
                  <tr key={i}>
                    <td className={clsx(tab.td, "whitespace-nowrap tabular-nums")}>{x.data ? diaMes(x.data) : "—"}</td>
                    <td className={clsx(tab.td, "max-w-64 truncate")} title={x.nome}>{x.nome ?? "—"}</td>
                    {categoria ? null : <td className={clsx(tab.td, "text-fg-muted")}>{x.cat}</td>}
                    <td className={clsx(tab.td, "text-xs text-fg-muted")}>
                      {x.realizado ? "realizado" : "previsto"}
                      {x.peso < 1 ? ` · rateio ${Math.round(x.peso * 100)}% de ${brl(x.valorTitulo ?? x.valor)}` : ""}
                      {x.deslocado ? " · atraso do cenário" : ""}
                    </td>
                    <td className={clsx(tab.tdR, x.valor < 0 && "text-danger")}>{brl(x.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lancamentos.length > 300 ? <p className="mt-2 text-xs text-fg-muted">Mostrando os primeiros 300 — a exportação traz todos.</p> : null}
          </div>
        ) : !nota ? (
          <p className="text-xs text-fg-muted">Sem lançamentos individuais para esta célula.</p>
        ) : null}
      </div>
    </Modal>
  );
}
