"use client";

import { useMemo, useState } from "react";
import { clsx } from "@/lib/clsx";
import {
  aplicarCenario,
  brl,
  complementoContratos,
  faturamentoBase,
  linhasMensais,
  nomeMes,
  parametrosCenario,
  pct,
  recalcularDias,
  type Cenario,
} from "@/lib/fluxo-caixa/calculos";
import type { Extra, Extrato, LinhaReceita } from "@/lib/fluxo-caixa/tipos";
import { AbaCategoria } from "@/components/fluxo-caixa/aba-categoria";
import { AbaDiario } from "@/components/fluxo-caixa/aba-diario";
import { AbaInadimplencia } from "@/components/fluxo-caixa/aba-inadimplencia";
import { AbaMensal } from "@/components/fluxo-caixa/aba-mensal";
import { Segmentado } from "@/components/fluxo-caixa/pecas";

export type Aba = "diario" | "categoria" | "mensal" | "inad";

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "diario", rotulo: "Diário" },
  { id: "categoria", rotulo: "Por categoria" },
  { id: "mensal", rotulo: "Visão mensal" },
  { id: "inad", rotulo: "Inadimplência" },
];

export function PainelFluxoCaixa({
  extrato,
  extra,
  saldoMinimo,
  categoriasGrupo,
  linhasReceita,
  abaInicial = "diario",
}: {
  abaInicial?: Aba;
  extrato: Extrato;
  extra: Extra;
  saldoMinimo: number | null;
  categoriasGrupo: Record<string, string>;
  linhasReceita: LinhaReceita[];
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [cenario, setCenario] = useState<Cenario>("base");
  const temContratos = extra.parametros.contratosAtivos > 0;
  const [usaRegra, setUsaRegra] = useState(temContratos);

  const trocarAba = setAba;

  const hoje = extrato.hoje;
  const limite = extrato.contas.reduce((s, c) => s + (c.limite || 0), 0);
  const minimo = saldoMinimo ?? extrato.saldoMinimo;
  const pCenario = useMemo(() => parametrosCenario(extra, cenario), [extra, cenario]);
  const fatBase = faturamentoBase(extra, hoje);

  const movsCaixa = useMemo(() => {
    const noCaixa = new Set(extrato.contas.filter((c) => c.somaNoCaixa).map((c) => c.codigo));
    return extrato.movimentos.filter((m) => noCaixa.has(m.conta));
  }, [extrato]);
  const complemento = useMemo(() => complementoContratos(extrato, extra, movsCaixa), [extrato, extra, movsCaixa]);
  const movs = useMemo(
    () =>
      aplicarCenario(
        usaRegra ? movsCaixa.concat(complemento) : movsCaixa,
        pCenario,
        hoje,
        extrato.dias[extrato.dias.length - 1].data,
      ),
    [usaRegra, movsCaixa, complemento, pCenario, hoje, extrato.dias],
  );
  const dias = useMemo(() => recalcularDias(extrato, movs), [extrato, movs]);
  const mensal = useMemo(() => linhasMensais(extra, hoje, usaRegra, pCenario), [extra, hoje, usaRegra, pCenario]);

  const cen = extra.parametros.cenarios;
  const descricaoCenario =
    cenario === "conservador"
      ? `Cenário conservador: ${pct(cen.conservador.frac * 100)} de cada entrada prevista atrasa ${cen.conservador.atraso} dias — média dos últimos ${cen.conservador.meses} meses (parte do valor vencido recebida com mais de 15 dias de atraso ou ainda em aberto).`
      : cenario === "pessimista"
        ? `Cenário pessimista: ${pct(cen.pessimista.frac * 100)} de cada entrada prevista atrasa ${cen.pessimista.atraso} dias — o pior mês dos últimos 12${cen.pessimista.mes ? ` (${nomeMes(cen.pessimista.mes)})` : ""}. Entradas que passam do fim do horizonte saem da projeção.`
        : null;

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Visões do fluxo de caixa" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            type="button"
            aria-selected={aba === a.id}
            onClick={() => trocarAba(a.id)}
            className={clsx(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              aba === a.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-muted hover:text-fg",
            )}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba !== "inad" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado
            rotulo="Cenário"
            valor={cenario}
            onMudar={setCenario}
            opcoes={[
              { valor: "base", rotulo: "Cenário base" },
              { valor: "conservador", rotulo: "Conservador" },
              { valor: "pessimista", rotulo: "Pessimista" },
            ]}
          />
          {temContratos && fatBase.valor > 0 ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={usaRegra}
                onChange={(e) => setUsaRegra(e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              Incluir faturamento projetado dos contratos
              <span className="text-xs text-fg-muted">
                · {brl(fatBase.valor)}/mês, média de {fatBase.n} meses fechados
                {fatBase.de && fatBase.ate ? ` (${nomeMes(fatBase.de)}–${nomeMes(fatBase.ate)})` : ""}, recebimento de{" "}
                {pct(extra.parametros.recEfetivo * 100)}
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      <div role="tabpanel">
        {aba === "diario" ? (
          <AbaDiario
            extrato={extrato}
            extra={extra}
            movs={movs}
            dias={dias}
            limite={limite}
            minimo={minimo}
            descricaoCenario={descricaoCenario}
            onIrInadimplencia={() => trocarAba("inad")}
          />
        ) : aba === "categoria" ? (
          <AbaCategoria
            extrato={{ ...extrato, dias }}
            extra={extra}
            movs={movs}
            mensal={mensal}
            cenario={pCenario}
            usaRegra={usaRegra}
            ajustes={categoriasGrupo}
            limite={limite}
            minimo={minimo}
          />
        ) : aba === "mensal" ? (
          <AbaMensal extrato={extrato} extra={extra} mensal={mensal} linhasReceita={linhasReceita} limite={limite} minimo={minimo} />
        ) : (
          <AbaInadimplencia extra={extra} />
        )}
      </div>

      <p className="text-xs text-fg-subtle">
        Fonte: extrato das contas correntes e títulos do Omie. Realizado = títulos liquidados e lançamentos diretos na conta.
        Previsto = títulos em aberto (líquidos de retenções), previsão nativa de contratos e ordens de serviço e, quando ligada, a
        regra do dashboard. Conta garantida, aplicações sem liquidez e contas virtuais não somam no caixa próprio.
      </p>
    </div>
  );
}
