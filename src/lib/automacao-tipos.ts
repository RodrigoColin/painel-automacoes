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

/**
 * Script enviado na criação da automação. O conteúdo fica no bucket privado
 * `automacao-scripts`; aqui vai só o necessário para achá-lo e exibi-lo.
 */
type ArquivoScript = {
  /** Caminho do objeto dentro do bucket: `<automacao_id>/<nome>`. */
  caminho: string;
  nome: string;
  tamanhoBytes: number;
};

export type ConfigPythonCron = {
  /** Expressão cron de 5 campos (min hora dia mês dia-da-semana). */
  cron: string;
  arquivo: ArquivoScript;
  timeoutSegundos: number;
  tentativas: number;
};

/** Teto do script enviado — é também o que o executor Python aceita no corpo. */
export const TAMANHO_MAXIMO_SCRIPT = 1024 * 1024;

/**
 * `monitorado` é o oposto dos demais: nele o painel não dispara nada. O
 * workflow tem gatilho próprio no n8n (tipicamente um Schedule Trigger), e o
 * painel apenas espelha o histórico de execuções pela API. Serve para vincular
 * automações que já rodam em produção sem precisar editá-las.
 */
type ModoDisparoN8n = "webhook" | "agendado" | "manual" | "monitorado";

/**
 * Sem `instanciaUrl`: existe uma única instância de n8n no painel, conectada
 * pela Proos em Configurações e guardada em `integracao_n8n_plataforma`. A
 * automação só aponta qual workflow dessa instância usar — deixar cada uma
 * apontar para uma instância própria permitiria a um cliente disparar contra
 * um n8n arbitrário, fora do que a Proos administra.
 */
export type ConfigN8n = {
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

export const rotuloTipo: Record<TipoAutomacao, string> = {
  "python-cron": "Python · cron",
  n8n: "n8n",
};

/* -------------------------------- Padrões -------------------------------- */

/** Sem `arquivo`: ele só existe depois do upload, feito ao criar a automação. */
export const configPadraoPython: Omit<ConfigPythonCron, "arquivo"> = {
  cron: "*/15 * * * *",
  timeoutSegundos: 300,
  tentativas: 3,
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
