"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui";
import { salvarConfigFluxoCaixa } from "@/lib/acoes";
import { GRUPOS_FLUXO, grupoDe } from "@/lib/fluxo-caixa/grupos";
import type { LinhaReceita } from "@/lib/fluxo-caixa/tipos";
import type { ConfigConta, ContaParaConfigurar, TipoConta } from "@/lib/omie/fluxo-caixa";

const campo =
  "h-9 rounded-md border border-border bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

/**
 * Marcações da Proos para o fluxo de caixa do cliente — só admin da plataforma
 * vê este bloco. É aqui que se decide o que o Omie não sabe dizer: quais
 * contas são caixa, qual é dívida (conta garantida), qual aplicação tem
 * liquidez imediata, limites, saldo mínimo, em que grupo cai cada categoria e
 * quais são as linhas de receita da empresa.
 */
export function FormConfigFluxoCaixa({
  empresaId,
  saldoMinimo,
  contas,
  categorias,
  categoriasGrupo,
  linhasReceita,
}: {
  empresaId: string;
  saldoMinimo: number | null;
  contas: ContaParaConfigurar[];
  categorias: string[];
  categoriasGrupo: Record<string, string>;
  linhasReceita: LinhaReceita[];
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
  const [ajustes, setAjustes] = useState<Record<string, string>>(categoriasGrupo);
  const [linhas, setLinhas] = useState<{ nome: string; termos: string }[]>(() =>
    linhasReceita.map((l) => ({ nome: l.nome, termos: l.termos.join(", ") })),
  );
  const [pendente, iniciarTransicao] = useTransition();
  const [mensagem, setMensagem] = useState<{ erro: boolean; texto: string } | null>(null);

  const todasCategorias = [...new Set([...categorias, ...Object.keys(categoriasGrupo)])].sort((a, b) => a.localeCompare(b, "pt-BR"));

  function alterar(codigo: number, parte: Partial<ConfigConta>) {
    setMarcacoes((atual) => ({ ...atual, [codigo]: { ...atual[String(codigo)], ...parte } }));
  }

  function alterarAjuste(categoria: string, grupo: string) {
    setAjustes((atual) => {
      const novo = { ...atual };
      if (grupo) novo[categoria] = grupo;
      else delete novo[categoria];
      return novo;
    });
  }

  function salvar() {
    setMensagem(null);
    const valor = minimo.trim() === "" ? null : Number(minimo.replace(/\./g, "").replace(",", "."));
    if (valor !== null && !Number.isFinite(valor)) {
      setMensagem({ erro: true, texto: "Saldo mínimo inválido." });
      return;
    }
    iniciarTransicao(async () => {
      const resultado = await salvarConfigFluxoCaixa({
        empresaId,
        saldoMinimo: valor,
        contas: marcacoes,
        categoriasGrupo: ajustes,
        linhasReceita: linhas.map((l) => ({ nome: l.nome, termos: l.termos.split(",") })),
      });
      setMensagem(
        resultado.erro
          ? { erro: true, texto: resultado.erro }
          : { erro: false, texto: "Configuração salva. Grupos já valem na tela; contas e limites entram na próxima rodada, que já foi pedida." },
      );
    });
  }

  return (
    <Card className="p-5">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Configuração da Proos
          <span className="ml-2 text-xs font-normal text-fg-muted">
            visível só para administradores — contas, limites, saldo mínimo, grupos de categoria e linhas de receita
          </span>
        </summary>

        <div className="mt-4 space-y-6">
          <label className="block max-w-xs space-y-1.5">
            <span className="text-xs font-medium text-fg-muted">Saldo mínimo de caixa (R$)</span>
            <input
              inputMode="decimal"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              placeholder="Em branco = sem alerta"
              className={`${campo} w-full tabular-nums`}
            />
          </label>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Contas</h3>
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
                            className={campo}
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
                            title="Cheque especial da conta corrente ou limite da conta garantida"
                            disabled={marcacao.tipo === "aplicacao"}
                            value={marcacao.tipo !== "aplicacao" ? marcacao.limite || "" : ""}
                            onChange={(e) => alterar(conta.codigo, { limite: Number(e.target.value.replace(/\./g, "").replace(",", ".")) || 0 })}
                            className={`${campo} w-32 tabular-nums`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Linhas de receita</h3>
            <p className="text-xs text-fg-muted">
              Agrupam o faturamento por produto. A categoria entra na primeira linha com um termo contido no nome (separe os termos por
              vírgula). Sem nenhuma linha, a tela separa só receita recorrente das outras.
            </p>
            <div className="space-y-2">
              {linhas.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Nome da linha"
                    placeholder="Nome (ex.: Assinaturas)"
                    value={l.nome}
                    onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))}
                    className={`${campo} w-56`}
                  />
                  <input
                    aria-label="Termos da linha"
                    placeholder="Termos (ex.: assinatura, mensalidade)"
                    value={l.termos}
                    onChange={(e) => setLinhas(linhas.map((x, j) => (j === i ? { ...x, termos: e.target.value } : x)))}
                    className={`${campo} min-w-64 flex-1`}
                  />
                  <Button variant="ghost" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>
                    Remover
                  </Button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setLinhas([...linhas, { nome: "", termos: "" }])}>
                Adicionar linha
              </Button>
            </div>
          </section>

          {todasCategorias.length ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Grupo de cada categoria</h3>
              <p className="text-xs text-fg-muted">
                O grupo sai do nome da categoria; escolha outro só onde a regra errar. Categorias vistas na última rodada.
              </p>
              <div className="max-h-96 overflow-y-auto rounded-md border border-border">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {todasCategorias.map((cat) => {
                      const automaticoReceita = grupoDe(cat, 1, {});
                      const automaticoDespesa = grupoDe(cat, -1, {});
                      return (
                        <tr key={cat}>
                          <td className="border-b border-border px-3 py-1.5">{cat}</td>
                          <td className="border-b border-border px-3 py-1.5 text-right">
                            <select
                              aria-label={`Grupo de ${cat}`}
                              value={ajustes[cat] ?? ""}
                              onChange={(e) => alterarAjuste(cat, e.target.value)}
                              className={campo}
                            >
                              <option value="">
                                Automático ({GRUPOS_FLUXO.find((g) => g.id === automaticoReceita)?.nome} /{" "}
                                {GRUPOS_FLUXO.find((g) => g.id === automaticoDespesa)?.nome})
                              </option>
                              {GRUPOS_FLUXO.filter((g) => g.id !== "fat").map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.nome}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

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
