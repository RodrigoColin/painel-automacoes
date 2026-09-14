"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";

/**
 * Diálogo do painel: título, descrição, botão de fechar e o conteúdo por
 * conta de quem chama. Fecha no Esc e no clique fora.
 *
 * Vai para o `body` por um portal porque quase sempre nasce dentro de uma
 * célula de tabela, e a tabela mora num card com `overflow-hidden`. Solto no
 * `body`, não depende do contexto de empilhamento de quem o abriu.
 */
export function Modal({
  titulo,
  descricao,
  onFechar,
  children,
}: {
  titulo: string;
  descricao: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  const id = useId();

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div role="presentation" onClick={onFechar} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="relative w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 id={id} className="text-sm font-semibold tracking-tight">
              {titulo}
            </h2>
            <p className="text-xs text-fg-muted">{descricao}</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-muted"
          >
            <IconClose className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
