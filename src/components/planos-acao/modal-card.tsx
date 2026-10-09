"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { EditorRico } from "@/components/editor-rico";
import { Field, Input, Select } from "@/components/form";
import { IconLixeira } from "@/components/icons";
import { Modal } from "@/components/modal";
import { classesAreaTexto, opcoesResponsavel } from "@/components/planos-acao/form-novo-card";
import { Badge, Button, classesBotaoLixeira } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { brl, diaMes } from "@/lib/fluxo-caixa/calculos";
import {
  alternarTarefa,
  atualizarTarefa,
  carregarCard,
  comentar,
  criarTarefa,
  editarCard,
  excluirCard,
  excluirTarefa,
} from "@/lib/planos-acao/acoes";
import { ETAPAS, type Etapa } from "@/lib/planos-acao/etapas";
import type { Card, DetalheCard, Responsavel, Tarefa } from "@/lib/planos-acao/tipos";
import { formatarDataHora } from "@/lib/tipos";

type Resposta = { erro?: string };

/**
 * O plano de ação de um card: dados, etapa, tarefas e linha do tempo.
 *
 * O card em si chega por prop (vem da lista da página, que revalida a cada
 * action); tarefas e histórico são buscados ao abrir e depois de cada
 * alteração, porque não cabem na listagem do quadro.
 */
export function ModalCard({
  empresaId,
  card,
  responsaveis,
  hoje,
  podeEscrever,
  onMover,
  onFechar,
}: {
  empresaId: string;
  card: Card;
  responsaveis: Responsavel[];
  hoje: string;
  podeEscrever: boolean;
  onMover: (etapa: Etapa) => void;
  onFechar: () => void;
}) {
  const [detalhe, setDetalhe] = useState<DetalheCard | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const recarregar = useCallback(async () => {
    try {
      setDetalhe(await carregarCard(card.id));
    } catch {
      setErro("Não foi possível carregar o card.");
    }
  }, [card.id]);

  useEffect(() => {
    // A etapa entra nas dependências: mover o card grava um evento, e a
    // linha do tempo precisa mostrá-lo.
    let ativo = true;
    carregarCard(card.id)
      .then((dados) => {
        if (ativo) setDetalhe(dados);
      })
      .catch(() => {
        if (ativo) setErro("Não foi possível carregar o card.");
      });
    return () => {
      ativo = false;
    };
  }, [card.id, card.etapa]);

  /** Roda a action, mostra o erro se houver e atualiza tarefas e histórico. */
  function executar(acao: () => Promise<Resposta>, aoConcluir?: () => void) {
    setErro(null);
    iniciarTransicao(async () => {
      const resposta = await acao();
      if (resposta.erro) {
        setErro(resposta.erro);
        return;
      }
      aoConcluir?.();
      await recarregar();
    });
  }

  const descricao =
    card.origem === "inadimplencia" ? "Criado automaticamente pela inadimplência" : "Card criado manualmente";

  return (
    <Modal titulo={card.titulo} descricao={descricao} largura="xl" onFechar={onFechar}>
      <div className="space-y-6 px-5 py-4">
        {card.origem === "inadimplencia" ? <RetratoDivida card={card} /> : null}

        <DadosDoCard
          empresaId={empresaId}
          card={card}
          responsaveis={responsaveis}
          podeEscrever={podeEscrever}
          pendente={pendente}
          onMover={onMover}
          executar={executar}
          onExcluido={onFechar}
        />

        {erro ? (
          <p role="alert" className="text-xs text-danger">
            {erro}
          </p>
        ) : null}

        <Tarefas
          empresaId={empresaId}
          cardId={card.id}
          tarefas={detalhe?.tarefas ?? null}
          responsaveis={responsaveis}
          hoje={hoje}
          podeEscrever={podeEscrever}
          pendente={pendente}
          executar={executar}
        />

        <Historico
          empresaId={empresaId}
          cardId={card.id}
          eventos={detalhe?.eventos ?? null}
          podeEscrever={podeEscrever}
          pendente={pendente}
          executar={executar}
        />
      </div>
    </Modal>
  );
}

type Executar = (acao: () => Promise<Resposta>, aoConcluir?: () => void) => void;

function TituloSecao({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">{children}</h3>;
}

/** Números do vencido na última sincronização com o fluxo de caixa. */
function RetratoDivida({ card }: { card: Card }) {
  const d = card.dados;
  const itens = [
    { rotulo: "Vencido no ano", valor: d.valor !== undefined ? brl(d.valor) : "—" },
    { rotulo: "Títulos", valor: d.titulos !== undefined ? String(d.titulos) : "—" },
    { rotulo: "Maior atraso", valor: d.dias !== undefined ? `${d.dias} dias` : "—" },
    { rotulo: "Vencido total", valor: d.vencidoTotal !== undefined ? brl(d.vencidoTotal) : "—" },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {itens.map((item) => (
          <div key={item.rotulo} className="rounded-md border border-border bg-surface-muted/50 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{item.rotulo}</p>
            <p className="pt-0.5 text-sm font-semibold tabular-nums">{item.valor}</p>
          </div>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {card.regularizadoEm ? (
          <>
            <Badge tone="success">Regularizado</Badge>
            Saiu da lista de inadimplentes em {formatarDataHora(card.regularizadoEm)}. Os números acima são da
            última posição em aberto.
          </>
        ) : (
          <>
            Posição em {d.ref ? diaMes(d.ref) : "—"}
            {d.antigo ? ` · vencimento mais antigo em ${diaMes(d.antigo)}/${d.antigo.slice(0, 4)}` : ""}. Atualiza
            a cada rodada do fluxo de caixa.
          </>
        )}
      </p>
    </div>
  );
}

function DadosDoCard({
  empresaId,
  card,
  responsaveis,
  podeEscrever,
  pendente,
  onMover,
  executar,
  onExcluido,
}: {
  empresaId: string;
  card: Card;
  responsaveis: Responsavel[];
  podeEscrever: boolean;
  pendente: boolean;
  onMover: (etapa: Etapa) => void;
  executar: Executar;
  onExcluido: () => void;
}) {
  const [titulo, setTitulo] = useState(card.titulo);
  const [descricao, setDescricao] = useState(card.descricao);
  const [responsavelId, setResponsavelId] = useState(card.responsavelId ?? "");
  const [prazo, setPrazo] = useState(card.prazo ?? "");
  const [salvo, setSalvo] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const mudou =
    titulo !== card.titulo ||
    descricao !== card.descricao ||
    responsavelId !== (card.responsavelId ?? "") ||
    prazo !== (card.prazo ?? "");

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvo(false);
    executar(
      () => editarCard({ empresaId, cardId: card.id, titulo, descricao, responsavelId, prazo }),
      () => setSalvo(true),
    );
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Título" required>
          <Input value={titulo} maxLength={200} disabled={!podeEscrever} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        {/* A etapa grava na hora, como arrastar o card no quadro. */}
        <Field label="Etapa">
          <Select
            value={card.etapa}
            disabled={!podeEscrever}
            onChange={(e) => onMover(e.target.value as Etapa)}
            options={ETAPAS.map((etapa) => ({ valor: etapa.chave, rotulo: etapa.rotulo }))}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Responsável">
          <Select
            value={responsavelId}
            disabled={!podeEscrever}
            onChange={(e) => setResponsavelId(e.target.value)}
            options={opcoesResponsavel(responsaveis)}
          />
        </Field>
        <Field label="Prazo">
          <Input type="date" value={prazo} disabled={!podeEscrever} onChange={(e) => setPrazo(e.target.value)} />
        </Field>
      </div>

      {/* Fora do `Field`: ele é um <label>, e clicar no rótulo acionaria o
          primeiro botão da barra de formatação. */}
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Plano de ação</p>
        <p className="text-xs text-fg-subtle">O que foi combinado e como o caso será conduzido.</p>
        <EditorRico rotulo="Plano de ação" valor={card.descricao} desabilitado={!podeEscrever} onMudar={setDescricao} />
      </div>

      {podeEscrever ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {card.origem === "manual" ? (
            confirmandoExclusao ? (
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                Excluir o card, as tarefas e o histórico?
                <Button
                  type="button"
                  variant="danger"
                  disabled={pendente}
                  onClick={() => executar(() => excluirCard({ empresaId, cardId: card.id }), onExcluido)}
                >
                  Excluir
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmandoExclusao(false)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmandoExclusao(true)}>
                <IconLixeira className="size-4" />
                Excluir card
              </Button>
            )
          ) : (
            <span />
          )}
          <span className="flex items-center gap-3">
            {salvo && !mudou ? <span className="text-xs text-fg-muted">Salvo.</span> : null}
            <Button type="submit" variant="primary" disabled={!mudou || pendente}>
              Salvar alterações
            </Button>
          </span>
        </div>
      ) : null}
    </form>
  );
}

function Tarefas({
  empresaId,
  cardId,
  tarefas,
  responsaveis,
  hoje,
  podeEscrever,
  pendente,
  executar,
}: {
  empresaId: string;
  cardId: string;
  tarefas: Tarefa[] | null;
  responsaveis: Responsavel[];
  hoje: string;
  podeEscrever: boolean;
  pendente: boolean;
  executar: Executar;
}) {
  const [titulo, setTitulo] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [prazo, setPrazo] = useState("");

  function adicionar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!titulo.trim()) return;
    executar(
      () => criarTarefa({ empresaId, cardId, titulo, responsavelId, prazo }),
      () => {
        setTitulo("");
        setPrazo("");
      },
    );
  }

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <TituloSecao>Tarefas</TituloSecao>

      {tarefas === null ? (
        <p className="text-sm text-fg-muted">Carregando…</p>
      ) : tarefas.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhuma tarefa ainda.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tarefas.map((tarefa) => {
            const concluida = Boolean(tarefa.concluidaEm);
            const atrasada = !concluida && Boolean(tarefa.prazo) && tarefa.prazo! < hoje;
            return (
              <li key={tarefa.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={concluida}
                  disabled={!podeEscrever || pendente}
                  onChange={(e) =>
                    executar(() => alternarTarefa({ empresaId, tarefaId: tarefa.id, concluida: e.target.checked }))
                  }
                  aria-label={`${concluida ? "Reabrir" : "Concluir"}: ${tarefa.titulo}`}
                  className="size-4 shrink-0 accent-accent"
                />
                <span
                  className={clsx(
                    "min-w-40 flex-1 text-sm",
                    concluida && "text-fg-subtle line-through",
                    atrasada && "text-danger",
                  )}
                >
                  {tarefa.titulo}
                </span>
                <Select
                  aria-label="Responsável pela tarefa"
                  value={tarefa.responsavelId ?? ""}
                  disabled={!podeEscrever || pendente}
                  onChange={(e) =>
                    executar(() =>
                      atualizarTarefa({
                        empresaId,
                        tarefaId: tarefa.id,
                        responsavelId: e.target.value,
                        prazo: tarefa.prazo,
                      }),
                    )
                  }
                  options={opcoesResponsavel(responsaveis)}
                  className="h-8 w-40 text-xs"
                />
                <Input
                  type="date"
                  aria-label="Prazo da tarefa"
                  value={tarefa.prazo ?? ""}
                  disabled={!podeEscrever || pendente}
                  onChange={(e) =>
                    executar(() =>
                      atualizarTarefa({
                        empresaId,
                        tarefaId: tarefa.id,
                        responsavelId: tarefa.responsavelId,
                        prazo: e.target.value,
                      }),
                    )
                  }
                  className="h-8 w-36 text-xs"
                />
                {podeEscrever ? (
                  <button
                    type="button"
                    disabled={pendente}
                    onClick={() => executar(() => excluirTarefa({ empresaId, tarefaId: tarefa.id }))}
                    aria-label={`Excluir tarefa: ${tarefa.titulo}`}
                    title="Excluir tarefa"
                    className={clsx(classesBotaoLixeira, "size-8")}
                  >
                    <IconLixeira className="size-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {podeEscrever ? (
        <form onSubmit={adicionar} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Nova tarefa"
            placeholder="Nova tarefa…"
            value={titulo}
            maxLength={200}
            onChange={(e) => setTitulo(e.target.value)}
            className="min-w-48 flex-1"
          />
          <Select
            aria-label="Responsável pela nova tarefa"
            value={responsavelId}
            onChange={(e) => setResponsavelId(e.target.value)}
            options={opcoesResponsavel(responsaveis)}
            className="w-44"
          />
          <Input
            type="date"
            aria-label="Prazo da nova tarefa"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            className="w-40"
          />
          <Button type="submit" disabled={!titulo.trim() || pendente}>
            Adicionar
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function Historico({
  empresaId,
  cardId,
  eventos,
  podeEscrever,
  pendente,
  executar,
}: {
  empresaId: string;
  cardId: string;
  eventos: DetalheCard["eventos"] | null;
  podeEscrever: boolean;
  pendente: boolean;
  executar: Executar;
}) {
  const [texto, setTexto] = useState("");

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!texto.trim()) return;
    executar(
      () => comentar({ empresaId, cardId, texto }),
      () => setTexto(""),
    );
  }

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <TituloSecao>Comentários e histórico</TituloSecao>

      {podeEscrever ? (
        <form onSubmit={enviar} className="space-y-2">
          <textarea
            aria-label="Novo comentário"
            placeholder="Ex.: liguei para o financeiro, prometeram pagar dia 15."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            className={classesAreaTexto}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={!texto.trim() || pendente}>
              Comentar
            </Button>
          </div>
        </form>
      ) : null}

      {eventos === null ? (
        <p className="text-sm text-fg-muted">Carregando…</p>
      ) : (
        <ol className="space-y-3">
          {eventos.map((evento) => (
            <li key={evento.id} className="space-y-0.5">
              <p className="text-xs text-fg-subtle">
                <span className="font-medium text-fg-muted">{evento.autor ?? "Sistema"}</span>
                {" · "}
                {formatarDataHora(evento.criadoEm)}
              </p>
              <p
                className={clsx(
                  "whitespace-pre-wrap text-sm",
                  evento.tipo === "comentario" ? "text-fg" : "text-fg-muted",
                )}
              >
                {evento.texto}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
