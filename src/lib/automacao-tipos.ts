/**
 * Tipos de automação suportados pelo painel.
 *
 * Toda automação nasce escolhendo um destes dois motores de execução, e a
 * escolha define quais campos de configuração aparecem no formulário:
 *
 * - `python-cron`: script Python executado pelo agendador do próprio painel.
 * - `n8n`: workflow que já existe numa instância n8n conectada.
 */

export type TipoAutomacao = "python-cron" | "n8n";

export type ConfigPythonCron = {
  /** Expressão cron de 5 campos (min hora dia mês dia-da-semana). */
  cron: string;
  entrada: string;
  timeoutSegundos: number;
  tentativas: number;
  /** Variáveis de ambiente no formato `CHAVE=valor`, uma por linha. */
  variaveis: string;
};

/**
 * `monitorado` é o oposto dos demais: nele o painel não dispara nada. O
 * workflow tem gatilho próprio no n8n (tipicamente um Schedule Trigger), e o
 * painel apenas espelha o histórico de execuções pela API. Serve para vincular
 * automações que já rodam em produção sem precisar editá-las.
 */
export type ModoDisparoN8n = "webhook" | "agendado" | "manual" | "monitorado";

export type ConfigN8n = {
  /** Vazio quando `monitorado`: a URL vem da integração da empresa. */
  instanciaUrl: string;
  workflowId: string;
  modoDisparo: ModoDisparoN8n;
  /** Usado apenas quando `modoDisparo` é `agendado`. */
  cron: string;
  aguardarResposta: boolean;
};

export type ConfigAutomacao =
  | { tipo: "python-cron"; config: ConfigPythonCron }
  | { tipo: "n8n"; config: ConfigN8n };

/* ------------------------------- Catálogo -------------------------------- */

export type DescricaoTipo = {
  id: TipoAutomacao;
  rotulo: string;
  resumo: string;
  detalhes: string[];
};

export const TIPOS_AUTOMACAO: DescricaoTipo[] = [
  {
    id: "python-cron",
    rotulo: "Cron job com Python",
    resumo: "O painel executa um script Python em um horário agendado.",
    detalhes: [
      "Agendamento por expressão cron",
      "Dependências e variáveis de ambiente próprias",
      "Logs e saída capturados pelo painel",
    ],
  },
  {
    id: "n8n",
    rotulo: "Workflow no n8n",
    resumo: "O painel dispara e acompanha um workflow já criado no n8n.",
    detalhes: [
      "Reaproveita workflows e credenciais existentes",
      "Disparo por webhook, agendamento ou manual",
      "Edição visual continua no editor do n8n",
    ],
  },
];

export const rotuloTipo: Record<TipoAutomacao, string> = {
  "python-cron": "Python · cron",
  n8n: "n8n",
};

export const rotuloModoDisparo: Record<ModoDisparoN8n, string> = {
  webhook: "Webhook",
  agendado: "Agendado",
  manual: "Manual",
  monitorado: "Monitorado",
};

/* -------------------------------- Padrões -------------------------------- */

export const configPadraoPython: ConfigPythonCron = {
  cron: "*/15 * * * *",
  entrada: "",
  timeoutSegundos: 300,
  tentativas: 3,
  variaveis: "",
};

export const configPadraoN8n: ConfigN8n = {
  instanciaUrl: "",
  workflowId: "",
  modoDisparo: "webhook",
  cron: "0 8 * * *",
  aguardarResposta: true,
};

export const PRESETS_CRON: { rotulo: string; expressao: string }[] = [
  { rotulo: "A cada 15 min", expressao: "*/15 * * * *" },
  { rotulo: "De hora em hora", expressao: "0 * * * *" },
  { rotulo: "Diariamente 08:00", expressao: "0 8 * * *" },
  { rotulo: "Segunda 09:00", expressao: "0 9 * * 1" },
];

/* ------------------------------- Validação ------------------------------- */

const CAMPO_CRON = /^[0-9*/,-]+$/;

/**
 * Validação estrutural da expressão cron: 5 campos com caracteres válidos.
 * Não substitui a validação do agendador, apenas evita erro óbvio de digitação.
 */
export function validarCron(expressao: string): string | null {
  const campos = expressao.trim().split(/\s+/).filter(Boolean);
  if (campos.length === 0) return "Informe a expressão cron.";
  if (campos.length !== 5) {
    return "A expressão cron precisa ter 5 campos: minuto, hora, dia, mês e dia da semana.";
  }
  if (!campos.every((campo) => CAMPO_CRON.test(campo))) {
    return "Use apenas números e os caracteres * / , - em cada campo.";
  }
  return null;
}

/** Texto de gatilho exibido nas listagens, derivado da configuração. */
export function gatilhoDe(entrada: ConfigAutomacao): string {
  if (entrada.tipo === "python-cron") {
    return `Cron · ${entrada.config.cron}`;
  }
  switch (entrada.config.modoDisparo) {
    case "webhook":
      return "Webhook · n8n";
    case "agendado":
      return `Agendamento · ${entrada.config.cron}`;
    case "manual":
      return "Manual · n8n";
    case "monitorado":
      return "Agendado no n8n";
  }
}
