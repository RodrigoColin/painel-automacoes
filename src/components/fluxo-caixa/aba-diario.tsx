"use client";

import { useState } from "react";
import { clsx } from "@/lib/clsx";
import {
  baixarCsv,
  brl,
  diaMes,
  diaRotulo,
  k,
  nomeMes,
  numeroCsv,
  proximoMes,
  type LinhaMensal,
} from "@/lib/fluxo-caixa/calculos";
import { nomeCategoria } from "@/lib/fluxo-caixa/grupos";
import type { DiaExtrato, Extra, Extrato, Movimento } from "@/lib/fluxo-caixa/tipos";
import { BarrasDiarias, GraficoSaldo } from "@/components/fluxo-caixa/graficos";
import { BotaoLeve, Kpi, Secao, Segmentado, tab, tomValor } from "@/components/fluxo-caixa/pecas";

/** Obrigações que não dá para adiar: marcam os "dias críticos" no gráfico. */
const OBRIGATORIAS = /sal[aá]rio|inss|fgts|13º|pro-?labore|irpj|csll|\biss\b|cofins|\bpis\b|f[ée]rias|vale|plano de sa/i;

type Horizonte = "atual" | "seguinte";
type Periodo = "7d" | "atual" | "seguinte";
type TipoTit = "todos" | "rec" | "pag";

export function AbaDiario({
  extrato,
  extra,
  movs,
  dias,
  mensal,
  limite,
  minimo,
  descricaoCenario,
  onIrInadimplencia,
}: {
  extrato: Extrato;
  extra: Extra;
  movs: Movimento[];
  dias: DiaExtrato[];
  mensal: LinhaMensal[];
  limite: number;
  minimo: number | null;
  descricaoCenario: string | null;
  onIrInadimplencia: () => void;
}) {
  const hoje = extrato.hoje;
  const mesAtual = hoje.slice(0, 7);
  const mesSeguinte = proximoMes(mesAtual);
  const [horizonte, setHorizonte] = useState<Horizonte>("atual");
  const [selecionado, setSelecionado] = useState(hoje);

  const ds = horizonte === "atual" ? dias.filter((d) => d.data <= `${mesAtual}-31`) : dias.filter((d) => d.data.startsWith(mesSeguinte));
  const futuros = ds.filter((d) => d.tipo !== "realizado");
  const ultimo = ds[ds.length - 1];
  const pior = futuros.reduce((m, d) => (d.saldo < m.saldo ? d : m), futuros[0] ?? ultimo);
  // Entradas/saídas do KPI = MÊS INTEIRO (realizado + previsto), da mesma fonte das abas
  // Por categoria / Visão mensal (linhasMensais → catmes, iguais por construção pro mês
  // corrente, ver proos-omie-mcp/caixa/extra.py). Não somamos os dias do extrato diário:
  // ele só guarda os últimos 7 dias de realizado (DIAS_PASSADOS) e não reconstrói o mês
  // cheio -- somar daria um número menor e divergente da aba Por categoria.
  const mesRef = horizonte === "atual" ? mesAtual : mesSeguinte;
  const linhaMes = mensal.find((l) => l.mes === mesRef);
  const entradas = linhaMes ? linhaMes.ent : futuros.reduce((s, d) => s + d.entradas, 0);
  const saidas = linhaMes ? linhaMes.sai : futuros.reduce((s, d) => s + d.saidas, 0);
  const diaSel = ds.some((d) => d.data === selecionado) ? selecionado : (ds.find((d) => d.tipo === "hoje") ?? ds[0])?.data;

  const saidasFechadas = extra.hist.filter((h) => h.status === "fechado").map((h) => h.sai).sort((a, b) => a - b);
  const saidaMediana = saidasFechadas.length ? saidasFechadas[saidasFechadas.length >> 1] : 0;
  const limiarCritico = Math.max(1000, saidaMediana * 0.05);

  const porDiaObrigatorio = (() => {
    const porDia = new Map<string, Map<string, number>>();
    for (const m of movs) {
      if (m.valor < 0 && !m.realizado && OBRIGATORIAS.test(m.categoria)) {
        const cats = porDia.get(m.data) ?? new Map();
        cats.set(m.categoria, (cats.get(m.categoria) ?? 0) - m.valor);
        porDia.set(m.data, cats);
      }
    }
    return porDia;
  })();
  const criticos = ds
      .map((d) => {
        const cats = porDiaObrigatorio.get(d.data);
        if (!cats) return null;
        const total = [...cats.values()].reduce((s, v) => s + v, 0);
        if (total < limiarCritico) return null;
        return { dia: d, total, top: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3) };
      })
      .filter((x) => x !== null);

  if (!ds.length || !pior) return null;

  const abaixoMinimo = minimo !== null && pior.saldo < minimo;
  const faixa = `${diaMes(futuros[0]?.data ?? ds[0].data)}–${diaMes(ultimo.data)}`;
  let alerta: { tom: "ruim" | "bom"; titulo: string; texto: React.ReactNode };
  if (limite > 0 && pior.saldo < -limite) {
    alerta = {
      tom: "ruim",
      titulo: `Limite da conta estourado em ${diaRotulo(pior.data)} (período ${faixa}).`,
      texto: <>O saldo projetado chega a <b>{brl(pior.saldo)}</b>, além do limite de {brl(limite)}. Faltam <b>{brl(-limite - pior.saldo)}</b> para caber no limite.</>,
    };
  } else if (pior.saldo < 0) {
    alerta = {
      tom: "ruim",
      titulo: `Caixa fica negativo em ${diaRotulo(pior.data)} (período ${faixa}).`,
      texto: limite > 0
        ? <>Saldo projetado de <b>{brl(pior.saldo)}</b>, dentro do limite de {brl(limite)}, com margem de <b>{brl(limite + pior.saldo)}</b>.</>
        : <>Saldo projetado de <b>{brl(pior.saldo)}</b>, sem limite de conta cadastrado.</>,
    };
  } else if (abaixoMinimo) {
    alerta = {
      tom: "ruim",
      titulo: `Atenção ao caixa em ${diaRotulo(pior.data)}.`,
      texto: <>O saldo projetado chega a <b>{brl(pior.saldo)}</b>, abaixo do saldo mínimo de {brl(minimo)}.</>,
    };
  } else {
    alerta = {
      tom: "bom",
      titulo: `Caixa positivo de ${faixa} (${horizonte === "atual" ? "mês atual" : "mês seguinte"}).`,
      texto: <>Menor saldo projetado: <b>{brl(pior.saldo)}</b> em {diaRotulo(pior.data)}{limite > 0 ? `, com ${brl(pior.saldo + limite)} de margem até o limite das contas` : ""}.</>,
    };
  }

  const iAtual = ds.findIndex((d) => d.tipo === "hoje");

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className={clsx(
          "rounded-lg border px-4 py-3 text-sm",
          alerta.tom === "ruim" ? "border-danger/30 bg-danger-bg text-fg" : "border-success/30 bg-success-bg text-fg",
        )}
      >
        <strong className="mr-2">{alerta.titulo}</strong>
        <span>{alerta.texto}</span>
      </div>

      {descricaoCenario ? (
        <p className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-2 text-sm">{descricaoCenario}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Segmentado
          rotulo="Horizonte"
          valor={horizonte}
          onMudar={setHorizonte}
          opcoes={[
            { valor: "atual", rotulo: `Mês atual (${nomeMes(mesAtual)})` },
            { valor: "seguinte", rotulo: `Mês seguinte (${nomeMes(mesSeguinte)})` },
          ]}
        />
        <span className="text-xs text-fg-muted">
          {diaMes(ds[0].data)} a {diaMes(ultimo.data)} · {horizonte === "atual" ? "realizado até ontem, previsto de hoje em diante" : "tudo previsto"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi rotulo="Caixa próprio hoje" valor={brl(extrato.caixaProprio)} nota="Contas correntes e aplicações de liquidez imediata" />
        <Kpi rotulo="Entradas do mês" valor={brl(entradas)} nota={`${nomeMes(mesRef)} · realizado + previsto`} />
        <Kpi rotulo="Saídas do mês" valor={brl(saidas)} nota={`${nomeMes(mesRef)} · realizado + previsto`} />
        <Kpi rotulo="Saldo projetado final" valor={brl(ultimo.saldo)} nota={`Em ${diaRotulo(ultimo.data)}`} tom={ultimo.saldo < (minimo ?? 0) ? "negativo" : undefined} />
        <Kpi
          rotulo="Menor saldo do período"
          valor={brl(pior.saldo)}
          tom={pior.saldo < 0 || abaixoMinimo ? "negativo" : undefined}
          nota={<>Em {diaRotulo(pior.data)}{limite > 0 ? <> · margem até o limite: <b className={tomValor(pior.saldo + limite)}>{brl(pior.saldo + limite)}</b></> : null}</>}
        />
      </div>

      <Secao
        titulo="Posição por conta hoje"
        dica={<>Caixa próprio <b>{brl(extrato.caixaProprio)}</b>{limite > 0 ? <> · limite das contas <b>{brl(limite)}</b> · liquidez total <b>{brl(extrato.caixaProprio + limite)}</b></> : null}</>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {extrato.contas
            .filter((c) => c.saldo !== 0 || c.conciliadoAte || c.limite)
            .map((c) => (
              <div key={c.codigo} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{c.descricao}</span>
                  <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px]", c.conciliadoAte ? "bg-surface-muted text-fg-muted" : "bg-warning-bg text-fg-muted")}>
                    {c.conciliadoAte ? `Conciliado até ${diaMes(c.conciliadoAte)}` : "Sem conciliação no período"}
                  </span>
                </div>
                <p className={clsx("mt-1 text-lg font-semibold", tomValor(c.saldo))}>{brl(c.saldo)}</p>
                <p className="text-xs text-fg-muted">
                  {c.tipo === "garantida" ? "Dívida · não soma no caixa" : c.tipo === "aplicacao" ? (c.somaNoCaixa ? "Aplicação · soma no caixa" : "Aplicação sem liquidez · não soma") : "Conta corrente"}
                  {c.limite ? ` · limite ${brl(c.limite)}` : ""}
                  {c.pendentesConciliacao ? ` · ${c.pendentesConciliacao} a conciliar` : ""}
                </p>
              </div>
            ))}
        </div>
      </Secao>

      <Secao
        titulo="Evolução diária do caixa"
        dica="Caixa próprio no fim de cada dia, pela data em que o dinheiro entra ou sai da conta. Linha cheia = realizado; tracejada = previsto."
        acoes={
          <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
            {minimo !== null ? <span className="inline-flex items-center gap-1.5"><i className="w-4 border-t-2 border-dashed border-warning" />Saldo mínimo</span> : null}
            {limite > 0 ? <span className="inline-flex items-center gap-1.5"><i className="w-4 border-t-2 border-dashed border-danger" />Limite das contas (−{k(limite)})</span> : null}
          </div>
        }
      >
        <GraficoSaldo
          pontos={ds.map((d) => ({ rotulo: diaMes(d.data), valor: d.saldo, previsto: d.tipo === "previsto", titulo: diaRotulo(d.data) }))}
          indiceAtual={iAtual}
          limite={limite}
          minimo={minimo}
        />
        {criticos.length ? (
          <div className="space-y-2">
            <p className="text-xs text-fg-muted">
              <b className="text-fg">Dias críticos</b> — folha, encargos, impostos e benefícios acima de {brl(limiarCritico)} e o saldo projetado no fim do dia:
            </p>
            <div className="flex flex-wrap gap-2">
              {criticos.map((x) => (
                <div
                  key={x.dia.data}
                  className={clsx(
                    "rounded-md border border-border px-3 py-2 text-xs",
                    x.dia.saldo < 0 ? "bg-danger-bg" : minimo !== null && x.dia.saldo < minimo ? "bg-warning-bg" : "bg-surface-muted",
                  )}
                >
                  <b>{diaRotulo(x.dia.data)}</b> · <b>{brl(x.total)}</b>
                  <br />
                  <span className="text-fg-muted">{x.top.map(([c, v]) => `${c} ${k(v)}`).join(" · ")}</span>
                  <br />
                  saldo no dia: <b className={tomValor(x.dia.saldo)}>{brl(x.dia.saldo)}</b>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Secao>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Secao
          titulo={`Entradas e saídas por dia · ${horizonte === "atual" ? nomeMes(mesAtual) : nomeMes(mesSeguinte)}`}
          dica="Clique em um dia para ver o que compõe o movimento. Barras mais claras = já realizado."
          acoes={
            <div className="flex gap-3 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-serie-1" />Entradas</span>
              <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[3px] bg-serie-2" />Saídas</span>
            </div>
          }
        >
          <BarrasDiarias dias={ds} selecionado={diaSel ?? hoje} onSelecionar={setSelecionado} />
        </Secao>
        {diaSel ? <DetalheDia dia={ds.find((d) => d.data === diaSel)!} movs={movs} /> : null}
      </div>

      <TabelaPrevistos movs={movs} dias={dias} hoje={hoje} mesAtual={mesAtual} mesSeguinte={mesSeguinte} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Cobertura dias={dias} hoje={hoje} caixa={extrato.caixaProprio} minimo={minimo} />
        <Atrasos extra={extra} onIrInadimplencia={onIrInadimplencia} />
      </div>
    </div>
  );
}

function DetalheDia({ dia, movs }: { dia: DiaExtrato; movs: Movimento[] }) {
  const itens = movs.filter((m) => m.data === dia.data).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  return (
    <Secao
      titulo={diaRotulo(dia.data)}
      acoes={<span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">{dia.tipo === "hoje" ? "Hoje" : dia.tipo === "realizado" ? "Realizado" : "Previsto"}</span>}
    >
      <div className="grid grid-cols-3 gap-2 text-xs text-fg-muted">
        <div>Entradas<b className="block text-sm text-fg">{k(dia.entradas)}</b></div>
        <div>Saídas<b className="block text-sm text-fg">{k(dia.saidas)}</b></div>
        <div>Saldo final<b className={clsx("block text-sm text-fg", tomValor(dia.saldo))}>{k(dia.saldo)}</b></div>
      </div>
      {itens.length ? (
        <ul className="max-h-72 space-y-2 overflow-y-auto border-t border-border pt-3">
          {itens.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-sm">
              <i className={clsx("mt-1.5 size-2 shrink-0 rounded-full", m.valor > 0 ? "bg-serie-1" : "bg-serie-2")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={m.nome}>{m.nome}</span>
                <small className="block truncate text-xs text-fg-muted">
                  {nomeCategoria(m.categoria)}{m.realizado ? "" : m.cenario ? " · atraso simulado" : " · previsto"}
                </small>
              </span>
              <span className="shrink-0 tabular-nums">{m.valor < 0 ? "−" : "+"}{brl(Math.abs(m.valor))}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">Sem movimento neste dia.</p>
      )}
    </Secao>
  );
}

function TabelaPrevistos({
  movs,
  dias,
  hoje,
  mesAtual,
  mesSeguinte,
}: {
  movs: Movimento[];
  dias: DiaExtrato[];
  hoje: string;
  mesAtual: string;
  mesSeguinte: string;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const [tipo, setTipo] = useState<TipoTit>("todos");
  const iHoje = dias.findIndex((d) => d.data === hoje);
  const faixa =
    periodo === "7d"
      ? { ini: hoje, fim: dias[iHoje + 7]?.data ?? dias[dias.length - 1].data, titulo: "nos próximos 7 dias" }
      : periodo === "atual"
        ? { ini: `${mesAtual}-01`, fim: `${mesAtual}-31`, titulo: `no mês atual (${nomeMes(mesAtual)})` }
        : { ini: `${mesSeguinte}-01`, fim: `${mesSeguinte}-31`, titulo: `no mês seguinte (${nomeMes(mesSeguinte)})` };
  const todos = movs
    .filter((m) => !m.realizado && m.data >= faixa.ini && m.data <= faixa.fim)
    .filter((m) => tipo === "todos" || (tipo === "rec") === m.valor > 0)
    .sort((a, b) =>
      periodo === "7d" ? Math.abs(b.valor) - Math.abs(a.valor) : a.data === b.data ? Math.abs(b.valor) - Math.abs(a.valor) : a.data < b.data ? -1 : 1,
    );
  const visiveis = todos.slice(0, periodo === "7d" ? 12 : 40);

  function exportar() {
    baixarCsv(`entra_sai_${periodo}_${hoje}.csv`, [
      ["Cai na conta", "Cliente / fornecedor", "Categoria", "Origem", "Valor"],
      ...todos.map((m) => [m.data, m.nome, nomeCategoria(m.categoria), m.origem, numeroCsv(m.valor)]),
    ]);
  }

  return (
    <Secao
      titulo={`Entra e sai ${faixa.titulo}`}
      dica="Maiores valores previstos, já líquidos de retenções."
      acoes={
        <>
          <Segmentado rotulo="Período" valor={periodo} onMudar={setPeriodo} opcoes={[{ valor: "7d", rotulo: "7 dias" }, { valor: "atual", rotulo: "Mês atual" }, { valor: "seguinte", rotulo: "Mês seguinte" }]} />
          <Segmentado rotulo="Tipo" valor={tipo} onMudar={setTipo} opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "rec", rotulo: "A receber" }, { valor: "pag", rotulo: "A pagar" }]} />
          <BotaoLeve onClick={exportar}>Exportar Excel</BotaoLeve>
        </>
      }
    >
      <div className={tab.wrap}>
        <table className={tab.table}>
          <thead>
            <tr>
              <th className={tab.th}>Cai na conta</th>
              <th className={tab.th}>Cliente / fornecedor</th>
              <th className={tab.th}>Categoria</th>
              <th className={tab.th}>Origem</th>
              <th className={tab.thR}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((m) => (
              <tr key={m.id}>
                <td className={clsx(tab.td, "whitespace-nowrap font-medium")}>{diaRotulo(m.data)}</td>
                <td className={clsx(tab.td, "max-w-72 truncate")} title={m.nome}>{m.nome}</td>
                <td className={clsx(tab.td, "text-fg-muted")}>{nomeCategoria(m.categoria)}</td>
                <td className={clsx(tab.td, "text-fg-muted")}>{m.origem}</td>
                <td className={tab.tdR}>{m.valor < 0 ? "−" : "+"}{brl(Math.abs(m.valor))}</td>
              </tr>
            ))}
            {visiveis.length === 0 ? (
              <tr><td colSpan={5} className={clsx(tab.td, "text-fg-muted")}>Nada previsto {faixa.titulo}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {todos.length > visiveis.length ? (
        <p className="text-xs text-fg-muted">Mostrando os {visiveis.length} maiores de {todos.length} previstos — use &quot;Exportar Excel&quot; para ver todos.</p>
      ) : null}
    </Secao>
  );
}

function Cobertura({ dias, hoje, caixa, minimo }: { dias: DiaExtrato[]; hoje: string; caixa: number; minimo: number | null }) {
  const futuros = dias.filter((d) => d.data >= hoje);
  const negativo = futuros.find((d) => d.saldo < 0);
  const diasCobertos = negativo ? futuros.indexOf(negativo) : futuros.length - 1;
  const saidaMedia = futuros.reduce((s, d) => s + d.saidas, 0) / Math.max(1, futuros.length);
  const folga = saidaMedia > 0 ? Math.floor(caixa / saidaMedia) : null;
  const pior = futuros.reduce((m, d) => (d.saldo < m.saldo ? d : m), futuros[0]);
  if (!pior) return null;
  return (
    <Secao titulo="Cobertura de caixa" dica="Pela projeção atual (cenário e regra do dashboard escolhidos no topo).">
      <div className="flex flex-wrap items-end gap-4">
        <p>
          <span className={clsx("text-4xl font-semibold", negativo ? (diasCobertos < 15 ? "text-danger" : "text-warning") : "text-success")}>
            {diasCobertos}{negativo ? "" : "+"}
          </span>{" "}
          <span className="text-sm font-medium">dias</span>
        </p>
        <p className="min-w-44 flex-1 text-xs text-fg-muted">
          {negativo
            ? <>O caixa fica negativo em <b className="text-fg">{diaMes(negativo.data)}</b> ({brl(negativo.saldo)}).</>
            : <>Caixa positivo em todo o horizonte (até {diaMes(dias[dias.length - 1].data)}).</>}
        </p>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-fg-muted">Menor saldo projetado</dt>
          <dd className={clsx("font-semibold", pior.saldo < (minimo ?? 0) && "text-danger")}>{brl(pior.saldo)} <span className="text-xs font-normal text-fg-muted">em {diaMes(pior.data)}</span></dd>
        </div>
        {folga !== null ? (
          <div>
            <dt className="text-xs text-fg-muted">Folga do caixa de hoje sem entradas</dt>
            <dd className="font-semibold">{folga} dias <span className="text-xs font-normal text-fg-muted">(saídas de {brl(saidaMedia)}/dia)</span></dd>
          </div>
        ) : null}
      </dl>
    </Secao>
  );
}

function Atrasos({ extra, onIrInadimplencia }: { extra: Extra; onIrInadimplencia: () => void }) {
  const [todos, setTodos] = useState(false);
  const A = extra.atrasos;
  const itens = todos ? A.itens : A.itens.slice(0, 5);
  return (
    <Secao
      titulo="Venceu e ainda não entrou"
      dica="Títulos a receber cuja previsão de recebimento passou nos últimos 30 dias e não foram liquidados."
      acoes={
        <>
          {A.itens.length > 5 ? <BotaoLeve onClick={() => setTodos(!todos)}>{todos ? "Só os 5 maiores" : `Ver todos (${A.itens.length})`}</BotaoLeve> : null}
          <BotaoLeve onClick={onIrInadimplencia}>Inadimplência</BotaoLeve>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {(["7", "15", "30"] as const).map((n) => (
          <div key={n} className="rounded-md bg-surface-muted p-2">
            <span className="block text-xs text-fg-muted">Últimos {n} dias</span>
            <b className={clsx("block", A.faixas[n].valor > 0 && "text-danger")}>{brl(A.faixas[n].valor)}</b>
            <span className="text-xs text-fg-muted">{A.faixas[n].n} título{A.faixas[n].n === 1 ? "" : "s"}</span>
          </div>
        ))}
      </div>
      <div className={tab.wrap}>
        <table className={tab.table}>
          <thead>
            <tr><th className={tab.th}>Cliente</th><th className={tab.th}>Previsão</th><th className={tab.thR}>Dias</th><th className={tab.thR}>Valor</th></tr>
          </thead>
          <tbody>
            {itens.map((x, i) => (
              <tr key={i}>
                <td className={clsx(tab.td, "max-w-60")}>
                  <span className="block truncate" title={x.cliente}>{x.cliente}</span>
                  <small className="text-xs text-fg-muted">{x.categoria}{x.doc ? ` · ${x.doc}` : ""}</small>
                </td>
                <td
                  className={clsx(tab.td, "whitespace-nowrap")}
                  title={x.vencOrig && x.vencOrig !== x.venc ? `Vencimento original: ${diaMes(x.vencOrig)}` : undefined}
                >
                  {diaMes(x.venc)}
                </td>
                <td className={clsx(tab.tdR, x.dias > 15 && "text-danger")}>{x.dias}</td>
                <td className={tab.tdR}>{brl(x.valor)}</td>
              </tr>
            ))}
            {itens.length === 0 ? <tr><td colSpan={4} className={clsx(tab.td, "text-fg-muted")}>Nenhum título vencido nos últimos 30 dias.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

