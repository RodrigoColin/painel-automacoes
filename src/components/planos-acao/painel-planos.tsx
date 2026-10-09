"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Segmentado } from "@/components/fluxo-caixa/pecas";
import { IconPlus } from "@/components/icons";
import { ModalCard } from "@/components/planos-acao/modal-card";
import { ModalNovoCard } from "@/components/planos-acao/form-novo-card";
import { Quadro, type Atribuicao } from "@/components/planos-acao/quadro";
import { Button, Card as Caixa, EmptyHint } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { diaMes } from "@/lib/fluxo-caixa/calculos";
import { alternarTarefa, atribuirCard, moverCard } from "@/lib/planos-acao/acoes";
import type { Etapa } from "@/lib/planos-acao/etapas";
import type { Card, Responsavel, TarefaComCard } from "@/lib/planos-acao/tipos";

type Visao = "quadro" | "tarefas";

/**
 * Quadro (uma coluna por etapa) e lista de tarefas da empresa. O estado de
 * qual card está aberto vive aqui para as duas visões abrirem o mesmo modal.
 */
export function PainelPlanos({
  empresaId,
  cards,
  tarefas,
  responsaveis,
  userId,
  hoje,
  podeEscrever,
}: {
  empresaId: string;
  cards: Card[];
  tarefas: TarefaComCard[];
  responsaveis: Responsavel[];
  userId: string;
  /** `aaaa-mm-dd` no fuso do painel. */
  hoje: string;
  podeEscrever: boolean;
}) {
  const [visao, setVisao] = useState<Visao>("quadro");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciarTransicao] = useTransition();
  // O card muda na hora (coluna, responsável, prazo); se o servidor recusar,
  // a transição termina e ele volta sozinho ao que era.
  const [cardsExibidos, aplicarOtimista] = useOptimistic(
    cards,
    (atuais, mudanca: { id: string } & Partial<Pick<Card, "etapa" | "responsavelId" | "prazo">>) =>
      atuais.map((card) => (card.id === mudanca.id ? { ...card, ...mudanca } : card)),
  );

  const nomes = new Map(responsaveis.map((r) => [r.id, r.nome]));
  const aberto = abertoId ? cardsExibidos.find((card) => card.id === abertoId) : undefined;

  function mover(cardId: string, etapa: Etapa) {
    const card = cardsExibidos.find((item) => item.id === cardId);
    if (!card || card.etapa === etapa) return;
    setErro(null);
    iniciarTransicao(async () => {
      aplicarOtimista({ id: cardId, etapa });
      const resposta = await moverCard({ empresaId, cardId, etapa });
      if (resposta.erro) setErro(resposta.erro);
    });
  }

  function atribuir(cardId: string, mudanca: Atribuicao) {
    setErro(null);
    iniciarTransicao(async () => {
      aplicarOtimista({ id: cardId, ...mudanca });
      const resposta = await atribuirCard({ empresaId, cardId, ...mudanca });
      if (resposta.erro) setErro(resposta.erro);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmentado
          rotulo="Visão"
          valor={visao}
          onMudar={setVisao}
          opcoes={[
            { valor: "quadro", rotulo: "Quadro" },
            { valor: "tarefas", rotulo: `Tarefas (${tarefas.length})` },
          ]}
        />
        {podeEscrever ? (
          <Button variant="primary" onClick={() => setCriando(true)}>
            <IconPlus className="size-4" />
            Novo card
          </Button>
        ) : null}
      </div>

      {erro ? (
        <p role="alert" className="text-xs text-danger">
          {erro}
        </p>
      ) : null}

      {visao === "quadro" ? (
        <Quadro
          cards={cardsExibidos}
          responsaveis={responsaveis}
          userId={userId}
          hoje={hoje}
          podeEscrever={podeEscrever}
          onAbrir={setAbertoId}
          onMover={mover}
          onAtribuir={atribuir}
        />
      ) : (
        <ListaTarefas
          empresaId={empresaId}
          tarefas={tarefas}
          nomes={nomes}
          userId={userId}
          hoje={hoje}
          podeEscrever={podeEscrever}
          onAbrirCard={setAbertoId}
        />
      )}

      {aberto ? (
        <ModalCard
          // Trocar de card recomeça o formulário e o carregamento do detalhe.
          key={aberto.id}
          empresaId={empresaId}
          card={aberto}
          responsaveis={responsaveis}
          hoje={hoje}
          podeEscrever={podeEscrever}
          onMover={(etapa) => mover(aberto.id, etapa)}
          onFechar={() => setAbertoId(null)}
        />
      ) : null}

      {criando ? (
        <ModalNovoCard empresaId={empresaId} responsaveis={responsaveis} onFechar={() => setCriando(false)} />
      ) : null}
    </div>
  );
}

/* ---------------------------------- Lista --------------------------------- */

function ListaTarefas({
  empresaId,
  tarefas,
  nomes,
  userId,
  hoje,
  podeEscrever,
  onAbrirCard,
}: {
  empresaId: string;
  tarefas: TarefaComCard[];
  nomes: Map<string, string>;
  userId: string;
  hoje: string;
  podeEscrever: boolean;
  onAbrirCard: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState<"todas" | "minhas">("todas");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const visiveis = filtro === "minhas" ? tarefas.filter((t) => t.responsavelId === userId) : tarefas;

  function concluir(tarefaId: string) {
    setErro(null);
    iniciarTransicao(async () => {
      const resposta = await alternarTarefa({ empresaId, tarefaId, concluida: true });
      if (resposta.erro) setErro(resposta.erro);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmentado
        rotulo="Filtro de tarefas"
        valor={filtro}
        onMudar={setFiltro}
        opcoes={[
          { valor: "todas", rotulo: "Todas" },
          { valor: "minhas", rotulo: "Minhas" },
        ]}
      />

      {erro ? (
        <p role="alert" className="text-xs text-danger">
          {erro}
        </p>
      ) : null}

      {visiveis.length === 0 ? (
        <EmptyHint>
          {filtro === "minhas"
            ? "Nenhuma tarefa aberta atribuída a você."
            : "Nenhuma tarefa aberta. Abra um card no quadro para criar as tarefas do plano de ação."}
        </EmptyHint>
      ) : (
        <Caixa className="divide-y divide-border">
          {visiveis.map((tarefa) => {
            const atrasada = Boolean(tarefa.prazo) && tarefa.prazo! < hoje;
            return (
              <div key={tarefa.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={!podeEscrever || pendente}
                  onChange={() => concluir(tarefa.id)}
                  aria-label={`Concluir: ${tarefa.titulo}`}
                  className="size-4 shrink-0 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tarefa.titulo}</p>
                  <button
                    type="button"
                    onClick={() => onAbrirCard(tarefa.cardId)}
                    className="max-w-full truncate text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                  >
                    {tarefa.cardTitulo}
                  </button>
                </div>
                <span className="hidden w-40 shrink-0 truncate text-xs text-fg-muted sm:block">
                  {tarefa.responsavelId ? (nomes.get(tarefa.responsavelId) ?? "—") : "Sem responsável"}
                </span>
                <span
                  className={clsx(
                    "w-24 shrink-0 text-right text-xs tabular-nums",
                    atrasada ? "font-medium text-danger" : "text-fg-muted",
                  )}
                >
                  {tarefa.prazo ? `${atrasada ? "Atrasada · " : ""}${diaMes(tarefa.prazo)}` : "Sem prazo"}
                </span>
              </div>
            );
          })}
        </Caixa>
      )}
    </div>
  );
}
