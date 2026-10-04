"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { salvarConfigRecorrencia } from "@/lib/acoes";
import type { CategoriaRecorrenciaConfig } from "@/lib/omie/faturamento";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/**
 * Marcação da Proos de quais categorias são receita recorrente para o cliente —
 * só admin da plataforma vê. Sem isso, a recorrência depende do nome conter
 * "Recorrente", que não acerta cliente novo (ex.: Startlaw). Desmarcar tudo
 * volta ao heurístico de nome.
 */
export function FormConfigRecorrencia({
  empresaId,
  categorias,
}: {
  empresaId: string;
  categorias: CategoriaRecorrenciaConfig[];
}) {
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(categorias.filter((c) => c.recorrente).map((c) => c.codigo)),
  );
  const [pendente, iniciarTransicao] = useTransition();
  const [mensagem, setMensagem] = useState<{ erro: boolean; texto: string } | null>(null);

  const totalRecorrente = useMemo(
    () => categorias.filter((c) => marcados.has(c.codigo)).reduce((s, c) => s + c.total, 0),
    [categorias, marcados],
  );

  function alternar(codigo: string, marcado: boolean) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(codigo);
      else proximo.delete(codigo);
      return proximo;
    });
  }

  function salvar() {
    setMensagem(null);
    iniciarTransicao(async () => {
      const resultado = await salvarConfigRecorrencia({
        empresaId,
        categoriaCodigos: [...marcados],
      });
      setMensagem(
        resultado.erro
          ? { erro: true, texto: resultado.erro }
          : { erro: false, texto: "Salvo. A recorrência já usa as categorias marcadas." },
      );
    });
  }

  return (
    <Card className="p-5">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Categorias de receita recorrente
          <span className="ml-2 text-xs font-normal text-fg-muted">
            visível só para administradores — marque o que conta como MRR; vazio = pelo nome “Recorrente”
          </span>
        </summary>

        <div className="mt-4 space-y-5">
          {categorias.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Nenhuma categoria faturada ainda. Sincronize o faturamento primeiro.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">
                      <th className="border-b border-border py-2 pr-3">Recorrente</th>
                      <th className="border-b border-border py-2 pr-3">Categoria no Omie</th>
                      <th className="border-b border-border py-2 text-right">Faturado (total)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorias.map((c) => (
                      <tr key={c.codigo}>
                        <td className="border-b border-border py-2 pr-3">
                          <input
                            type="checkbox"
                            aria-label={`${c.descricao} é recorrente`}
                            checked={marcados.has(c.codigo)}
                            onChange={(e) => alternar(c.codigo, e.target.checked)}
                            className="size-4 accent-[var(--accent)]"
                          />
                        </td>
                        <td className="border-b border-border py-2 pr-3">
                          <span className="block font-medium">{c.descricao}</span>
                          <span className="text-xs tabular-nums text-fg-subtle">{c.codigo}</span>
                        </td>
                        <td className="border-b border-border py-2 text-right tabular-nums">
                          {brl.format(c.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-fg-muted">
                {marcados.size} categoria(s) marcada(s) · faturamento recorrente acumulado{" "}
                <span className="font-medium tabular-nums">{brl.format(totalRecorrente)}</span>
              </p>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={salvar} disabled={pendente || categorias.length === 0}>
              {pendente ? "Salvando…" : "Salvar categorias recorrentes"}
            </Button>
            {mensagem ? (
              <p role="status" className={mensagem.erro ? "text-sm text-danger" : "text-sm text-success"}>
                {mensagem.texto}
              </p>
            ) : null}
          </div>
        </div>
      </details>
    </Card>
  );
}
