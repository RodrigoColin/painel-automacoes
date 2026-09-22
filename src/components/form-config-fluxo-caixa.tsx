"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { salvarConfigFluxoCaixa } from "@/lib/acoes";
import type { ConfigConta, ContaParaConfigurar, TipoConta } from "@/lib/omie/fluxo-caixa";

/**
 * Marcações da Proos para o fluxo de caixa do cliente — só admin da plataforma
 * vê este bloco. É aqui que se decide o que o Omie não sabe dizer: quais
 * contas são caixa, qual é dívida (conta garantida), qual aplicação tem
 * liquidez imediata e qual é o saldo mínimo da empresa.
 */
export function FormConfigFluxoCaixa({
  empresaId,
  saldoMinimo,
  contas,
}: {
  empresaId: string;
  saldoMinimo: number | null;
  contas: ContaParaConfigurar[];
}) {
  const [minimo, setMinimo] = useState(saldoMinimo === null ? "" : String(saldoMinimo));
  const [marcacoes, setMarcacoes] = useState<Record<string, ConfigConta>>(() =>
    Object.fromEntries(
      contas.map(({ codigo, entra, tipo, liquidezImediata, limite }) => [
        String(codigo),
        { entra, tipo, liquidezImediata, limite },
      ]),
    ),
  );
  const [pendente, iniciarTransicao] = useTransition();
  const [mensagem, setMensagem] = useState<{ erro: boolean; texto: string } | null>(null);

  function alterar(codigo: number, parte: Partial<ConfigConta>) {
    setMarcacoes((atual) => ({ ...atual, [codigo]: { ...atual[String(codigo)], ...parte } }));
  }

  function salvar() {
    setMensagem(null);
    const valor = minimo.trim() === "" ? null : Number(minimo.replace(/\./g, "").replace(",", "."));
    if (valor !== null && !Number.isFinite(valor)) {
      setMensagem({ erro: true, texto: "Saldo mínimo inválido." });
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await salvarConfigFluxoCaixa({ empresaId, saldoMinimo: valor, contas: marcacoes });
      setMensagem(
        resultado.erro
          ? { erro: true, texto: resultado.erro }
          : { erro: false, texto: "Configuração salva. A tela já usa as novas marcações." },
      );
    });
  }

  return (
    <Card className="p-5">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Configuração da Proos
          <span className="ml-2 text-xs font-normal text-fg-muted">
            visível só para administradores — contas, conta garantida, aplicações e saldo mínimo
          </span>
        </summary>

        <div className="mt-4 space-y-5">
          <label className="block max-w-xs space-y-1.5">
            <span className="text-xs font-medium text-fg-muted">Saldo mínimo de caixa (R$)</span>
            <input
              inputMode="decimal"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              placeholder="Em branco = sem alerta"
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">
                  <th className="border-b border-border py-2 pr-3">Conta no Omie</th>
                  <th className="border-b border-border py-2 pr-3">Entra no fluxo</th>
                  <th className="border-b border-border py-2 pr-3">Tipo</th>
                  <th className="border-b border-border py-2 pr-3">Liquidez imediata</th>
                  <th className="border-b border-border py-2">Limite (R$)</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((conta) => {
                  const marcacao = marcacoes[String(conta.codigo)];
                  return (
                    <tr key={conta.codigo}>
                      <td className="border-b border-border py-2 pr-3">
                        <span className="block font-medium">{conta.descricao}</span>
                        <span className="text-xs tabular-nums text-fg-subtle">{conta.codigo}</span>
                      </td>
                      <td className="border-b border-border py-2 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`${conta.descricao} entra no fluxo`}
                          checked={marcacao.entra}
                          onChange={(e) => alterar(conta.codigo, { entra: e.target.checked })}
                          className="size-4 accent-[var(--accent)]"
                        />
                      </td>
                      <td className="border-b border-border py-2 pr-3">
                        <select
                          aria-label={`Tipo de ${conta.descricao}`}
                          value={marcacao.tipo}
                          onChange={(e) => alterar(conta.codigo, { tipo: e.target.value as TipoConta })}
                          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                        >
                          <option value="corrente">Conta corrente</option>
                          <option value="aplicacao">Aplicação</option>
                          <option value="garantida">Conta garantida (dívida)</option>
                        </select>
                      </td>
                      <td className="border-b border-border py-2 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`${conta.descricao} tem liquidez imediata`}
                          disabled={marcacao.tipo !== "aplicacao"}
                          checked={marcacao.tipo === "aplicacao" && marcacao.liquidezImediata}
                          onChange={(e) => alterar(conta.codigo, { liquidezImediata: e.target.checked })}
                          className="size-4 accent-[var(--accent)] disabled:opacity-40"
                        />
                      </td>
                      <td className="border-b border-border py-2">
                        <input
                          inputMode="decimal"
                          aria-label={`Limite de ${conta.descricao}`}
                          disabled={marcacao.tipo !== "garantida"}
                          value={marcacao.tipo === "garantida" ? marcacao.limite || "" : ""}
                          onChange={(e) => alterar(conta.codigo, { limite: Number(e.target.value.replace(",", ".")) || 0 })}
                          className="h-9 w-32 rounded-md border border-border bg-surface px-2 text-sm tabular-nums disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={salvar} disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar configuração"}
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
