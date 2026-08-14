"use client";

import { useSyncExternalStore } from "react";
import {
  cadastrarEmpresa,
  getServerSnapshot,
  getSnapshot,
  selecionarEmpresa,
  subscribe,
} from "@/lib/empresa-store";

/**
 * Empresas cadastradas e a que está selecionada no painel.
 * Qualquer componente cliente pode consumir — não precisa de provider.
 */
export function useEmpresa() {
  const { empresas, selecionadaId } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return {
    empresas,
    empresaAtual: empresas.find((e) => e.id === selecionadaId) ?? empresas[0],
    selecionarEmpresa,
    cadastrarEmpresa,
  };
}
