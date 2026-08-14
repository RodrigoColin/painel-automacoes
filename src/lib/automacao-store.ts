/**
 * Store das automações, persistido no navegador.
 *
 * Mesmo padrão do `empresa-store`: estado fora do React (`useSyncExternalStore`)
 * alimentado pelo `localStorage`, para que o que foi criado sobreviva à
 * navegação enquanto a API não existe. Trocar por chamadas reais depois.
 */

import { automacoes as automacoesIniciais } from "@/lib/data";
import type { Automacao, StatusAutomacao } from "@/lib/data";
import { gatilhoDe, type ConfigAutomacao } from "@/lib/automacao-tipos";

const CHAVE = "painel:automacoes";

export type EstadoAutomacoes = { automacoes: Automacao[] };

const ESTADO_INICIAL: EstadoAutomacoes = { automacoes: automacoesIniciais };

let cache: EstadoAutomacoes | null = null;
const ouvintes = new Set<() => void>();

function ler(): EstadoAutomacoes {
  try {
    const salvas = localStorage.getItem(CHAVE);
    const lista = salvas ? (JSON.parse(salvas) as Automacao[]) : null;
    return { automacoes: lista?.length ? lista : automacoesIniciais };
  } catch {
    // Armazenamento indisponível ou corrompido: segue com os dados padrão.
    return ESTADO_INICIAL;
  }
}

function notificar() {
  for (const ouvinte of ouvintes) ouvinte();
}

function escrever(estado: EstadoAutomacoes) {
  cache = estado;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado.automacoes));
  } catch {
    // Ignora falha de escrita (modo privado, cota cheia): vale o estado em memória.
  }
  notificar();
}

export function subscribe(ouvinte: () => void) {
  ouvintes.add(ouvinte);

  // Mantém abas abertas do painel em sincronia.
  function aoMudarArmazenamento(evento: StorageEvent) {
    if (evento.key === CHAVE) {
      cache = null;
      notificar();
    }
  }
  window.addEventListener("storage", aoMudarArmazenamento);

  return () => {
    ouvintes.delete(ouvinte);
    window.removeEventListener("storage", aoMudarArmazenamento);
  };
}

export function getSnapshot(): EstadoAutomacoes {
  cache ??= ler();
  return cache;
}

export function getServerSnapshot(): EstadoAutomacoes {
  return ESTADO_INICIAL;
}

export function novaAutomacaoId() {
  return `aut-${Math.random().toString(36).slice(2, 9)}`;
}

/** Campos preenchidos no formulário de criação. */
export type NovaAutomacao = {
  nome: string;
  descricao: string;
  responsavel: string;
  status: StatusAutomacao;
} & ConfigAutomacao;

export function criarAutomacao(dados: NovaAutomacao): Automacao {
  const estado = getSnapshot();

  // O texto do gatilho é derivado da configuração — nunca digitado à mão.
  const automacao = {
    ...dados,
    id: novaAutomacaoId(),
    gatilho: gatilhoDe(dados),
    execucoes30d: 0,
    ultimaExecucao: "—",
  } as Automacao;

  escrever({ automacoes: [automacao, ...estado.automacoes] });
  return automacao;
}

export function definirStatus(id: string, status: StatusAutomacao) {
  const estado = getSnapshot();
  escrever({
    automacoes: estado.automacoes.map((a) =>
      a.id === id ? ({ ...a, status } as Automacao) : a
    ),
  });
}

export function removerAutomacao(id: string) {
  const estado = getSnapshot();
  escrever({ automacoes: estado.automacoes.filter((a) => a.id !== id) });
}
