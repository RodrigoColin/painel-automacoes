"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevron, IconDownload, IconExterno } from "@/components/icons";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import type {
  CategoriaFaturamento,
  ClienteFaturamento,
  ClienteSemFaturamento,
  Mes,
  MovimentoCliente,
  MovimentoMensal,
} from "@/lib/omie/faturamento";
import {
  brlInteiro,
  FUNDO_CATEGORIA,
  formatarPercentual,
  numero,
  tomVariacao,
  variacaoPercentual,
  variacaoReais,
} from "@/lib/omie/formatacao";

/* ---------------------------- Mês de referência --------------------------- */

export function SeletorMesReferencia({ meses, atual }: { meses: Mes[]; atual: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">Mês de referência</span>
      <select
        value={atual}
        onChange={(e) => {
          const novos = new URLSearchParams(parametros);
          novos.set("mes", e.target.value);
          router.push(`${pathname}?${novos}`, { scroll: false });
        }}
        className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {[...meses].reverse().map((mes, i, lista) => (
          <option key={mes.chave} value={mes.chave}>
            {mes.rotulo}
            {mes.parcial ? " (parcial)" : ""} (vs. {lista[i + 1]?.rotulo ?? "mês anterior"})
          </option>
        ))}
      </select>
      <span className="text-xs text-fg-subtle">variação sempre contra o mês anterior</span>
    </label>
  );
}

/**
 * Mesmo controle de `SeletorMesReferencia`, compacto — só o select, sem
 * rótulo nem texto de ajuda. Para repetir a comparação de mês no topo de
 * seções que já têm sua própria explicação (por categoria, por cliente).
 */
export function SeletorMesCompacto({ meses, atual }: { meses: Mes[]; atual: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();
  const lista = [...meses].reverse();

  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      Comparar:
      <select
        value={atual}
        onChange={(e) => {
          const novos = new URLSearchParams(parametros);
          novos.set("mes", e.target.value);
          router.push(`${pathname}?${novos}`, { scroll: false });
        }}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs font-medium text-fg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {lista.map((mes, i) => (
          <option key={mes.chave} value={mes.chave}>
            {mes.rotulo}
            {mes.parcial ? " (parcial)" : ""} (vs. {lista[i + 1]?.rotulo ?? "mês anterior"})
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------- Comparativo de categorias ----------------------- */

type ModoValor = "valor" | "reais" | "percentual";

const ABAS_MODO: { id: ModoValor; rotulo: string }[] = [
  { id: "valor", rotulo: "Valor" },
  { id: "reais", rotulo: "Var. R$" },
  { id: "percentual", rotulo: "Var. %" },
];

/**
 * Baixa linhas como CSV com separador ";" — o Excel em pt-BR abre direto. A
 * primeira linha de `linhas` é o cabeçalho; uma linha vazia (`[]`) no meio
 * separa mais de uma tabela no mesmo arquivo.
 */
function exportarCsv(nomeArquivo: string, linhas: string[][]) {
  const escapar = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const conteudo = linhas.map((linha) => linha.map(escapar).join(";")).join("\r\n");
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Valor da célula no modo selecionado; `null` quando não há mês anterior na janela para comparar. */
function celulaModo(valoresPorColuna: number[], indice: number, modo: ModoValor): number | null {
  const atual = valoresPorColuna[indice];
  if (modo === "valor") return atual;
  if (indice === 0) return null;
  const anterior = valoresPorColuna[indice - 1];
  return modo === "reais" ? atual - anterior : variacaoPercentual(anterior, atual);
}

/** Total da linha no modo selecionado: soma no valor, variação entre o primeiro e o último mês da janela nos outros. */
function totalModo(valoresPorColuna: number[], modo: ModoValor): number | null {
  if (modo === "valor") return valoresPorColuna.reduce((s, v) => s + v, 0);
  const primeiro = valoresPorColuna[0];
  const ultimo = valoresPorColuna.at(-1)!;
  return modo === "reais" ? ultimo - primeiro : variacaoPercentual(primeiro, ultimo);
}

function formatarCelula(valor: number | null, modo: ModoValor): string {
  if (valor === null) return "—";
  if (modo === "valor") return valor === 0 ? "—" : brlInteiro.format(valor);
  return modo === "reais" ? variacaoReais(valor) : formatarPercentual(valor);
}

function tomCelula(valor: number | null, modo: ModoValor): string {
  return modo === "valor" || valor === null ? "" : tomVariacao(valor);
}

type CampoOrdemCategorias = "nome" | "total" | string;

/**
 * Tabela sob o gráfico de "Faturamento por categoria": por padrão, o
 * comparativo dos dois meses do "Comparar"; com "Ver histórico completo",
 * o ano inteiro, categoria × mês, trocando o que cada célula mostra (valor,
 * variação em R$ ou em %) pelas abas. Os dois modos exportam para CSV.
 */
export function ComparativoCategorias({
  categorias,
  meses,
  mesesReferencia,
  porMesCategoria,
  referencia,
  anterior,
}: {
  categorias: CategoriaFaturamento[];
  meses: Mes[];
  mesesReferencia: Mes[];
  /** [mês][categoria] — valores na ordem de `meses` e `categorias`. */
  porMesCategoria: number[][];
  referencia: Mes;
  anterior: Mes;
}) {
  const [historico, setHistorico] = useState(false);
  const [modo, setModo] = useState<ModoValor>("valor");
  const [ordem, setOrdem] = useState<{ campo: CampoOrdemCategorias | null; desc: boolean }>({
    campo: null,
    desc: false,
  });

  const indicePorChave = useMemo(() => new Map(meses.map((m, i) => [m.chave, i])), [meses]);
  const iRef = indicePorChave.get(referencia.chave)!;
  const iAnt = indicePorChave.get(anterior.chave)!;

  const linhasHistorico = useMemo(
    () =>
      categorias.map((categoria, iCat) => {
        const valoresPorColuna = meses.map((_, iMes) => porMesCategoria[iMes][iCat]);
        return {
          categoria,
          celulas: valoresPorColuna.map((_, i) => celulaModo(valoresPorColuna, i, modo)),
          total: totalModo(valoresPorColuna, modo),
        };
      }),
    [categorias, meses, porMesCategoria, modo],
  );

  const linhasExibidas = useMemo(() => {
    const campo = ordem.campo;
    if (campo === null) return linhasHistorico;
    const valor = (linha: (typeof linhasHistorico)[number]) => {
      if (campo === "nome") return linha.categoria.descricao;
      if (campo === "total") return linha.total ?? Number.NEGATIVE_INFINITY;
      return linha.celulas[indicePorChave.get(campo)!] ?? Number.NEGATIVE_INFINITY;
    };
    return [...linhasHistorico].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const comparacao =
        typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : (va as number) - (vb as number);
      return ordem.desc ? -comparacao : comparacao;
    });
  }, [linhasHistorico, ordem, indicePorChave]);

  const totalGeralPorColuna = meses.map((_, iMes) =>
    categorias.reduce((s, _c, iCat) => s + porMesCategoria[iMes][iCat], 0),
  );
  const totalGeralCelulas = totalGeralPorColuna.map((_, i) => celulaModo(totalGeralPorColuna, i, modo));
  const totalGeralTotal = totalModo(totalGeralPorColuna, modo);

  const totalAnterior = categorias.reduce((s, _c, i) => s + porMesCategoria[iAnt][i], 0);
  const totalReferencia = categorias.reduce((s, _c, i) => s + porMesCategoria[iRef][i], 0);

  function exportar() {
    if (historico) {
      exportarCsv(`faturamento-por-categoria-${meses[0]?.chave}-a-${meses.at(-1)?.chave}.csv`, [
        ["Categoria", ...meses.map((m) => m.rotulo), "Total"],
        ...linhasExibidas.map((linha) => [
          linha.categoria.descricao,
          ...linha.celulas.map((v) => formatarCelula(v, modo)),
          formatarCelula(linha.total, modo),
        ]),
      ]);
      return;
    }
    exportarCsv(`faturamento-por-categoria-${referencia.chave}.csv`, [
      ["Categoria", anterior.rotulo, referencia.rotulo, "Var. R$", "Var. %"],
      ...categorias.map((categoria, i) => {
        const va = porMesCategoria[iAnt][i];
        const vr = porMesCategoria[iRef][i];
        return [
          categoria.descricao,
          brlInteiro.format(va),
          brlInteiro.format(vr),
          variacaoReais(vr - va),
          formatarPercentual(variacaoPercentual(va, vr)),
        ];
      }),
    ]);
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {historico
            ? `Histórico mensal — ${meses[0]?.rotulo} a ${meses.at(-1)?.rotulo}`
            : `Comparativo ${anterior.rotulo} → ${referencia.rotulo}`}
        </h3>
        <SeletorMesCompacto meses={mesesReferencia} atual={referencia.chave} />
      </div>

      {historico ? (
        <div
          role="tablist"
          aria-label="O que exibir na tabela"
          className="flex w-fit gap-1 rounded-md border border-border bg-surface-muted p-1"
        >
          {ABAS_MODO.map((aba) => (
            <button
              key={aba.id}
              type="button"
              role="tab"
              aria-selected={modo === aba.id}
              onClick={() => setModo(aba.id)}
              className={clsx(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                modo === aba.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {aba.rotulo}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={exportar} className="text-xs">
          <IconDownload className="size-4" />
          Exportar Excel
        </Button>
        <Button variant="secondary" onClick={() => setHistorico((v) => !v)} className="text-xs">
          {historico ? `Ver ${anterior.rotulo} → ${referencia.rotulo}` : "Ver histórico completo"}
          <IconChevron className={clsx("size-4 transition-transform", historico ? "-rotate-90" : "rotate-90")} />
        </Button>
      </div>

      {historico ? (
        <p className="text-xs text-fg-subtle">
          Exibindo: {ABAS_MODO.find((a) => a.id === modo)!.rotulo} — clique num mês (ou Categoria/Total) para
          ordenar.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        {historico ? (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-subtle">
                <Cabecalho campo="nome" ordem={ordem} setOrdem={setOrdem}>
                  Categoria
                </Cabecalho>
                {meses.map((mes) => (
                  <Cabecalho key={mes.chave} campo={mes.chave} ordem={ordem} setOrdem={setOrdem} direita>
                    {mes.rotuloCurto}
                  </Cabecalho>
                ))}
                <Cabecalho campo="total" ordem={ordem} setOrdem={setOrdem} direita>
                  Total
                </Cabecalho>
              </tr>
            </thead>
            <tbody>
              {linhasExibidas.map((linha) => (
                <tr key={linha.categoria.codigo} className="border-b border-border">
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={clsx("size-2.5 shrink-0 rounded-[3px]", FUNDO_CATEGORIA[linha.categoria.slot])}
                      />
                      {linha.categoria.descricao}
                    </span>
                  </td>
                  {linha.celulas.map((v, i) => (
                    <td
                      key={meses[i].chave}
                      className={clsx("px-3 py-2 text-right tabular-nums", tomCelula(v, modo))}
                    >
                      {formatarCelula(v, modo)}
                    </td>
                  ))}
                  <td className={clsx("py-2 pl-3 text-right font-semibold tabular-nums", tomCelula(linha.total, modo))}>
                    {formatarCelula(linha.total, modo)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 pr-3">Total geral</td>
                {totalGeralCelulas.map((v, i) => (
                  <td
                    key={meses[i].chave}
                    className={clsx("px-3 py-2 text-right tabular-nums", tomCelula(v, modo))}
                  >
                    {formatarCelula(v, modo)}
                  </td>
                ))}
                <td className={clsx("py-2 pl-3 text-right tabular-nums", tomCelula(totalGeralTotal, modo))}>
                  {formatarCelula(totalGeralTotal, modo)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
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
              {categorias.map((categoria, i) => {
                const va = porMesCategoria[iAnt][i];
                const vr = porMesCategoria[iRef][i];
                const diferenca = vr - va;
                return (
                  <tr key={categoria.codigo} className="border-b border-border">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={clsx("size-2.5 shrink-0 rounded-[3px]", FUNDO_CATEGORIA[categoria.slot])} />
                        {categoria.descricao}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{brlInteiro.format(va)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brlInteiro.format(vr)}</td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(diferenca))}>
                      {variacaoReais(diferenca)}
                    </td>
                    <td className={clsx("py-2 pl-3 text-right tabular-nums", tomVariacao(diferenca))}>
                      {formatarPercentual(variacaoPercentual(va, vr))}
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
        )}
      </div>
    </div>
  );
}

/* --------------------------- Faturamento por cliente ---------------------- */

/**
 * Botão "Categorias" com um menu de checkboxes — troca a fileira de pills
 * (uma por categoria, ocupando uma linha inteira) por um único controle
 * compacto, com badge mostrando quantas estão marcadas.
 */
function SeletorCategorias({
  categorias,
  filtro,
  onAlternar,
  onLimpar,
}: {
  categorias: CategoriaFaturamento[];
  filtro: Set<string>;
  onAlternar: (codigo: string) => void;
  onLimpar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listaId = useId();

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(evento: MouseEvent) {
      if (!containerRef.current?.contains(evento.target as Node)) setAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-controls={aberto ? listaId : undefined}
        className={clsx(
          "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
          filtro.size > 0
            ? "border-fg bg-surface-muted text-fg"
            : "border-border bg-surface text-fg-muted hover:bg-surface-muted hover:text-fg",
        )}
      >
        Categorias
        {filtro.size > 0 ? (
          <span className="grid size-4 place-items-center rounded-full bg-fg text-[10px] font-semibold text-surface">
            {filtro.size}
          </span>
        ) : null}
        <IconChevron className={clsx("size-3.5 transition-transform", aberto ? "-rotate-90" : "rotate-90")} />
      </button>

      {aberto ? (
        <div
          id={listaId}
          role="menu"
          aria-label="Filtrar por categoria"
          className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto p-1">
            {categorias.map((categoria) => {
              const ativo = filtro.has(categoria.codigo);
              return (
                <li key={categoria.codigo}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={ativo}
                    onClick={() => onAlternar(categoria.codigo)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-surface-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        ativo ? "border-fg bg-fg text-surface" : "border-border-strong",
                      )}
                    >
                      {ativo ? <IconCheck className="size-3" /> : null}
                    </span>
                    <span
                      aria-hidden="true"
                      className={clsx("size-2 shrink-0 rounded-full", FUNDO_CATEGORIA[categoria.slot])}
                    />
                    <span className="min-w-0 truncate">{categoria.descricao}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {filtro.size > 0 ? (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={onLimpar}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
              >
                Limpar filtros
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Ordem = "nome" | "anterior" | "referencia" | "variacao" | "percentual";

/**
 * Quantos clientes a tabela mostra antes do "Ver todos". Uma conta com
 * centenas de clientes faria a aba inteira virar uma página sem fim.
 */
const LIMITE_CLIENTES = 15;

export function TabelaClientesFaturamento({
  clientes,
  categorias,
  meses,
  mesesReferencia,
  referencia,
  anterior,
}: {
  clientes: ClienteFaturamento[];
  categorias: CategoriaFaturamento[];
  meses: Mes[];
  mesesReferencia: Mes[];
  referencia: Mes;
  anterior: Mes;
}) {
  const [filtro, setFiltro] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ campo: Ordem; desc: boolean }>({ campo: "referencia", desc: true });
  const [historico, setHistorico] = useState(false);
  const [modo, setModo] = useState<ModoValor>("valor");
  const [ordemAno, setOrdemAno] = useState<{ campo: CampoOrdemCategorias | null; desc: boolean }>({
    campo: null,
    desc: false,
  });
  const [aberto, setAberto] = useState<number | null>(null);
  const [todos, setTodos] = useState(false);
  const [clienteModal, setClienteModal] = useState<number | null>(null);

  const porCodigo = useMemo(() => new Map(categorias.map((c) => [c.codigo, c])), [categorias]);
  const indicePorChave = useMemo(() => new Map(meses.map((m, i) => [m.chave, i])), [meses]);

  // Com filtro de categoria ativo, os valores do cliente precisam ser só da(s)
  // categoria(s) filtrada(s) — sem isso, a linha mostra o cliente na lista
  // certa (tem a categoria) mas soma o faturamento dele inteiro, de todas as
  // categorias, inflando total muito acima do que a categoria filtrada bate.
  const valorFiltrado = (c: ClienteFaturamento, campo: "anterior" | "referencia") => {
    if (filtro.size === 0) return c[campo];
    return c.categorias.reduce((s, cat) => (filtro.has(cat.codigo) ? s + cat[campo] : s), 0);
  };
  const serieFiltrada = (c: ClienteFaturamento): number[] => {
    if (filtro.size === 0) return c.serie;
    return meses.map((_, iMes) =>
      categorias.reduce((s, cat, iCat) => (filtro.has(cat.codigo) ? s + c.serieCategorias[iMes][iCat] : s), 0),
    );
  };

  const filtrados = useMemo(() => {
    const buscaNormalizada = busca.trim().toLowerCase();
    return clientes.filter(
      (c) =>
        (filtro.size === 0 || c.categorias.some((cat) => filtro.has(cat.codigo))) &&
        (buscaNormalizada === "" || c.nome.toLowerCase().includes(buscaNormalizada)),
    );
  }, [clientes, filtro, busca]);

  const visiveis = useMemo(() => {
    const valor = (c: ClienteFaturamento) => {
      switch (ordem.campo) {
        case "nome":
          return c.nome;
        case "anterior":
          return valorFiltrado(c, "anterior");
        case "referencia":
          return valorFiltrado(c, "referencia");
        case "variacao":
          return valorFiltrado(c, "referencia") - valorFiltrado(c, "anterior");
        case "percentual":
          return (
            variacaoPercentual(valorFiltrado(c, "anterior"), valorFiltrado(c, "referencia")) ??
            Number.NEGATIVE_INFINITY
          );
      }
    };
    return [...filtrados].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const comparacao =
        typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : (va as number) - (vb as number);
      return ordem.desc ? -comparacao : comparacao;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, ordem, filtro]);

  const linhasAno = useMemo(() => {
    const base = filtrados.map((cliente) => {
      const serie = serieFiltrada(cliente);
      return {
        cliente,
        celulas: serie.map((_, i) => celulaModo(serie, i, modo)),
        total: totalModo(serie, modo),
      };
    });
    const campo = ordemAno.campo;
    if (campo === null) return base;
    const valor = (linha: (typeof base)[number]) => {
      if (campo === "nome") return linha.cliente.nome;
      if (campo === "total") return linha.total ?? Number.NEGATIVE_INFINITY;
      return linha.celulas[indicePorChave.get(campo)!] ?? Number.NEGATIVE_INFINITY;
    };
    return [...base].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const comparacao =
        typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : (va as number) - (vb as number);
      return ordemAno.desc ? -comparacao : comparacao;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, modo, ordemAno, indicePorChave, filtro]);

  const totalVisiveis = historico ? linhasAno.length : visiveis.length;

  // Linha aberta conta como intenção de ver aquele cliente: se ela está fora
  // do corte, não some da tela ao recolher a lista.
  const exibidos = todos ? visiveis : visiveis.filter((c, i) => i < LIMITE_CLIENTES || c.codigo === aberto);
  const exibidosAno = todos
    ? linhasAno
    : linhasAno.filter((l, i) => i < LIMITE_CLIENTES || l.cliente.codigo === aberto);

  const totalAnterior = visiveis.reduce((s, c) => s + valorFiltrado(c, "anterior"), 0);
  const totalReferencia = visiveis.reduce((s, c) => s + valorFiltrado(c, "referencia"), 0);
  const totalGeralPorColuna = meses.map((_, iMes) => filtrados.reduce((s, c) => s + serieFiltrada(c)[iMes], 0));
  const totalGeralCelulas = totalGeralPorColuna.map((_, i) => celulaModo(totalGeralPorColuna, i, modo));
  const totalGeralTotal = totalModo(totalGeralPorColuna, modo);

  function alternarFiltro(codigo: string) {
    setFiltro((atual) => {
      const novo = new Set(atual);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  }

  function exportar() {
    if (historico) {
      exportarCsv(`faturamento-por-cliente-${meses[0]?.chave}-a-${meses.at(-1)?.chave}.csv`, [
        ["Cliente", ...meses.map((m) => m.rotulo), "Total"],
        ...linhasAno.map((linha) => [
          linha.cliente.nome,
          ...linha.celulas.map((v) => formatarCelula(v, modo)),
          formatarCelula(linha.total, modo),
        ]),
      ]);
      return;
    }
    exportarCsv(`faturamento-por-cliente-${referencia.chave}.csv`, [
      ["Cliente", anterior.rotulo, referencia.rotulo, "Var. R$", "Var. %"],
      ...visiveis.map((c) => {
        const va = valorFiltrado(c, "anterior");
        const vr = valorFiltrado(c, "referencia");
        return [
          c.nome,
          brlInteiro.format(va),
          brlInteiro.format(vr),
          variacaoReais(vr - va),
          va === 0 ? "novo" : formatarPercentual(variacaoPercentual(va, vr)),
        ];
      }),
    ]);
  }

  const clienteModalAtual = clienteModal !== null ? (clientes.find((c) => c.codigo === clienteModal) ?? null) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SeletorCategorias
          categorias={categorias}
          filtro={filtro}
          onAlternar={alternarFiltro}
          onLimpar={() => setFiltro(new Set())}
        />
        <SeletorMesCompacto meses={mesesReferencia} atual={referencia.chave} />
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente..."
          className="h-8 w-full max-w-[220px] rounded-md border border-border bg-surface px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="whitespace-nowrap text-xs tabular-nums text-fg-subtle" aria-live="polite">
          {numero.format(historico ? exibidosAno.length : exibidos.length)} de {numero.format(totalVisiveis)} clientes
          {totalVisiveis === clientes.length ? "" : ` (${numero.format(clientes.length)} no total)`}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportar} className="text-xs">
            <IconDownload className="size-4" />
            Exportar Excel
          </Button>
          <Button variant="secondary" onClick={() => setHistorico((v) => !v)} className="text-xs">
            {historico ? `Ver ${anterior.rotulo} → ${referencia.rotulo}` : "Ver ano inteiro"}
            <IconChevron className={clsx("size-4 transition-transform", historico ? "-rotate-90" : "rotate-90")} />
          </Button>
        </div>
      </div>

      {historico ? (
        <div
          role="tablist"
          aria-label="O que exibir na tabela"
          className="flex w-fit gap-1 rounded-md border border-border bg-surface-muted p-1"
        >
          {ABAS_MODO.map((aba) => (
            <button
              key={aba.id}
              type="button"
              role="tab"
              aria-selected={modo === aba.id}
              onClick={() => setModo(aba.id)}
              className={clsx(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                modo === aba.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {aba.rotulo}
            </button>
          ))}
        </div>
      ) : null}

      {/* Só rolagem horizontal: uma caixa com rolagem vertical própria prende
          a roda do mouse e faz a página parecer que não anda. O tamanho é
          controlado pelo número de linhas, não por uma altura máxima. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        {historico ? (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <Cabecalho ordem={ordemAno} setOrdem={setOrdemAno} campo="nome">
                  Cliente
                </Cabecalho>
                <th
                  scope="col"
                  className="border-b border-border bg-surface-muted px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle"
                >
                  Categorias
                </th>
                {meses.map((mes) => (
                  <Cabecalho key={mes.chave} ordem={ordemAno} setOrdem={setOrdemAno} campo={mes.chave} direita>
                    {mes.rotuloCurto}
                  </Cabecalho>
                ))}
                <Cabecalho ordem={ordemAno} setOrdem={setOrdemAno} campo="total" direita>
                  Total
                </Cabecalho>
              </tr>
            </thead>
            <tbody>
              {exibidosAno.map(({ cliente, celulas, total }) => {
                const expandido = aberto === cliente.codigo;
                return (
                  <Fragment key={cliente.codigo}>
                    <tr
                      className={clsx(
                        "cursor-pointer border-b border-border hover:bg-surface-muted/50",
                        expandido && "bg-surface-muted/50",
                      )}
                      onClick={() => setAberto(expandido ? null : cliente.codigo)}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={expandido}
                          className="flex items-center gap-2 text-left font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAberto(expandido ? null : cliente.codigo);
                          }}
                        >
                          <IconChevron
                            className={clsx(
                              "size-4 shrink-0 text-fg-subtle transition-transform",
                              expandido ? "rotate-90" : "",
                            )}
                          />
                          {cliente.nome}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex gap-1">
                          {cliente.categorias.map((cat) => {
                            const categoria = porCodigo.get(cat.codigo)!;
                            return (
                              <span
                                key={cat.codigo}
                                title={categoria.descricao}
                                className={clsx("size-2 rounded-full", FUNDO_CATEGORIA[categoria.slot])}
                              />
                            );
                          })}
                        </span>
                      </td>
                      {celulas.map((v, i) => (
                        <td
                          key={meses[i].chave}
                          className={clsx("px-3 py-2 text-right tabular-nums", tomCelula(v, modo))}
                        >
                          {formatarCelula(v, modo)}
                        </td>
                      ))}
                      <td className={clsx("py-2 pl-3 text-right font-semibold tabular-nums", tomCelula(total, modo))}>
                        {formatarCelula(total, modo)}
                      </td>
                    </tr>
                    {expandido ? (
                      <tr className="border-b border-border bg-surface-muted/30">
                        <td colSpan={3 + meses.length} className="px-3 py-3">
                          <DetalheCliente
                            cliente={cliente}
                            categorias={categorias}
                            meses={meses}
                            onVerAnoCompleto={() => setClienteModal(cliente.codigo)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {exibidosAno.length === 0 ? (
                <tr>
                  <td colSpan={3 + meses.length} className="px-3 py-8 text-center text-sm text-fg-subtle">
                    Nenhum cliente com esse filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2} className="border-t border-border-strong bg-surface px-3 py-2.5">
                  Total filtrado ({numero.format(totalVisiveis)} clientes)
                </td>
                {totalGeralCelulas.map((v, i) => (
                  <td
                    key={meses[i].chave}
                    className={clsx(
                      "border-t border-border-strong bg-surface px-3 py-2.5 text-right tabular-nums",
                      tomCelula(v, modo),
                    )}
                  >
                    {formatarCelula(v, modo)}
                  </td>
                ))}
                <td
                  className={clsx(
                    "border-t border-border-strong bg-surface px-3 py-2.5 text-right tabular-nums",
                    tomCelula(totalGeralTotal, modo),
                  )}
                >
                  {formatarCelula(totalGeralTotal, modo)}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <Cabecalho ordem={ordem} setOrdem={setOrdem} campo="nome">Cliente</Cabecalho>
                <th
                  scope="col"
                  className="border-b border-border bg-surface-muted px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle"
                >
                  Categorias
                </th>
                <Cabecalho ordem={ordem} setOrdem={setOrdem} campo="anterior" direita>
                  {anterior.rotulo}
                </Cabecalho>
                <Cabecalho ordem={ordem} setOrdem={setOrdem} campo="referencia" direita>
                  {referencia.rotulo}
                </Cabecalho>
                <Cabecalho ordem={ordem} setOrdem={setOrdem} campo="variacao" direita>
                  Var. R$
                </Cabecalho>
                <Cabecalho ordem={ordem} setOrdem={setOrdem} campo="percentual" direita>
                  Var. %
                </Cabecalho>
              </tr>
            </thead>
            <tbody>
              {exibidos.map((cliente) => {
                const va = valorFiltrado(cliente, "anterior");
                const vr = valorFiltrado(cliente, "referencia");
                const diferenca = vr - va;
                const expandido = aberto === cliente.codigo;
                return (
                  <Fragment key={cliente.codigo}>
                    <tr
                      className={clsx(
                        "cursor-pointer border-b border-border hover:bg-surface-muted/50",
                        expandido && "bg-surface-muted/50",
                      )}
                      onClick={() => setAberto(expandido ? null : cliente.codigo)}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={expandido}
                          className="flex items-center gap-2 text-left font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAberto(expandido ? null : cliente.codigo);
                          }}
                        >
                          <IconChevron
                            className={clsx(
                              "size-4 shrink-0 text-fg-subtle transition-transform",
                              expandido ? "rotate-90" : "",
                            )}
                          />
                          {cliente.nome}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex gap-1">
                          {cliente.categorias.map((cat) => {
                            const categoria = porCodigo.get(cat.codigo)!;
                            return (
                              <span
                                key={cat.codigo}
                                title={categoria.descricao}
                                className={clsx("size-2 rounded-full", FUNDO_CATEGORIA[categoria.slot])}
                              />
                            );
                          })}
                          <span className="sr-only">
                            {cliente.categorias.map((cat) => porCodigo.get(cat.codigo)!.descricao).join(", ")}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                        {brlInteiro.format(va)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {brlInteiro.format(vr)}
                      </td>
                      <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(diferenca))}>
                        {variacaoReais(diferenca)}
                      </td>
                      <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(diferenca))}>
                        {va === 0 ? "novo" : formatarPercentual(variacaoPercentual(va, vr))}
                      </td>
                    </tr>
                    {expandido ? (
                      <tr className="border-b border-border bg-surface-muted/30">
                        <td colSpan={6} className="px-3 py-3">
                          <DetalheCliente
                            cliente={cliente}
                            categorias={categorias}
                            meses={meses}
                            onVerAnoCompleto={() => setClienteModal(cliente.codigo)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {exibidos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-fg-subtle">
                    Nenhum cliente com esse filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={2}
                  className="border-t border-border-strong bg-surface px-3 py-2.5 font-semibold"
                >
                  Total filtrado ({numero.format(visiveis.length)} clientes)
                </td>
                <td className="border-t border-border-strong bg-surface px-3 py-2.5 text-right font-semibold tabular-nums">
                  {brlInteiro.format(totalAnterior)}
                </td>
                <td className="border-t border-border-strong bg-surface px-3 py-2.5 text-right font-semibold tabular-nums">
                  {brlInteiro.format(totalReferencia)}
                </td>
                <td
                  className={clsx(
                    "border-t border-border-strong bg-surface px-3 py-2.5 text-right font-semibold tabular-nums",
                    tomVariacao(totalReferencia - totalAnterior),
                  )}
                >
                  {variacaoReais(totalReferencia - totalAnterior)}
                </td>
                <td
                  className={clsx(
                    "border-t border-border-strong bg-surface px-3 py-2.5 text-right font-semibold tabular-nums",
                    tomVariacao(totalReferencia - totalAnterior),
                  )}
                >
                  {formatarPercentual(variacaoPercentual(totalAnterior, totalReferencia))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {totalVisiveis > LIMITE_CLIENTES ? (
        <Button variant="secondary" onClick={() => setTodos((v) => !v)} className="self-start">
          {todos ? `Mostrar só os ${LIMITE_CLIENTES} maiores` : `Ver todos (${numero.format(totalVisiveis)})`}
        </Button>
      ) : null}

      {clienteModalAtual ? (
        <ModalHistoricoCliente
          cliente={clienteModalAtual}
          categorias={categorias}
          meses={meses}
          onFechar={() => setClienteModal(null)}
        />
      ) : null}
    </div>
  );
}

function Cabecalho<C extends string>({
  campo,
  children,
  direita,
  ordem,
  setOrdem,
}: {
  campo: C;
  children: React.ReactNode;
  direita?: boolean;
  ordem: { campo: C | null; desc: boolean };
  setOrdem: (ordem: { campo: C; desc: boolean }) => void;
}) {
  const ativo = ordem.campo === campo;
  return (
    <th
      scope="col"
      aria-sort={ativo ? (ordem.desc ? "descending" : "ascending") : "none"}
      className={clsx(
        "border-b border-border bg-surface-muted px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-fg-subtle",
        direita ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={() => setOrdem({ campo, desc: ativo ? !ordem.desc : campo !== "nome" })}
        className={clsx("inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg", ativo && "text-fg")}
      >
        {children}
        {ativo ? <span aria-hidden="true">{ordem.desc ? "▼" : "▲"}</span> : null}
      </button>
    </th>
  );
}

/** Total anual por categoria deste cliente, só as que faturaram alguma coisa no ano. */
function categoriasDoAno(cliente: ClienteFaturamento, categorias: CategoriaFaturamento[], meses: Mes[]) {
  return categorias
    .map((categoria, iCat) => ({
      categoria,
      iCat,
      total: meses.reduce((s, _m, iMes) => s + cliente.serieCategorias[iMes][iCat], 0),
    }))
    .filter((c) => c.total > 0);
}

/** Barras mensais simples (uma série, sem empilhamento) — o "por mês" do ano inteiro. */
function BarrasMensaisSimples({ meses, valores }: { meses: Mes[]; valores: number[] }) {
  const max = Math.max(...valores, 1);
  return (
    <div className="space-y-1">
      <div className="flex h-16 items-end gap-1">
        {meses.map((mes, i) => (
          <div
            key={mes.chave}
            title={`${mes.rotulo}${mes.parcial ? " (parcial)" : ""} · ${brlInteiro.format(valores[i])}`}
            className={clsx("min-w-0 flex-1 rounded-t-sm bg-cat-1", mes.parcial && "opacity-50")}
            style={{ height: `${Math.max((valores[i] / max) * 100, 2)}%` }}
          />
        ))}
      </div>
      <div className="flex text-[9px] text-fg-subtle">
        {meses.map((mes, i) => (
          <span key={mes.chave} className="min-w-0 flex-1 text-center">
            <span className={clsx(i % 2 === 1 && "hidden sm:inline")}>{mes.rotuloCurto}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Prévia ao expandir uma linha de cliente: total do ano por categoria (barras
 * de proporção) e faturamento mês a mês, com atalho para o modal completo.
 */
function DetalheCliente({
  cliente,
  categorias,
  meses,
  onVerAnoCompleto,
}: {
  cliente: ClienteFaturamento;
  categorias: CategoriaFaturamento[];
  meses: Mes[];
  onVerAnoCompleto: () => void;
}) {
  const porCategoria = useMemo(
    () => categoriasDoAno(cliente, categorias, meses).sort((a, b) => b.total - a.total),
    [cliente, categorias, meses],
  );
  const maiorTotal = Math.max(...porCategoria.map((c) => c.total), 1);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Por categoria (ano)</p>
          <div className="space-y-1.5">
            {porCategoria.map(({ categoria, total }) => (
              <div key={categoria.codigo} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 truncate text-fg-muted">{categoria.descricao}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={clsx("h-full rounded-full", FUNDO_CATEGORIA[categoria.slot])}
                    style={{ width: `${(total / maiorTotal) * 100}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right tabular-nums">{brlInteiro.format(total)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Faturamento por mês ({meses[0]?.rotuloCurto}–{meses.at(-1)?.rotuloCurto}/{meses.at(-1)?.chave.slice(2, 4)})
          </p>
          <BarrasMensaisSimples meses={meses} valores={cliente.serie} />
        </div>
      </div>
      <Button variant="secondary" onClick={onVerAnoCompleto} className="text-xs">
        <IconExterno className="size-4" />
        Ver ano completo, mês a mês
      </Button>
    </div>
  );
}

/** Modal com o detalhe anual completo de um cliente: mês a mês e por categoria. */
function ModalHistoricoCliente({
  cliente,
  categorias,
  meses,
  onFechar,
}: {
  cliente: ClienteFaturamento;
  categorias: CategoriaFaturamento[];
  meses: Mes[];
  onFechar: () => void;
}) {
  const totalAno = cliente.serie.reduce((s, v) => s + v, 0);
  const porCategoria = useMemo(() => categoriasDoAno(cliente, categorias, meses), [cliente, categorias, meses]);

  function exportar() {
    exportarCsv(`faturamento-${cliente.codigo}-${meses.at(-1)?.chave.slice(0, 4)}.csv`, [
      ["Mês", "Faturamento", "Var. R$", "Var. %"],
      ...meses.map((mes, i) => [
        `${mes.rotulo}${mes.parcial ? " (parcial)" : ""}`,
        formatarCelula(cliente.serie[i], "valor"),
        formatarCelula(celulaModo(cliente.serie, i, "reais"), "reais"),
        formatarCelula(celulaModo(cliente.serie, i, "percentual"), "percentual"),
      ]),
      ["Total no ano", formatarCelula(totalAno, "valor"), "", ""],
      [],
      ["Categoria", ...meses.map((m) => m.rotulo)],
      ...porCategoria.map(({ categoria, iCat }) => [
        categoria.descricao,
        ...meses.map((_, iMes) => formatarCelula(cliente.serieCategorias[iMes][iCat], "valor")),
      ]),
    ]);
  }

  return (
    <Modal
      titulo={cliente.nome}
      descricao={`Faturamento por cliente · Ano completo · Total: ${brlInteiro.format(totalAno)}`}
      largura="xl"
      onFechar={onFechar}
    >
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-4">
          {porCategoria.map(({ categoria }) => (
            <span key={categoria.codigo} className="inline-flex items-center gap-2 text-xs text-fg-muted">
              <span aria-hidden="true" className={clsx("size-2.5 rounded-[3px]", FUNDO_CATEGORIA[categoria.slot])} />
              {categoria.descricao}
            </span>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Faturamento mensal e variação</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-subtle">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">Mês</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Faturamento</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Var. R$</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Var. %</th>
                </tr>
              </thead>
              <tbody>
                {meses.map((mes, i) => {
                  const reais = celulaModo(cliente.serie, i, "reais");
                  const pct = celulaModo(cliente.serie, i, "percentual");
                  return (
                    <tr key={mes.chave} className="border-b border-border">
                      <td className="whitespace-nowrap py-2 pr-3">
                        {mes.rotulo}
                        {mes.parcial ? " (parcial)" : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatarCelula(cliente.serie[i], "valor")}</td>
                      <td className={clsx("px-3 py-2 text-right tabular-nums", tomCelula(reais, "reais"))}>
                        {formatarCelula(reais, "reais")}
                      </td>
                      <td className={clsx("py-2 pl-3 text-right tabular-nums", tomCelula(pct, "percentual"))}>
                        {formatarCelula(pct, "percentual")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Total no ano</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brlInteiro.format(totalAno)}</td>
                  <td className="px-3 py-2" />
                  <td className="py-2 pl-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Por categoria, mês a mês</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-subtle">
                  <th scope="col" className="whitespace-nowrap py-2 pr-3 text-left font-medium">Categoria</th>
                  {meses.map((mes) => (
                    <th key={mes.chave} scope="col" className="px-3 py-2 text-right font-medium">
                      {mes.rotuloCurto}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porCategoria.map(({ categoria, iCat }) => (
                  <tr key={categoria.codigo} className="border-b border-border">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={clsx("size-2.5 shrink-0 rounded-[3px]", FUNDO_CATEGORIA[categoria.slot])}
                        />
                        {categoria.descricao}
                      </span>
                    </td>
                    {meses.map((mes, iMes) => (
                      <td key={mes.chave} className="px-3 py-2 text-right tabular-nums">
                        {formatarCelula(cliente.serieCategorias[iMes][iCat], "valor")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Button variant="secondary" onClick={exportar} className="text-xs">
          <IconDownload className="size-4" />
          Exportar Excel
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------- Movimentação ----------------------------- */

/** Rótulo curto da situação do contrato no Omie, pra linha de churn. */
const ROTULO_SITUACAO_CONTRATO: Record<MovimentoCliente["situacaoContrato"], string> = {
  cancelado: "Cancelado",
  suspenso: "Suspenso",
  ativo: "Revisar",
  "sem-contrato": "Sem contrato",
};

const LIMITE_MOVIMENTOS = 8;

export function ListaMovimentos({
  titulo,
  itens,
  tipo,
}: {
  titulo: string;
  itens: MovimentoCliente[];
  tipo: "entrada" | "saida";
}) {
  const [todos, setTodos] = useState(false);
  const exibidos = todos ? itens : itens.slice(0, LIMITE_MOVIMENTOS);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className={clsx("size-2.5 rounded-[3px]", tipo === "entrada" ? "bg-success" : "bg-danger")}
        />
        {titulo}
        <span className="font-normal text-fg-subtle">
          — {todos || itens.length <= LIMITE_MOVIMENTOS ? numero.format(itens.length) : `top ${LIMITE_MOVIMENTOS} de ${numero.format(itens.length)}`}
        </span>
      </h3>
      {itens.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-fg-subtle">
          Nenhum cliente no período.
        </p>
      ) : (
        // Sem `overflow-auto` quando expandida: uma segunda área de rolagem
        // prende a roda do mouse e faz a página parecer que não anda.
        <ul className="divide-y divide-border rounded-md border border-border">
          {exibidos.map((item) => (
            <li key={item.codigo} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.nome}</p>
                <p className="truncate text-xs text-fg-subtle">
                  {item.categoria}
                  {tipo === "saida" ? ` · ${ROTULO_SITUACAO_CONTRATO[item.situacaoContrato]}` : ""}
                </p>
              </div>
              <span
                className={clsx(
                  "shrink-0 text-sm font-medium tabular-nums",
                  tipo === "entrada" ? "text-success" : "text-danger",
                )}
              >
                {tipo === "entrada" ? "+" : "−"}
                {brlInteiro.format(item.mrr)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {itens.length > LIMITE_MOVIMENTOS ? (
        <Button variant="secondary" onClick={() => setTodos((v) => !v)}>
          {todos ? "Mostrar só os principais" : `Ver todos (${numero.format(itens.length)})`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Churn bruto (saída de faturamento) mês a mês, cruzado com o status do
 * contrato no Omie — só "confirmado" (cancelado lá) é churn de fato;
 * "suspenso"/"ativo" ainda podem ser reativação ou gap de faturamento que
 * ninguém percebeu. Mesmo padrão de `TabelaHistoricoMrr`: mais recente
 * primeiro, 4 meses por padrão, "Ver mais" pro resto.
 */
export function TabelaChurnMensal({ historico }: { historico: MovimentoMensal[] }) {
  const [todos, setTodos] = useState(false);
  const restantes = historico.length - LIMITE_MESES_HISTORICO;
  const decrescente = [...historico].reverse();
  const exibidos = todos || restantes <= 0 ? decrescente : decrescente.slice(0, LIMITE_MESES_HISTORICO);

  const celula = (grupo: { qtd: number; mrr: number } | undefined) =>
    grupo === undefined || grupo.qtd === 0 ? "—" : `${numero.format(grupo.qtd)} · ${brlInteiro.format(grupo.mrr)}`;

  function exportar() {
    exportarCsv(`churn-mensal-${historico[0]?.mes.chave}-a-${historico.at(-1)?.mes.chave}.csv`, [
      [
        "Mês",
        "Confirmado (contrato cancelado)",
        "Suspenso — aguardando liberação",
        "Contrato ativo — revisar gap",
        "Sem contrato cadastrado",
      ],
      ...historico.map((m) => [
        `${m.mes.rotulo}${m.mes.parcial ? " (parcial)" : ""}`,
        m.churn === null ? "—" : celula(m.churn.confirmado),
        m.churn === null ? "—" : celula(m.churn.suspenso),
        m.churn === null ? "—" : celula(m.churn.ativoRevisar),
        m.churn === null ? "—" : celula(m.churn.semContrato),
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">Mês</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Confirmado (contrato cancelado)</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Suspenso — aguardando liberação</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Contrato ativo — revisar gap</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Sem contrato cadastrado</th>
            </tr>
          </thead>
          <tbody>
            {exibidos.map((m) => (
              <tr key={m.mes.chave} className="border-b border-border">
                <td className="whitespace-nowrap px-3 py-2">
                  {m.mes.rotulo}
                  {m.mes.parcial ? " (parcial)" : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-danger">
                  {m.churn === null ? "—" : celula(m.churn.confirmado)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-warning">
                  {m.churn === null ? "—" : celula(m.churn.suspenso)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-warning">
                  {m.churn === null ? "—" : celula(m.churn.ativoRevisar)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {m.churn === null ? "—" : celula(m.churn.semContrato)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">
        “Sem contrato cadastrado” é cliente que saiu de faturar sem ter contrato de serviço no Omie — não dá pra
        saber se cancelou, e por isso também conta no Churn da tabela de Movimentação.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={exportar} className="text-xs">
          <IconDownload className="size-4" />
          Exportar Excel
        </Button>
        {restantes > 0 ? (
          <Button variant="secondary" onClick={() => setTodos((v) => !v)} className="text-xs">
            {todos ? `Mostrar só os últimos ${LIMITE_MESES_HISTORICO}` : `Ver mais ${numero.format(restantes)} meses`}
            <IconChevron className={clsx("size-4 transition-transform", todos ? "-rotate-90" : "rotate-90")} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Contrato ativo ou suspenso no Omie, mas sem faturamento recorrente no mês
 * de referência — alerta, não confirma cancelamento: por isso o tom é
 * "warning", nem verde de entrada nem vermelho de saída confirmada.
 */
export function ListaSemFaturamento({ itens }: { itens: ClienteSemFaturamento[] }) {
  const [todos, setTodos] = useState(false);
  const exibidos = todos ? itens : itens.slice(0, LIMITE_MOVIMENTOS);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-warning" />
        Contrato Suspenso/Ativo sem faturamento
        <span className="font-normal text-fg-subtle">
          — {todos || itens.length <= LIMITE_MOVIMENTOS ? numero.format(itens.length) : `top ${LIMITE_MOVIMENTOS} de ${numero.format(itens.length)}`}
        </span>
      </h3>
      {itens.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-fg-subtle">
          Nenhum contrato suspenso ou ativo sem faturamento neste mês.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {exibidos.map((item) => (
            <li key={item.codigo} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.nome}</p>
                <p className="truncate text-xs text-fg-subtle">
                  {item.situacaoContrato === "suspenso" ? "suspenso" : "ativo"} ·{" "}
                  {item.ultimaCategoria === null
                    ? "nunca faturou"
                    : `${item.mesesSemFaturar === 1 ? "1 mês" : `${numero.format(item.mesesSemFaturar!)} meses`} sem faturar · última: ${item.ultimaCategoria}`}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums text-warning">
                {item.ultimoValor === null ? "—" : brlInteiro.format(item.ultimoValor)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {itens.length > LIMITE_MOVIMENTOS ? (
        <Button variant="secondary" onClick={() => setTodos((v) => !v)}>
          {todos ? "Mostrar só os principais" : `Ver todos (${numero.format(itens.length)})`}
        </Button>
      ) : null}
    </div>
  );
}

/** Exporta as três listas do card de Movimentação (novos, churn, sem faturamento) num único CSV. */
export function BotaoExportarMovimentacao({
  novos,
  saidas,
  naoFaturados,
  referencia,
  anterior,
}: {
  novos: MovimentoCliente[];
  saidas: MovimentoCliente[];
  naoFaturados: ClienteSemFaturamento[];
  referencia: Mes;
  anterior: Mes;
}) {
  function exportar() {
    exportarCsv(`movimentacao-${anterior.chave}-a-${referencia.chave}.csv`, [
      [`Novos clientes — ${anterior.rotulo} → ${referencia.rotulo}`],
      ["Cliente", "Categoria", "MRR"],
      ...novos.map((c) => [c.nome, c.categoria, brlInteiro.format(c.mrr)]),
      [],
      [`Churn — ${anterior.rotulo} → ${referencia.rotulo}`],
      ["Cliente", "Categoria", "MRR"],
      ...saidas.map((c) => [c.nome, c.categoria, brlInteiro.format(c.mrr)]),
      [],
      [`Contrato Suspenso/Ativo sem faturamento — ${referencia.rotulo}`],
      ["Cliente", "Situação", "Última categoria", "Último valor", "Meses sem faturar"],
      ...naoFaturados.map((c) => [
        c.nome,
        c.situacaoContrato,
        c.ultimaCategoria ?? "nunca faturou",
        c.ultimoValor === null ? "—" : brlInteiro.format(c.ultimoValor),
        c.mesesSemFaturar === null ? "—" : numero.format(c.mesesSemFaturar),
      ]),
    ]);
  }

  return (
    <Button variant="secondary" onClick={exportar} className="text-xs">
      <IconDownload className="size-4" />
      Exportar Excel
    </Button>
  );
}

/* ------------------------- Histórico de recorrência ------------------------ */

/** Quantos meses a tabela mostra antes do "Ver mais". */
const LIMITE_MESES_HISTORICO = 4;

/** Movimentação mensal (saldo, novos, churn, MRR) do ano inteiro — sempre visível, sem modal. */
export function TabelaHistoricoMrr({ historico }: { historico: MovimentoMensal[] }) {
  const [todos, setTodos] = useState(false);
  const restantes = historico.length - LIMITE_MESES_HISTORICO;
  // Na tela, do mês atual para o mais antigo — o extrato começa pelo agora.
  const decrescente = [...historico].reverse();
  const exibidos = todos || restantes <= 0 ? decrescente : decrescente.slice(0, LIMITE_MESES_HISTORICO);

  function exportar() {
    exportarCsv(`movimentacao-recorrencia-${historico[0]?.mes.chave}-a-${historico.at(-1)?.mes.chave}.csv`, [
      ["Mês", "Saldo inicial", "Novos", "Churn (clientes)", "Saldo", "Saldo final", "Novo MRR", "Churn R$", "Líquido"],
      ...historico.map((m) => {
        const liquidoClientes = m.novos === null || m.saidas === null ? null : m.novos - m.saidas;
        return [
          `${m.mes.rotulo}${m.mes.parcial ? " (parcial)" : ""}`,
          m.saldoInicial === null ? "—" : numero.format(m.saldoInicial),
          m.novos === null ? "—" : `+${numero.format(m.novos)}`,
          m.saidas === null ? "—" : `−${numero.format(m.saidas)}`,
          liquidoClientes === null ? "—" : `${liquidoClientes > 0 ? "+" : ""}${numero.format(liquidoClientes)}`,
          numero.format(m.saldoFinal),
          m.mrrGanho === null ? "—" : `+${brlInteiro.format(m.mrrGanho)}`,
          m.mrrPerdido === null ? "—" : `−${brlInteiro.format(m.mrrPerdido)}`,
          m.liquido === null ? "—" : variacaoReais(m.liquido),
        ];
      }),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">Mês</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Saldo inicial</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Novos</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Churn</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Saldo</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Saldo final</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Novo MRR</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Churn R$</th>
              <th scope="col" className="border-b border-border bg-surface-muted px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-fg-subtle">Líquido</th>
            </tr>
          </thead>
          <tbody>
            {exibidos.map((m) => {
              const liquidoClientes = m.novos === null || m.saidas === null ? null : m.novos - m.saidas;
              return (
                <tr key={m.mes.chave} className="border-b border-border">
                  <td className="whitespace-nowrap px-3 py-2">
                    {m.mes.rotulo}
                    {m.mes.parcial ? " (parcial)" : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {m.saldoInicial === null ? "—" : numero.format(m.saldoInicial)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-success">
                    {m.novos === null ? "—" : `+${numero.format(m.novos)}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">
                    {m.saidas === null ? "—" : `−${numero.format(m.saidas)}`}
                  </td>
                  <td
                    className={clsx(
                      "px-3 py-2 text-right font-semibold tabular-nums",
                      liquidoClientes === null ? "" : tomVariacao(liquidoClientes),
                    )}
                  >
                    {liquidoClientes === null
                      ? "—"
                      : `${liquidoClientes > 0 ? "+" : ""}${numero.format(liquidoClientes)}`}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {numero.format(m.saldoFinal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-success">
                    {m.mrrGanho === null ? "—" : `+${brlInteiro.format(m.mrrGanho)}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">
                    {m.mrrPerdido === null ? "—" : `−${brlInteiro.format(m.mrrPerdido)}`}
                  </td>
                  <td
                    className={clsx(
                      "px-3 py-2 text-right font-semibold tabular-nums",
                      m.liquido === null ? "" : tomVariacao(m.liquido),
                    )}
                  >
                    {m.liquido === null ? "—" : variacaoReais(m.liquido)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={exportar} className="text-xs">
          <IconDownload className="size-4" />
          Exportar Excel
        </Button>
        {restantes > 0 ? (
          <Button variant="secondary" onClick={() => setTodos((v) => !v)} className="text-xs">
            {todos ? `Mostrar só os últimos ${LIMITE_MESES_HISTORICO}` : `Ver mais ${numero.format(restantes)} meses`}
            <IconChevron className={clsx("size-4 transition-transform", todos ? "-rotate-90" : "rotate-90")} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
