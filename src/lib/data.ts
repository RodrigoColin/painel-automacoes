/**
 * Dados de placeholder. Substituir por chamadas reais quando a API existir.
 */

import type { ConfigAutomacao } from "@/lib/automacao-tipos";

export type StatusAutomacao = "ativa" | "pausada" | "rascunho";

/**
 * `tipo` e `config` vêm da união discriminada em `automacao-tipos`: o motor
 * escolhido na criação determina o formato da configuração.
 */
export type Automacao = {
  id: string;
  nome: string;
  descricao: string;
  status: StatusAutomacao;
  gatilho: string;
  execucoes30d: number;
  ultimaExecucao: string;
  responsavel: string;
} & ConfigAutomacao;

export const automacoes: Automacao[] = [
  {
    id: "aut-001",
    nome: "Automação Placeholder 01",
    descricao: "Descrição de exemplo para a automação.",
    status: "ativa",
    gatilho: "Cron · */15 * * * *",
    execucoes30d: 1284,
    ultimaExecucao: "07/08/2026 09:42",
    responsavel: "Usuário Placeholder",
    tipo: "python-cron",
    config: {
      cron: "*/15 * * * *",
      entrada: "scripts/sincronizar_pedidos.py",
      versaoPython: "3.13",
      timeoutSegundos: 300,
      tentativas: 3,
      variaveis: "API_BASE_URL=https://api.exemplo.com",
    },
  },
  {
    id: "aut-002",
    nome: "Automação Placeholder 02",
    descricao: "Descrição de exemplo para a automação.",
    status: "ativa",
    gatilho: "Webhook · n8n",
    execucoes30d: 642,
    ultimaExecucao: "07/08/2026 09:15",
    responsavel: "Usuário Placeholder",
    tipo: "n8n",
    config: {
      instanciaUrl: "https://n8n.exemplo.com",
      workflowId: "wf-2f19c0",
      modoDisparo: "webhook",
      cron: "0 8 * * *",
      aguardarResposta: true,
    },
  },
  {
    id: "aut-003",
    nome: "Automação Placeholder 03",
    descricao: "Descrição de exemplo para a automação.",
    status: "pausada",
    gatilho: "Cron · 0 8 * * *",
    execucoes30d: 96,
    ultimaExecucao: "02/08/2026 08:00",
    responsavel: "Usuário Placeholder",
    tipo: "python-cron",
    config: {
      cron: "0 8 * * *",
      entrada: "scripts/relatorio_diario.py",
      versaoPython: "3.12",
      timeoutSegundos: 600,
      tentativas: 1,
      variaveis: "",
    },
  },
  {
    id: "aut-004",
    nome: "Automação Placeholder 04",
    descricao: "Descrição de exemplo para a automação.",
    status: "rascunho",
    gatilho: "Manual · n8n",
    execucoes30d: 0,
    ultimaExecucao: "—",
    responsavel: "Usuário Placeholder",
    tipo: "n8n",
    config: {
      instanciaUrl: "https://n8n.exemplo.com",
      workflowId: "wf-8ab331",
      modoDisparo: "manual",
      cron: "0 8 * * *",
      aguardarResposta: false,
    },
  },
  {
    id: "aut-005",
    nome: "Automação Placeholder 05",
    descricao: "Descrição de exemplo para a automação.",
    status: "ativa",
    gatilho: "Webhook · n8n",
    execucoes30d: 3210,
    ultimaExecucao: "07/08/2026 09:44",
    responsavel: "Usuário Placeholder",
    tipo: "n8n",
    config: {
      instanciaUrl: "https://n8n.exemplo.com",
      workflowId: "wf-71d4e9",
      modoDisparo: "webhook",
      cron: "0 8 * * *",
      aguardarResposta: false,
    },
  },
];

export const rotuloStatus: Record<StatusAutomacao, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  rascunho: "Rascunho",
};

export type ResultadoExecucao = "sucesso" | "erro" | "em_andamento";

export type Execucao = {
  id: string;
  automacao: string;
  resultado: ResultadoExecucao;
  inicio: string;
  duracao: string;
  origem: string;
};

export const execucoes: Execucao[] = [
  {
    id: "exe-8891",
    automacao: "Automação Placeholder 05",
    resultado: "em_andamento",
    inicio: "07/08/2026 09:44",
    duracao: "—",
    origem: "Webhook",
  },
  {
    id: "exe-8890",
    automacao: "Automação Placeholder 01",
    resultado: "sucesso",
    inicio: "07/08/2026 09:42",
    duracao: "3,2 s",
    origem: "Cron",
  },
  {
    id: "exe-8889",
    automacao: "Automação Placeholder 02",
    resultado: "erro",
    inicio: "07/08/2026 09:15",
    duracao: "12,8 s",
    origem: "Webhook",
  },
  {
    id: "exe-8888",
    automacao: "Automação Placeholder 01",
    resultado: "sucesso",
    inicio: "07/08/2026 09:27",
    duracao: "2,9 s",
    origem: "Cron",
  },
  {
    id: "exe-8887",
    automacao: "Automação Placeholder 05",
    resultado: "sucesso",
    inicio: "07/08/2026 09:11",
    duracao: "1,4 s",
    origem: "Webhook",
  },
  {
    id: "exe-8886",
    automacao: "Automação Placeholder 03",
    resultado: "erro",
    inicio: "02/08/2026 08:00",
    duracao: "30,0 s",
    origem: "Cron",
  },
];

export const rotuloResultado: Record<ResultadoExecucao, string> = {
  sucesso: "Sucesso",
  erro: "Erro",
  em_andamento: "Em andamento",
};

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  papel: "Administrador" | "Editor" | "Leitor";
  status: "ativo" | "convidado" | "inativo";
  ultimoAcesso: string;
};

export const usuarios: Usuario[] = [
  {
    id: "usr-01",
    nome: "Usuário Placeholder 01",
    email: "placeholder01@exemplo.com",
    papel: "Administrador",
    status: "ativo",
    ultimoAcesso: "07/08/2026 09:30",
  },
  {
    id: "usr-02",
    nome: "Usuário Placeholder 02",
    email: "placeholder02@exemplo.com",
    papel: "Editor",
    status: "ativo",
    ultimoAcesso: "06/08/2026 18:02",
  },
  {
    id: "usr-03",
    nome: "Usuário Placeholder 03",
    email: "placeholder03@exemplo.com",
    papel: "Leitor",
    status: "convidado",
    ultimoAcesso: "—",
  },
  {
    id: "usr-04",
    nome: "Usuário Placeholder 04",
    email: "placeholder04@exemplo.com",
    papel: "Editor",
    status: "inativo",
    ultimoAcesso: "12/07/2026 11:47",
  },
];

export const rotuloStatusUsuario: Record<Usuario["status"], string> = {
  ativo: "Ativo",
  convidado: "Convidado",
  inativo: "Inativo",
};

/* ------------------------------------------------------------------
   Dados do dashboard — séries e registros de placeholder.
   Tudo é gerado de forma determinística (sem Date.now / Math.random)
   para que servidor e cliente rendam exatamente o mesmo conteúdo.
   ------------------------------------------------------------------ */

/** Data de referência do ambiente de placeholder: 07/08/2026. */
const HOJE = Date.UTC(2026, 7, 7);
const UM_DIA = 86_400_000;

/** Gerador congruente linear — números estáveis a partir de uma semente. */
function semente(valor: number) {
  let s = valor;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function formatarDia(ts: number) {
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(
    d.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

export type PontoDisparo = {
  /** Rótulo curto no formato dd/mm. */
  rotulo: string;
  sucesso: number;
  erro: number;
};

function gerarSerie(dias: number, seed: number): PontoDisparo[] {
  const rand = semente(seed);
  return Array.from({ length: dias }, (_, i) => {
    const ts = HOJE - (dias - 1 - i) * UM_DIA;
    const diaSemana = new Date(ts).getUTCDay();
    const fimDeSemana = diaSemana === 0 || diaSemana === 6;
    const base = fimDeSemana ? 90 : 230;
    const sucesso = Math.round(base + rand() * (fimDeSemana ? 60 : 150));
    const erro = Math.round(rand() * (fimDeSemana ? 4 : 12));
    return { rotulo: formatarDia(ts), sucesso, erro };
  });
}

/** Disparos por dia nos últimos 30 dias. */
export const serieDisparos30d = gerarSerie(30, 20260807);

/** Recorte dos últimos 14 dias, usado no gráfico de sucesso × erro. */
export const serieDisparos14d = serieDisparos30d.slice(-14);

/** Volume de disparos por hora do dia (0h → 23h). */
export const disparosPorHora: number[] = (() => {
  const rand = semente(4242);
  return Array.from({ length: 24 }, (_, h) => {
    // Curva comercial: pico entre 9h e 18h.
    const peso = h >= 8 && h <= 19 ? 1 : h >= 6 && h <= 22 ? 0.45 : 0.12;
    return Math.round((20 + rand() * 40) * peso * 3);
  });
})();

export type NivelLog = "info" | "aviso" | "erro";

export type Log = {
  id: string;
  nivel: NivelLog;
  horario: string;
  automacao: string;
  mensagem: string;
};

export const logs: Log[] = [
  {
    id: "log-1042",
    nivel: "erro",
    horario: "09:15:07",
    automacao: "Automação Placeholder 02",
    mensagem: "Falha ao chamar endpoint externo: tempo limite excedido (30s).",
  },
  {
    id: "log-1041",
    nivel: "info",
    horario: "09:14:52",
    automacao: "Automação Placeholder 05",
    mensagem: "Execução iniciada a partir de evento de atualização de registro.",
  },
  {
    id: "log-1040",
    nivel: "aviso",
    horario: "09:12:31",
    automacao: "Automação Placeholder 01",
    mensagem: "Nova tentativa agendada após resposta 429 do serviço de destino.",
  },
  {
    id: "log-1039",
    nivel: "info",
    horario: "09:11:04",
    automacao: "Automação Placeholder 05",
    mensagem: "Execução concluída — 12 registros processados em 1,4 s.",
  },
  {
    id: "log-1038",
    nivel: "info",
    horario: "09:42:00",
    automacao: "Automação Placeholder 01",
    mensagem: "Execução concluída — 240 registros processados em 3,2 s.",
  },
  {
    id: "log-1037",
    nivel: "aviso",
    horario: "08:58:19",
    automacao: "Automação Placeholder 03",
    mensagem: "Automação pausada manualmente pelo responsável.",
  },
  {
    id: "log-1036",
    nivel: "erro",
    horario: "08:00:30",
    automacao: "Automação Placeholder 03",
    mensagem: "Credencial expirada — renove a integração nas configurações.",
  },
  {
    id: "log-1035",
    nivel: "info",
    horario: "07:45:12",
    automacao: "Automação Placeholder 02",
    mensagem: "Webhook recebido com payload de 4,2 KB.",
  },
];

export const rotuloNivel: Record<NivelLog, string> = {
  info: "Info",
  aviso: "Aviso",
  erro: "Erro",
};

export type Agendamento = {
  id: string;
  automacao: string;
  quando: string;
  gatilho: string;
};

/** Próximas execuções agendadas. */
export const proximasExecucoes: Agendamento[] = [
  {
    id: "age-01",
    automacao: "Automação Placeholder 01",
    quando: "em 6 min",
    gatilho: "Agendamento · a cada 15 min",
  },
  {
    id: "age-02",
    automacao: "Automação Placeholder 05",
    quando: "em 24 min",
    gatilho: "Evento · janela de sincronização",
  },
  {
    id: "age-03",
    automacao: "Automação Placeholder 04",
    quando: "amanhã 08:00",
    gatilho: "Manual · execução programada",
  },
];

/** Principais motivos de falha no período (últimos 30 dias). */
export const causasErro: { rotulo: string; total: number }[] = [
  { rotulo: "Tempo limite excedido", total: 74 },
  { rotulo: "Credencial expirada", total: 41 },
  { rotulo: "Resposta 4xx do destino", total: 33 },
  { rotulo: "Payload inválido", total: 18 },
];

/** Distribuição de execuções por tipo de gatilho (últimos 30 dias). */
export const disparosPorGatilho: { rotulo: string; total: number }[] = [
  { rotulo: "Cron · Python", total: 3_120 },
  { rotulo: "Webhook · n8n", total: 2_460 },
  { rotulo: "Agendamento · n8n", total: 1_180 },
  { rotulo: "Manual", total: 214 },
];

export function iniciais(nome: string) {
  return nome
    .split(" ")
    .filter((parte) => /[a-zà-ú]/i.test(parte))
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
}
