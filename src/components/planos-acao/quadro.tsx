"use client";

import { useRef, useState } from "react";
import { Input, Select } from "@/components/form";
import { IconCalendario, IconCheck, IconUsuarios } from "@/components/icons";
import { Badge } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { brl, diaMes } from "@/lib/fluxo-caixa/calculos";
import { ETAPAS, ETAPA_FINAL, type Etapa } from "@/lib/planos-acao/etapas";
import type { Card, Responsavel } from "@/lib/planos-acao/tipos";
import { iniciais } from "@/lib/tipos";

/** O que as pílulas do card alteram sem abrir o modal. */
export type Atribuicao = { responsavelId?: string | null; prazo?: string | null };

type Ordem = "recentes" | "valor" | "atraso" | "prazo" | "titulo";
type Origem = "todas" | Card["origem"];

/** Valores do filtro de responsável que não são um id. */
const TODOS = "";
const MEUS = "__meus";
const SEM = "__sem";

const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "valor", rotulo: "Maior valor vencido" },
  { valor: "atraso", rotulo: "Maior atraso" },
  { valor: "prazo", rotulo: "Prazo mais próximo" },
  { valor: "titulo", rotulo: "Título (A–Z)" },
];

/** Sem o dado, o card vai para o fim — nas duas direções. */
function comparar(ordem: Ordem): (a: Card, b: Card) => number {
  const numero = (campo: "valor" | "dias") => (a: Card, b: Card) =>
    (b.dados[campo] ?? -Infinity) - (a.dados[campo] ?? -Infinity);

  switch (ordem) {
    case "valor":
      return numero("valor");
    case "atraso":
      return numero("dias");
    case "prazo":
      return (a, b) => (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999");
    case "titulo":
      return (a, b) => a.titulo.localeCompare(b.titulo, "pt-BR");
    default:
      return (a, b) => b.criadoEm.localeCompare(a.criadoEm);
  }
}

/**
 * Quadro: filtros no topo e uma coluna por etapa. Filtro e ordenação são só
 * de exibição — vivem aqui e não mudam o que a página carregou.
 */
export function Quadro({
  cards,
  responsaveis,
  userId,
  hoje,
  podeEscrever,
  onAbrir,
  onMover,
  onAtribuir,
}: {
  cards: Card[];
  responsaveis: Responsavel[];
  userId: string;
  hoje: string;
  podeEscrever: boolean;
  onAbrir: (id: string) => void;
  onMover: (cardId: string, etapa: Etapa) => void;
  onAtribuir: (cardId: string, mudanca: Atribuicao) => void;
}) {
  const [busca, setBusca] = useState("");
  const [responsavel, setResponsavel] = useState(TODOS);
  const [origem, setOrigem] = useState<Origem>("todas");
  const [ordem, setOrdem] = useState<Ordem>("recentes");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Etapa | null>(null);

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtrando = Boolean(termo) || responsavel !== TODOS || origem !== "todas";
  const visiveis = cards
    .filter((card) => {
      if (termo && !card.titulo.toLocaleLowerCase("pt-BR").includes(termo)) return false;
      if (origem !== "todas" && card.origem !== origem) return false;
      if (responsavel === MEUS) return card.responsavelId === userId;
      if (responsavel === SEM) return !card.responsavelId;
      return responsavel === TODOS || card.responsavelId === responsavel;
    })
    .sort(comparar(ordem));

  function limpar() {
    setBusca("");
    setResponsavel(TODOS);
    setOrigem("todas");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar card pelo título"
          placeholder="Buscar card…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full sm:w-56"
        />
        <Select
          aria-label="Filtrar por responsável"
          value={responsavel}
          onChange={(e) => setResponsavel(e.target.value)}
          options={[
            { valor: TODOS, rotulo: "Todos os responsáveis" },
            { valor: MEUS, rotulo: "Meus cards" },
            { valor: SEM, rotulo: "Sem responsável" },
            ...responsaveis.map((r) => ({ valor: r.id, rotulo: r.nome })),
          ]}
          className="w-auto max-w-52"
        />
        <Select
          aria-label="Filtrar por origem"
          value={origem}
          onChange={(e) => setOrigem(e.target.value as Origem)}
          options={[
            { valor: "todas", rotulo: "Todas as origens" },
            { valor: "inadimplencia", rotulo: "Inadimplência" },
            { valor: "manual", rotulo: "Criados à mão" },
          ]}
          className="w-auto"
        />
        <Select
          aria-label="Ordenar cards"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value as Ordem)}
          options={ORDENS}
          className="w-auto sm:ml-auto"
        />
      </div>

      {filtrando ? (
        <p className="text-xs text-fg-muted">
          {visiveis.length} de {cards.length} cards.{" "}
          <button type="button" onClick={limpar} className="font-medium text-fg underline underline-offset-2">
            Limpar filtros
          </button>
        </p>
      ) : null}

      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {/* Altura presa à janela: o quadro cabe na tela e cada coluna rola
            sozinha, em vez de a página crescer com a coluna mais longa. */}
        <div className="flex h-[calc(100dvh-20rem)] min-h-96 min-w-max gap-3 pb-2 lg:h-[calc(100dvh-18rem)]">
          {ETAPAS.map((etapa) => {
            const daEtapa = visiveis.filter((card) => card.etapa === etapa.chave);
            return (
              <section
                key={etapa.chave}
                aria-label={etapa.rotulo}
                onDragOver={(evento) => {
                  if (!arrastando) return;
                  evento.preventDefault();
                  setSobre(etapa.chave);
                }}
                onDragLeave={() => setSobre((atual) => (atual === etapa.chave ? null : atual))}
                onDrop={(evento) => {
                  evento.preventDefault();
                  if (arrastando) onMover(arrastando, etapa.chave);
                  setArrastando(null);
                  setSobre(null);
                }}
                className={clsx(
                  "flex min-h-0 w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-muted/50 p-2 transition-colors",
                  sobre === etapa.chave && "border-border-strong bg-surface-muted",
                )}
              >
                <header className="flex items-center justify-between px-1 pt-1">
                  <h2 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{etapa.rotulo}</h2>
                  <span className="text-xs tabular-nums text-fg-subtle">{daEtapa.length}</span>
                </header>

                <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {daEtapa.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-fg-subtle">
                      {filtrando
                        ? "Nenhum card com este filtro."
                        : etapa.chave === ETAPA_FINAL
                          ? "Nada concluído nos últimos 30 dias."
                          : "Nenhum card."}
                    </p>
                  ) : (
                    daEtapa.map((card) => (
                      <Cartao
                        key={card.id}
                        card={card}
                        responsaveis={responsaveis}
                        hoje={hoje}
                        podeEscrever={podeEscrever}
                        onAbrir={() => onAbrir(card.id)}
                        onAtribuir={(mudanca) => onAtribuir(card.id, mudanca)}
                        onArrastar={(ativo) => {
                          setArrastando(ativo ? card.id : null);
                          if (!ativo) setSobre(null);
                        }}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Card ---------------------------------- */

const classesPilula =
  "relative inline-flex h-6 max-w-full items-center gap-1 rounded-full border border-border bg-surface-muted/60 px-2 text-xs text-fg-muted";
const classesPilulaClicavel =
  "transition-colors hover:border-border-strong hover:text-fg focus-within:ring-2 focus-within:ring-ring";

/**
 * O título abre o card; as pílulas de responsável e prazo editam na hora, sem
 * abrir. Por isso o card é um `div`, não um botão: botão dentro de botão não
 * é HTML válido.
 */
function Cartao({
  card,
  responsaveis,
  hoje,
  podeEscrever,
  onAbrir,
  onAtribuir,
  onArrastar,
}: {
  card: Card;
  responsaveis: Responsavel[];
  hoje: string;
  podeEscrever: boolean;
  onAbrir: () => void;
  onAtribuir: (mudanca: Atribuicao) => void;
  onArrastar: (ativo: boolean) => void;
}) {
  const concluido = card.etapa === ETAPA_FINAL;
  const atrasado = Boolean(card.prazo) && !concluido && card.prazo! < hoje;
  const tarefasProntas = card.tarefas > 0 && card.tarefasConcluidas === card.tarefas;

  return (
    <div
      draggable={podeEscrever}
      onDragStart={(evento) => {
        evento.dataTransfer.effectAllowed = "move";
        onArrastar(true);
      }}
      onDragEnd={() => onArrastar(false)}
      className={clsx(
        "flex shrink-0 flex-col gap-2.5 rounded-md border border-border bg-surface p-3 transition-colors hover:border-border-strong",
        podeEscrever && "cursor-grab active:cursor-grabbing",
      )}
    >
      <button
        type="button"
        onClick={onAbrir}
        className="line-clamp-2 text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {card.titulo}
      </button>

      {card.origem === "inadimplencia" && card.dados.valor !== undefined ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={clsx("text-sm font-semibold tabular-nums", !card.regularizadoEm && "text-danger")}>
            {brl(card.dados.valor)}
          </span>
          {card.regularizadoEm ? (
            <Badge tone="success">Regularizado</Badge>
          ) : (
            <Badge tone="danger">{card.dados.dias} dias de atraso</Badge>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <PilulaResponsavel
          responsavelId={card.responsavelId}
          responsaveis={responsaveis}
          editavel={podeEscrever}
          onMudar={(responsavelId) => onAtribuir({ responsavelId })}
        />
        <PilulaPrazo
          prazo={card.prazo}
          atrasado={atrasado}
          editavel={podeEscrever}
          onMudar={(prazo) => onAtribuir({ prazo })}
        />
        {card.tarefas > 0 ? (
          <button
            type="button"
            onClick={onAbrir}
            title="Abrir as tarefas do card"
            className={clsx(
              classesPilula,
              classesPilulaClicavel,
              "tabular-nums focus-visible:outline-none",
              tarefasProntas && "border-transparent bg-success-bg text-success hover:text-success",
            )}
          >
            <IconCheck className="size-3.5" />
            {card.tarefasConcluidas}/{card.tarefas}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A pílula é só o rótulo; quem recebe o clique é um `<select>` nativo
 * transparente por cima. A lista nativa abre fora da coluna — um menu próprio
 * seria cortado pelo `overflow` dela — e já funciona no teclado e no celular.
 */
function PilulaResponsavel({
  responsavelId,
  responsaveis,
  editavel,
  onMudar,
}: {
  responsavelId: string | null;
  responsaveis: Responsavel[];
  editavel: boolean;
  onMudar: (responsavelId: string | null) => void;
}) {
  const nome = responsavelId ? responsaveis.find((r) => r.id === responsavelId)?.nome : undefined;

  return (
    <span className={clsx(classesPilula, editavel && classesPilulaClicavel, "pl-1")}>
      {nome ? (
        <span className="grid size-4 shrink-0 place-items-center rounded-full bg-accent text-[9px] font-semibold text-accent-fg">
          {iniciais(nome).slice(0, 1) || "?"}
        </span>
      ) : (
        <IconUsuarios className="ml-1 size-3.5 shrink-0" />
      )}
      <span className="truncate">{nome ? nome.split(" ")[0] : "Sem responsável"}</span>

      {editavel ? (
        <select
          aria-label="Responsável pelo card"
          title={nome ?? "Definir responsável"}
          value={responsavelId ?? ""}
          onChange={(e) => onMudar(e.target.value || null)}
          className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
        >
          <option value="">Sem responsável</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  );
}

/** Mesmo truque do responsável, com o seletor de data nativo do navegador. */
function PilulaPrazo({
  prazo,
  atrasado,
  editavel,
  onMudar,
}: {
  prazo: string | null;
  atrasado: boolean;
  editavel: boolean;
  onMudar: (prazo: string | null) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const conteudo = (
    <>
      <IconCalendario className="size-3.5 shrink-0" />
      <span className="tabular-nums">{prazo ? diaMes(prazo) : "Sem prazo"}</span>
    </>
  );
  const tom = atrasado && "border-transparent bg-danger-bg font-medium text-danger hover:text-danger";

  if (!editavel) return <span className={clsx(classesPilula, tom)}>{conteudo}</span>;

  // Botão e campo são irmãos: campo dentro de botão não é HTML válido.
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={atrasado ? "Prazo vencido — clique para alterar" : "Definir prazo"}
        aria-label={prazo ? `Prazo ${diaMes(prazo)}; alterar` : "Definir prazo"}
        // `showPicker` abre o calendário nativo; onde não existe, o foco no
        // campo já permite digitar a data.
        onClick={() => {
          try {
            campo.current?.showPicker();
          } catch {
            campo.current?.focus();
          }
        }}
        className={clsx(classesPilula, classesPilulaClicavel, "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", tom)}
      >
        {conteudo}
      </button>
      <input
        ref={campo}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={prazo ?? ""}
        onChange={(e) => onMudar(e.target.value || null)}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
      />
    </span>
  );
}
