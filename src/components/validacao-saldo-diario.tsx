"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, EmptyHint, type ToneBadge } from "@/components/ui";
import { Toggle } from "@/components/toggle";
import { clsx } from "@/lib/clsx";
import { formatarDataCurta, type ValidacaoSaldoDia } from "@/lib/tipos";

// Sem "R$" aqui de proposito — o cifrao fica so no titulo da coluna
// (Banco (R$), Omie (R$), Dif. (R$)), nao repetido em toda linha da tabela.
const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // "aaaa-mm-dd"

/**
 * `null` em qualquer lado NUNCA conta como divergência — é dia sem dado
 * desse lado (fim de semana, extrato ainda não cobrindo aquele dia, ou —
 * do lado do Omie — buraco de dias sem sincronização impedindo calcular o
 * movimento isolado daquele dia), não um valor zero. Só "Divergente"
 * quando os dois lados têm valor e a diferença passa de R$1 (achado da
 * revisão adversarial do Codex, 2026-09-21: um resumo que trata ausência
 * como zero pode esconder justamente o caso que essa tela existe para
 * revelar).
 */
function statusPar(
  banco: number | null,
  omie: number | null,
  diferenca: number | null,
): { tone: ToneBadge; rotulo: string } {
  if (banco === null) return { tone: "neutral", rotulo: "Sem banco" };
  if (omie === null) return { tone: "warning", rotulo: "Sem Omie" };
  if (Math.abs(diferenca ?? 0) > 1) return { tone: "danger", rotulo: "Divergente" };
  return { tone: "success", rotulo: "OK" };
}

/** O dia que faz o operador abrir o Omie e conferir — divergência real dos
 * dois lados, ou o banco movimentou e o Omie não tem absolutamente nada
 * registrado naquele dia. Fim de semana sem movimento do banco não conta. */
function precisaAtencao(linha: ValidacaoSaldoDia): boolean {
  const mov = statusPar(linha.movimentoBanco, linha.movimentoOmie, linha.diferencaMovimento);
  const acumulado = statusPar(linha.saldoBanco, linha.saldoOmie, linha.diferenca);
  if (mov.tone === "danger" || acumulado.tone === "danger") return true;
  if (linha.movimentoBanco !== null && linha.movimentoOmie === null) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Colunas com largura ajustavel — arrasta a borda direita do cabecalho.
// Estado fica no componente de topo (ValidacaoSaldoDiario) e desce por
// props pra toda tabela usar a MESMA largura (varias contas empilhadas —
// ajustar numa deveria valer pras outras tambem, senao vira inconsistente).

const COLUNAS = [
  "data", "mBanco", "mOmie", "mDif", "mStatus", "aBanco", "aOmie", "aDif", "aStatus",
] as const;
type ColunaId = (typeof COLUNAS)[number];

const LARGURA_PADRAO: Record<ColunaId, number> = {
  data: 96, mBanco: 100, mOmie: 100, mDif: 100, mStatus: 88,
  aBanco: 100, aOmie: 100, aDif: 100, aStatus: 88,
};
const LARGURA_MINIMA = 56;

function useLargurasColuna() {
  const [larguras, setLarguras] = useState<Record<ColunaId, number>>(LARGURA_PADRAO);
  const arrastando = useRef<{ coluna: ColunaId; xInicial: number; larguraInicial: number } | null>(null);

  useEffect(() => {
    // Mouse events, nao Pointer events: mais confiavel em geral (inclusive
    // com automacao via CDP, que dispara mousedown/mousemove/mouseup mas
    // nem sempre sintetiza pointerdown/pointerup) — tela pensada pra
    // operador em desktop, nao mobile/touch.
    function mover(e: MouseEvent) {
      const atual = arrastando.current;
      if (!atual) return;
      const nova = Math.max(LARGURA_MINIMA, atual.larguraInicial + (e.clientX - atual.xInicial));
      setLarguras((prev) => ({ ...prev, [atual.coluna]: nova }));
    }
    function soltar() {
      arrastando.current = null;
    }
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
  }, []);

  function iniciarArrasto(coluna: ColunaId) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      arrastando.current = { coluna, xInicial: e.clientX, larguraInicial: larguras[coluna] };
    };
  }

  return { larguras, iniciarArrasto };
}

function AlcaResize({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute inset-y-0 -right-1 z-10 w-3 cursor-col-resize select-none hover:bg-accent/50 active:bg-accent/70"
    />
  );
}

// Tabela densa, de proposito diferente de Table/Th/Td compartilhados (usados
// em telas como Histórico) — essa tela é pra um operador escanear muitas
// linhas em sequência todo dia, não uma listagem esporádica; comprimir
// aqui não devia (e, por especificidade de classe do Tailwind, não
// conseguiria de forma confiável) comprimir as outras telas juntas.
function Cab({
  children,
  className,
  coluna,
  iniciarArrasto,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  coluna?: ColunaId;
  iniciarArrasto?: (coluna: ColunaId) => (e: React.MouseEvent) => void;
}) {
  return (
    <th
      className={clsx(
        "relative border-b border-border bg-surface-muted/60 px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-fg",
        className,
      )}
      {...props}
    >
      {children}
      {coluna && iniciarArrasto ? <AlcaResize onMouseDown={iniciarArrasto(coluna)} /> : null}
    </th>
  );
}

function Cel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={clsx("border-b border-border px-2.5 py-1 align-middle", className)}>
      {children}
    </td>
  );
}

function ValorCel({ valor }: { valor: number | null }) {
  return (
    <Cel className="text-right tabular-nums">{valor === null ? "—" : numero.format(valor)}</Cel>
  );
}

function StatusBadge({ tone, rotulo }: { tone: ToneBadge; rotulo: string }) {
  return (
    <Badge tone={tone} className="px-1.5 py-0 text-[10px] leading-4">
      {rotulo}
    </Badge>
  );
}

function ContaValidacao({
  contaId,
  linhas,
  larguras,
  iniciarArrasto,
}: {
  contaId: string;
  linhas: ValidacaoSaldoDia[];
  larguras: Record<ColunaId, number>;
  iniciarArrasto: (coluna: ColunaId) => (e: React.MouseEvent) => void;
}) {
  const [somenteAtencao, setSomenteAtencao] = useState(true);

  const diasComAtencao = useMemo(() => linhas.filter(precisaAtencao), [linhas]);
  const linhasExibidas = somenteAtencao ? diasComAtencao : linhas;
  const tudoCerto = diasComAtencao.length === 0;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {linhas[0]?.contaDescricao ?? "Conta"}{" "}
          <span className="font-normal text-fg-muted">· {contaId}</span>
        </h2>
        {tudoCerto ? (
          <Badge tone="success">Tudo certo no período</Badge>
        ) : (
          <Badge tone="danger">{diasComAtencao.length} dia(s) precisam de atenção</Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Toggle
          label="Mostrar só os dias que precisam de atenção"
          checked={somenteAtencao}
          onChange={setSomenteAtencao}
        />
        <span className="text-xs text-fg-muted">Só os dias que precisam de atenção</span>
      </div>

      {linhasExibidas.length === 0 ? (
        <EmptyHint>
          {tudoCerto
            ? "Nenhum dia precisa de atenção neste período — banco e Omie batem."
            : "Nada pra mostrar com esse filtro."}
        </EmptyHint>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-xs" style={{ tableLayout: "fixed" }}>
              <colgroup>
                {COLUNAS.map((c) => (
                  <col key={c} style={{ width: larguras[c] }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <Cab rowSpan={2} className="align-bottom" coluna="data" iniciarArrasto={iniciarArrasto}>
                    Data
                  </Cab>
                  {/* !text-center (nao so text-center): Cab tem text-left na
                      base, e como aqui e clsx puro (nao tailwind-merge), quem
                      vence entre as duas classes e a ordem de geracao do
                      Tailwind, nao a ordem no className — sem o "!" o titulo
                      ficava alinhado a esquerda mesmo com text-center presente. */}
                  <Cab colSpan={4} className="border-l border-border !text-center">
                    Movimento do dia
                  </Cab>
                  <Cab colSpan={4} className="border-l border-border !text-center">
                    Saldo acumulado
                  </Cab>
                </tr>
                <tr>
                  <Cab className="border-l border-border text-right" coluna="mBanco" iniciarArrasto={iniciarArrasto}>
                    Banco (R$)
                  </Cab>
                  <Cab className="text-right" coluna="mOmie" iniciarArrasto={iniciarArrasto}>
                    Omie (R$)
                  </Cab>
                  <Cab className="text-right" coluna="mDif" iniciarArrasto={iniciarArrasto}>
                    Dif. (R$)
                  </Cab>
                  <Cab coluna="mStatus" iniciarArrasto={iniciarArrasto}>Status</Cab>
                  <Cab className="border-l border-border text-right" coluna="aBanco" iniciarArrasto={iniciarArrasto}>
                    Banco (R$)
                  </Cab>
                  <Cab className="text-right" coluna="aOmie" iniciarArrasto={iniciarArrasto}>
                    Omie (R$)
                  </Cab>
                  <Cab className="text-right" coluna="aDif" iniciarArrasto={iniciarArrasto}>
                    Dif. (R$)
                  </Cab>
                  <Cab coluna="aStatus" iniciarArrasto={iniciarArrasto}>Status</Cab>
                </tr>
              </thead>
              <tbody>
                {linhasExibidas.map((linha) => {
                  const mov = statusPar(
                    linha.movimentoBanco,
                    linha.movimentoOmie,
                    linha.diferencaMovimento,
                  );
                  const acumulado = statusPar(
                    linha.saldoBanco,
                    linha.saldoOmie,
                    linha.diferenca,
                  );
                  return (
                    <tr
                      key={linha.data}
                      className={
                        linha.data === hoje
                          ? "bg-accent/5 hover:bg-accent/10"
                          : "hover:bg-surface-muted/50"
                      }
                    >
                      <Cel className="tabular-nums">
                        {formatarDataCurta(linha.data)}
                        {linha.data === hoje ? (
                          <span className="ml-1 text-[10px] text-fg-subtle">hoje</span>
                        ) : null}
                      </Cel>
                      <ValorCel valor={linha.movimentoBanco} />
                      <ValorCel valor={linha.movimentoOmie} />
                      <ValorCel valor={linha.diferencaMovimento} />
                      <Cel>
                        <StatusBadge {...mov} />
                      </Cel>
                      <ValorCel valor={linha.saldoBanco} />
                      <ValorCel valor={linha.saldoOmie} />
                      <ValorCel valor={linha.diferenca} />
                      <Cel>
                        <StatusBadge {...acumulado} />
                      </Cel>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {linhas[0]?.fonteExtrato ? (
        <p className="text-[11px] text-fg-subtle">Extrato: {linhas[0].fonteExtrato}</p>
      ) : null}
    </Card>
  );
}

export function ValidacaoSaldoDiario({ linhas }: { linhas: ValidacaoSaldoDia[] }) {
  const { larguras, iniciarArrasto } = useLargurasColuna();

  if (linhas.length === 0) {
    return (
      <EmptyHint>
        Nenhuma validação registrada ainda. Ela é gravada por
        scripts/validar_saldo_diario.py (proos-omie-mcp) quando alguém sobe um
        extrato novo — não há sincronização automática.
      </EmptyHint>
    );
  }

  const porConta = new Map<string, ValidacaoSaldoDia[]>();
  for (const linha of linhas) {
    const grupo = porConta.get(linha.contaId) ?? [];
    grupo.push(linha);
    porConta.set(linha.contaId, grupo);
  }

  return (
    <div className="space-y-4">
      {[...porConta.entries()].map(([contaId, linhasConta]) => (
        <ContaValidacao
          key={contaId}
          contaId={contaId}
          linhas={linhasConta}
          larguras={larguras}
          iniciarArrasto={iniciarArrasto}
        />
      ))}
    </div>
  );
}
