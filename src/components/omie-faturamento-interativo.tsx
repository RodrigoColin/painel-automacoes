"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { Sparkline } from "@/components/charts";
import { IconChevron } from "@/components/icons";
import { Button } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import type {
  CategoriaFaturamento,
  ClienteFaturamento,
  Mes,
  MovimentoCliente,
} from "@/lib/omie/faturamento";
import {
  brl,
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
            {mes.rotulo} (vs. {lista[i + 1]?.rotulo ?? "mês anterior"})
          </option>
        ))}
      </select>
      <span className="text-xs text-fg-subtle">variação sempre contra o mês anterior</span>
    </label>
  );
}

/* --------------------------- Faturamento por cliente ---------------------- */

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
  referencia,
  anterior,
}: {
  clientes: ClienteFaturamento[];
  categorias: CategoriaFaturamento[];
  meses: Mes[];
  referencia: Mes;
  anterior: Mes;
}) {
  const [filtro, setFiltro] = useState<Set<string>>(new Set());
  const [ordem, setOrdem] = useState<{ campo: Ordem; desc: boolean }>({ campo: "referencia", desc: true });
  const [aberto, setAberto] = useState<number | null>(null);
  const [todos, setTodos] = useState(false);

  const porCodigo = useMemo(() => new Map(categorias.map((c) => [c.codigo, c])), [categorias]);

  const visiveis = useMemo(() => {
    const lista = clientes.filter(
      (c) => filtro.size === 0 || c.categorias.some((cat) => filtro.has(cat.codigo)),
    );
    const valor = (c: ClienteFaturamento) => {
      switch (ordem.campo) {
        case "nome":
          return c.nome;
        case "anterior":
          return c.anterior;
        case "referencia":
          return c.referencia;
        case "variacao":
          return c.referencia - c.anterior;
        case "percentual":
          return variacaoPercentual(c.anterior, c.referencia) ?? Number.NEGATIVE_INFINITY;
      }
    };
    return [...lista].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const comparacao =
        typeof va === "string" ? va.localeCompare(vb as string, "pt-BR") : (va as number) - (vb as number);
      return ordem.desc ? -comparacao : comparacao;
    });
  }, [clientes, filtro, ordem]);

  // Linha aberta conta como intenção de ver aquele cliente: se ela está fora
  // do corte, não some da tela ao recolher a lista.
  const exibidos = todos
    ? visiveis
    : visiveis.filter((c, i) => i < LIMITE_CLIENTES || c.codigo === aberto);

  const totalAnterior = visiveis.reduce((s, c) => s + c.anterior, 0);
  const totalReferencia = visiveis.reduce((s, c) => s + c.referencia, 0);

  function alternarFiltro(codigo: string) {
    setFiltro((atual) => {
      const novo = new Set(atual);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  }

  return (
    <div className="space-y-3">
      {/* Filtros: uma linha acima da tabela que eles recortam. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoria">
        {categorias.map((categoria) => {
          const ativo = filtro.has(categoria.codigo);
          return (
            <button
              key={categoria.codigo}
              type="button"
              aria-pressed={ativo}
              onClick={() => alternarFiltro(categoria.codigo)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                ativo
                  ? "border-fg bg-surface-muted text-fg"
                  : "border-border-strong text-fg-muted hover:bg-surface-muted hover:text-fg",
              )}
            >
              <span aria-hidden="true" className={clsx("size-2 rounded-full", FUNDO_CATEGORIA[categoria.slot])} />
              {categoria.descricao}
            </button>
          );
        })}
        {filtro.size > 0 ? (
          <button
            type="button"
            onClick={() => setFiltro(new Set())}
            className="px-1 text-xs font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs tabular-nums text-fg-subtle" aria-live="polite">
          {numero.format(exibidos.length)} de {numero.format(visiveis.length)} clientes
          {visiveis.length === clientes.length ? "" : ` (${numero.format(clientes.length)} no total)`}
        </p>
      </div>

      {/* Só rolagem horizontal: uma caixa com rolagem vertical própria prende
          a roda do mouse e faz a página parecer que não anda. O tamanho é
          controlado pelo número de linhas, não por uma altura máxima. */}
      <div className="overflow-x-auto rounded-lg border border-border">
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
              const diferenca = cliente.referencia - cliente.anterior;
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
                      {brlInteiro.format(cliente.anterior)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {brlInteiro.format(cliente.referencia)}
                    </td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(diferenca))}>
                      {variacaoReais(diferenca)}
                    </td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", tomVariacao(diferenca))}>
                      {cliente.anterior === 0 ? "novo" : formatarPercentual(variacaoPercentual(cliente.anterior, cliente.referencia))}
                    </td>
                  </tr>
                  {expandido ? (
                    <tr className="border-b border-border bg-surface-muted/30">
                      <td colSpan={6} className="px-3 py-3">
                        <DetalheCliente
                          cliente={cliente}
                          porCodigo={porCodigo}
                          meses={meses}
                          referencia={referencia}
                          anterior={anterior}
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
      </div>

      {visiveis.length > LIMITE_CLIENTES ? (
        <Button variant="secondary" onClick={() => setTodos((v) => !v)} className="self-start">
          {todos
            ? `Mostrar só os ${LIMITE_CLIENTES} maiores`
            : `Ver todos (${numero.format(visiveis.length)})`}
        </Button>
      ) : null}
    </div>
  );
}

function Cabecalho({
  campo,
  children,
  direita,
  ordem,
  setOrdem,
}: {
  campo: Ordem;
  children: React.ReactNode;
  direita?: boolean;
  ordem: { campo: Ordem; desc: boolean };
  setOrdem: (ordem: { campo: Ordem; desc: boolean }) => void;
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

function DetalheCliente({
  cliente,
  porCodigo,
  meses,
  referencia,
  anterior,
}: {
  cliente: ClienteFaturamento;
  porCodigo: Map<string, CategoriaFaturamento>;
  meses: Mes[];
  referencia: Mes;
  anterior: Mes;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
      <table className="w-full text-xs">
        <caption className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Composição por categoria
        </caption>
        <thead>
          <tr className="text-fg-subtle">
            <th scope="col" className="py-1 text-left font-medium">Categoria</th>
            <th scope="col" className="py-1 text-right font-medium">{anterior.rotulo}</th>
            <th scope="col" className="py-1 text-right font-medium">{referencia.rotulo}</th>
          </tr>
        </thead>
        <tbody>
          {cliente.categorias.map((cat) => {
            const categoria = porCodigo.get(cat.codigo)!;
            return (
              <tr key={cat.codigo} className="border-t border-border">
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={clsx("size-2 rounded-full", FUNDO_CATEGORIA[categoria.slot])} />
                    {categoria.descricao}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-fg-muted">{brl.format(cat.anterior)}</td>
                <td className="py-1.5 text-right tabular-nums">{brl.format(cat.referencia)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Faturamento mês a mês</p>
        <Sparkline valores={cliente.serie} />
        <p className="flex justify-between text-[10px] tabular-nums text-fg-subtle">
          <span>{meses[0]?.rotulo}</span>
          <span>{meses.at(-1)?.rotulo}</span>
        </p>
        <p className="text-xs text-fg-muted">
          Total no período: <span className="font-medium tabular-nums text-fg">{brl.format(cliente.serie.reduce((s, v) => s + v, 0))}</span>
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- Movimentação ----------------------------- */

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
                <p className="truncate text-xs text-fg-subtle">{item.categoria}</p>
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
