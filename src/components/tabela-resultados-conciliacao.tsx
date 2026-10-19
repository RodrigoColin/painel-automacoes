"use client";

import { useMemo, useState } from "react";
import { Badge, Button, type ToneBadge } from "@/components/ui";
import { Toggle } from "@/components/toggle";
import { IconCheck } from "@/components/icons";
import { ModalDecisaoLinha } from "@/components/modal-decisao-linha";
import { clsx } from "@/lib/clsx";
import { formatarDataCurta } from "@/lib/tipos";
import type { ResultadoDecisaoLinha, ResultadoLinha, TituloResumo } from "@/lib/acoes-conciliacao";

const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROTULO_DESFECHO: Record<string, string> = {
  titulo: "Título",
  lanc_direto: "Lançamento direto",
  transferencia: "Transferência",
  conciliar_recebido: "Recebido no Omie",
  fila: "Fila",
};

const TONE_FAIXA: Record<string, ToneBadge> = {
  automatico: "success",
  revisao: "warning",
  excecao: "danger",
};

const ROTULO_FAIXA: Record<string, string> = {
  automatico: "Automático",
  revisao: "Revisão",
  excecao: "Exceção",
};

// Tabela densa, mesmo motivo de validacao-saldo-diario.tsx: uma lista de
// 100+ linhas pra o operador escanear em sequencia, nao uma listagem
// esporadica — comprime com componentes locais em vez dos Th/Td
// compartilhados (especificidade de classe do Tailwind nao é confiável
// pra override, ver comentário na outra tela).
function Cab({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={clsx(
        "border-b border-border bg-surface-muted/60 px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-fg",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Cel({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      className={clsx("border-b border-border px-2.5 py-1.5 align-middle", className)}
      title={title}
    >
      {children}
    </td>
  );
}

export function TabelaResultadosConciliacao({
  linhas,
  contaOmie,
  titulosCarregados,
  empresaId,
}: {
  linhas: ResultadoLinha[];
  contaOmie: string;
  titulosCarregados: TituloResumo[];
  empresaId: string;
}) {
  const [somenteAtencao, setSomenteAtencao] = useState(true);
  // Feedback visual imediato de "já decidi essa linha nesta sessão" — a
  // auditoria de verdade fica em sombra/{slug}/decisoes.json no lado
  // Python, então não precisa sobreviver a um reload desta página.
  const [decididas, setDecididas] = useState<Map<string, ResultadoDecisaoLinha>>(new Map());
  const [linhaEmDecisao, setLinhaEmDecisao] = useState<ResultadoLinha | null>(null);

  // Duplicidade = a linha ja esta conciliada no Omie; nao ha o que decidir,
  // entao conta como resolvida (fora da fila de atencao), igual ao automatico.
  const ehDuplicidade = (l: ResultadoLinha) => l.tipoExcecao === "duplicidade";
  const linhasComAtencao = useMemo(
    () => linhas.filter((l) => l.faixa !== "automatico" && l.tipoExcecao !== "duplicidade"),
    [linhas],
  );
  const jaConciliadas = useMemo(
    () => linhas.filter((l) => l.tipoExcecao === "duplicidade").length,
    [linhas],
  );
  const linhasExibidas = somenteAtencao ? linhasComAtencao : linhas;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Toggle
          label="Mostrar só o que precisa de atenção (revisão e exceção)"
          checked={somenteAtencao}
          onChange={setSomenteAtencao}
        />
        <span className="text-xs text-fg-muted">
          Só o que precisa de atenção ({linhasComAtencao.length} de {linhas.length})
        </span>
        {jaConciliadas > 0 ? (
          <span className="text-xs text-fg-subtle">
            · {jaConciliadas} já conciliada{jaConciliadas === 1 ? "" : "s"} no Omie, fora da fila
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <Cab className="w-20">Data</Cab>
                <Cab>Descrição</Cab>
                <Cab className="text-right">Valor (R$)</Cab>
                <Cab>Desfecho</Cab>
                <Cab>Faixa</Cab>
                <Cab>Título casado</Cab>
                <Cab>Motivo</Cab>
                <Cab className="whitespace-nowrap">Ação</Cab>
              </tr>
            </thead>
            <tbody>
              {linhasExibidas.map((l) => (
                <tr key={l.linhaId} className="hover:bg-surface-muted/50">
                  <Cel className="tabular-nums">{formatarDataCurta(l.data)}</Cel>
                  <Cel className="max-w-[260px] truncate" title={l.descricao}>
                    {l.descricao}
                  </Cel>
                  <Cel className="text-right tabular-nums">{numero.format(Number(l.valor))}</Cel>
                  <Cel>{ROTULO_DESFECHO[l.desfecho] ?? l.desfecho}</Cel>
                  <Cel>
                    <Badge
                      tone={TONE_FAIXA[l.faixa] ?? "neutral"}
                      className="px-1.5 py-0 text-[10px] leading-4"
                    >
                      {ROTULO_FAIXA[l.faixa] ?? l.faixa}
                    </Badge>
                  </Cel>
                  <Cel className="max-w-[220px] truncate" title={l.tituloParceiro ?? undefined}>
                    {l.cascata && l.cascata.length > 0 ? (
                      <>
                        {l.cascata.length} boletos
                        <span className="text-fg-subtle">
                          {" · "}
                          {numero.format(
                            l.cascata.reduce((s, b) => s + Number(b.valor), 0),
                          )}
                        </span>
                      </>
                    ) : l.tituloParceiro ? (
                      <>
                        {l.tituloParceiro}
                        {l.tituloValor ? (
                          <span className="text-fg-subtle"> · {numero.format(Number(l.tituloValor))}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </Cel>
                  <Cel className="max-w-[320px] truncate" title={l.motivo}>
                    {l.motivo || (l.tipoExcecao ? l.tipoExcecao : "—")}
                  </Cel>
                  <Cel className="whitespace-nowrap">
                    {ehDuplicidade(l) ? (
                      <Badge tone="neutral" className="px-1.5 py-0 text-[10px] leading-4">
                        Já no Omie
                      </Badge>
                    ) : l.faixa === "automatico" ? (
                      <span className="text-fg-subtle">—</span>
                    ) : decididas.has(l.linhaId) ? (
                      <Badge tone="success" className="px-1.5 py-0 text-[10px] leading-4">
                        <IconCheck className="size-3" />
                        Decidido
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        onClick={() => setLinhaEmDecisao(l)}
                      >
                        Decidir
                      </Button>
                    )}
                  </Cel>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {linhasExibidas.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-muted/40 p-4 text-center text-sm text-fg-muted">
          Nenhuma linha precisa de atenção — tudo caiu em automático ou já estava
          conciliado no Omie.
        </p>
      ) : null}

      {linhaEmDecisao ? (
        <ModalDecisaoLinha
          linha={linhaEmDecisao}
          contaOmie={contaOmie}
          titulosCarregados={titulosCarregados}
          empresaId={empresaId}
          onFechar={() => setLinhaEmDecisao(null)}
          onDecidido={(linhaId, resultado) =>
            setDecididas((atual) => new Map(atual).set(linhaId, resultado))
          }
        />
      ) : null}
    </div>
  );
}
