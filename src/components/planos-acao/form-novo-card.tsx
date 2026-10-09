"use client";

import { useState } from "react";
import { EditorRico } from "@/components/editor-rico";
import { Field, Input, Select } from "@/components/form";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui";
import { criarCard } from "@/lib/planos-acao/acoes";
import type { Responsavel } from "@/lib/planos-acao/tipos";

/** Área de texto com a mesma cara dos controles de `form.tsx`. */
export const classesAreaTexto =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-ring";

export function opcoesResponsavel(responsaveis: Responsavel[]) {
  return [{ valor: "", rotulo: "Sem responsável" }, ...responsaveis.map((r) => ({ valor: r.id, rotulo: r.nome }))];
}

/**
 * Card criado à mão, para assunto que não veio da inadimplência. Entra em
 * "A tratar"; tarefas e comentários são adicionados depois, abrindo o card.
 */
export function ModalNovoCard({
  empresaId,
  responsaveis,
  onFechar,
}: {
  empresaId: string;
  responsaveis: Responsavel[];
  onFechar: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [prazo, setPrazo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!titulo.trim()) {
      setErro("Informe um título.");
      return;
    }

    setSalvando(true);
    const resultado = await criarCard({ empresaId, titulo, descricao, responsavelId, prazo });
    setSalvando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }
    onFechar();
  }

  return (
    <Modal titulo="Novo card" descricao='Entra na etapa "A tratar".' onFechar={onFechar}>
      <form onSubmit={enviar} className="space-y-4 px-5 py-4">
        <Field label="Título" required>
          <Input
            autoFocus
            value={titulo}
            maxLength={200}
            onChange={(e) => {
              setTitulo(e.target.value);
              setErro(null);
            }}
          />
        </Field>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Plano de ação</p>
          <EditorRico rotulo="Plano de ação" valor="" onMudar={setDescricao} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsável">
            <Select
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              options={opcoesResponsavel(responsaveis)}
            />
          </Field>
          <Field label="Prazo">
            <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </Field>
        </div>

        {erro ? (
          <p role="alert" className="text-xs text-danger">
            {erro}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={salvando}>
            {salvando ? "Criando…" : "Criar card"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
