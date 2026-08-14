"use client";

import { useSyncExternalStore } from "react";
import {
  criarAutomacao,
  definirStatus,
  getServerSnapshot,
  getSnapshot,
  removerAutomacao,
  subscribe,
} from "@/lib/automacao-store";

/**
 * Automações cadastradas. Qualquer componente cliente pode consumir —
 * não precisa de provider.
 */
export function useAutomacoes() {
  const { automacoes } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return { automacoes, criarAutomacao, definirStatus, removerAutomacao };
}
