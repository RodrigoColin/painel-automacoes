"use client";

import { useSyncExternalStore } from "react";
import { Toggle } from "@/components/toggle";
import { IconLua, IconSol } from "@/components/icons";

const CHAVE = "painel:tema";

/**
 * `useSyncExternalStore` em vez de `useState` + `useEffect`: o valor real do
 * tema vive fora do React (atributo do `<html>`, preferência do sistema), e
 * ler isso só é seguro no navegador. `getServerSnapshot` cobre a renderização
 * no servidor sem quebrar a hidratação — o script inline do layout raiz já
 * aplicou o tema salvo antes da primeira pintura, então o "claro" aqui é só
 * o valor usado para casar com o HTML do servidor, nunca chega a aparecer.
 */
function assinar(notificar: () => void) {
  const consultaSistema = window.matchMedia("(prefers-color-scheme: dark)");
  const observador = new MutationObserver(notificar);
  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  consultaSistema.addEventListener("change", notificar);

  return () => {
    observador.disconnect();
    consultaSistema.removeEventListener("change", notificar);
  };
}

function obterEstado(): boolean {
  const explicito = document.documentElement.getAttribute("data-theme");
  if (explicito === "dark") return true;
  if (explicito === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function obterEstadoServidor(): boolean {
  return false;
}

export function AlternadorTema() {
  const escuro = useSyncExternalStore(assinar, obterEstado, obterEstadoServidor);

  function alternar(novoEscuro: boolean) {
    document.documentElement.setAttribute("data-theme", novoEscuro ? "dark" : "light");
    try {
      localStorage.setItem(CHAVE, novoEscuro ? "dark" : "light");
    } catch {
      // Navegador sem localStorage (modo privado restrito, por exemplo): o
      // tema ainda troca nesta sessão, só não sobrevive a um reload.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2">
      <span className="flex items-center gap-2 text-sm text-fg-muted">
        {escuro ? <IconLua className="size-4" /> : <IconSol className="size-4" />}
        Tema escuro
      </span>
      <Toggle label="Alternar tema escuro" checked={escuro} onChange={alternar} />
    </div>
  );
}
