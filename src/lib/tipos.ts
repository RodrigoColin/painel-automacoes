/**
 * Tipos de domínio do painel.
 *
 * Espelham os enums e tabelas da migração em `supabase/migrations`. Aqui só
 * moram tipos e rótulos — os dados vêm de `lib/consultas.ts`.
 */

import type { ConfigAutomacao } from "@/lib/automacao-tipos";

export type StatusAutomacao = "ativa" | "pausada" | "rascunho";

export const rotuloStatus: Record<StatusAutomacao, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  rascunho: "Rascunho",
};

export type Automacao = {
  id: string;
  nome: string;
  descricao: string;
  status: StatusAutomacao;
  gatilho: string;
  execucoes30d: number;
  /** `null` enquanto a automação nunca rodou. */
  ultimaExecucao: string | null;
  responsavel: string | null;
  proximaExecucao: string | null;
  /** Nome da empresa dona da automação — relevante só na visão agregada da Admin. */
  empresa: string;
} & ConfigAutomacao;

export type ResultadoExecucao = "sucesso" | "erro" | "em_andamento";

export const rotuloResultado: Record<ResultadoExecucao, string> = {
  sucesso: "Sucesso",
  erro: "Erro",
  em_andamento: "Em andamento",
};

export type Execucao = {
  id: string;
  automacao: string;
  resultado: ResultadoExecucao;
  inicio: string;
  /** Em milissegundos; `null` enquanto a execução não terminou. */
  duracaoMs: number | null;
  origem: string;
  /** Nome da empresa dona da execução — relevante só na visão agregada da Admin. */
  empresa: string;
};

export type NivelLog = "info" | "aviso" | "erro";

export const rotuloNivel: Record<NivelLog, string> = {
  info: "Info",
  aviso: "Aviso",
  erro: "Erro",
};

export type Log = {
  id: string;
  nivel: NivelLog;
  horario: string;
  automacao: string;
  mensagem: string;
};

export type PapelMembro = "admin" | "editor" | "leitor";

export const rotuloPapel: Record<PapelMembro, string> = {
  admin: "Administrador",
  editor: "Editor",
  leitor: "Leitor",
};

export type StatusMembro = "ativo" | "convidado" | "inativo";

export const rotuloStatusUsuario: Record<StatusMembro, string> = {
  ativo: "Ativo",
  convidado: "Convidado",
  inativo: "Inativo",
};

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  papel: PapelMembro;
  status: StatusMembro;
  ultimoAcesso: string | null;
};

export type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  email: string | null;
  /** Só é `true` para a empresa de plataforma (Admin) — ver `souAdminPlataforma`. */
  eh_plataforma: boolean;
};

/** Ponto da série de disparos por dia. */
export type PontoDisparo = {
  /** Rótulo curto no formato dd/mm. */
  rotulo: string;
  sucesso: number;
  erro: number;
};

/* ------------------------------ Formatação ------------------------------- */

export function iniciais(nome: string) {
  return nome
    .split(" ")
    .filter((parte) => /[a-zà-ú]/i.test(parte))
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
}

/** Data e hora no formato usado nas listagens: 07/08/2026 09:42. */
export function formatarDataHora(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatarDuracao(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const segundos = ms / 1000;
  return segundos < 60
    ? `${segundos.toFixed(1).replace(".", ",")} s`
    : `${Math.floor(segundos / 60)} min ${Math.round(segundos % 60)} s`;
}
