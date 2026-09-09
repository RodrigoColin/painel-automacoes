"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { clsx } from "@/lib/clsx";
import { criarAutomacao } from "@/lib/acoes";
import {
  PRESETS_CRON,
  TIPOS_AUTOMACAO,
  configPadraoN8n,
  configPadraoPython,
  gatilhoDe,
  rotuloModoDisparo,
  validarCron,
  type ConfigAutomacao,
  type ConfigN8n,
  type ConfigPythonCron,
  type ModoDisparoN8n,
  type TipoAutomacao,
} from "@/lib/automacao-tipos";
import { IconCodigo, IconFluxo } from "@/components/icons";
import { Field, FormSection, Input, Select, SwitchField, Textarea } from "@/components/form";
import { Badge, Button, classesBotao } from "@/components/ui";

type Erros = Record<string, string | undefined>;

const ICONE_TIPO = {
  "python-cron": IconCodigo,
  n8n: IconFluxo,
} as const;

type WorkflowOpcao = { id: string; nome: string; ativo: boolean };

export function FormNovaAutomacao({
  responsavel,
  workflows,
  erroWorkflows,
}: {
  responsavel: string;
  /** Workflows do n8n ainda não vinculados a nenhuma automação. */
  workflows: WorkflowOpcao[];
  /** Preenchido quando não foi possível listar — some o seletor, entra o aviso. */
  erroWorkflows: string | null;
}) {
  const router = useRouter();

  const [tipo, setTipo] = useState<TipoAutomacao>("python-cron");
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ativarAgora, setAtivarAgora] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  // Cada motor guarda a própria configuração: alternar entre os tipos não
  // apaga o que já foi preenchido no outro.
  const [python, setPython] = useState<ConfigPythonCron>(configPadraoPython);
  const [n8n, setN8n] = useState<ConfigN8n>(configPadraoN8n);

  const [erros, setErros] = useState<Erros>({});

  const configAtual: ConfigAutomacao =
    tipo === "python-cron"
      ? { tipo: "python-cron", config: python }
      : { tipo: "n8n", config: n8n };

  function validar(): Erros {
    const novos: Erros = {};

    if (!nome.trim()) novos.nome = "Informe o nome da automação.";

    if (tipo === "python-cron") {
      const erroCron = validarCron(python.cron);
      if (erroCron) novos.cronPython = erroCron;
      if (!python.entrada.trim()) {
        novos.entrada = "Informe o arquivo Python que será executado.";
      }
      if (!Number.isFinite(python.timeoutSegundos) || python.timeoutSegundos < 1) {
        novos.timeout = "O tempo limite precisa ser de pelo menos 1 segundo.";
      }
    } else {
      if (!n8n.workflowId.trim()) {
        novos.workflowId = "Escolha o workflow no n8n.";
      }
      if (n8n.modoDisparo === "agendado") {
        const erroCron = validarCron(n8n.cron);
        if (erroCron) novos.cronN8n = erroCron;
      }
    }

    return novos;
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    const novos = validar();
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    const comum = {
      nome: nome.trim(),
      descricao: descricao.trim() || "Sem descrição.",
      status: ativarAgora ? ("ativa" as const) : ("rascunho" as const),
    };

    setEnviando(true);
    setErroEnvio(null);

    // Montado em dois ramos (e não por spread da união) para o TypeScript
    // conseguir casar `tipo` com o formato de `config`.
    const resultado = await criarAutomacao(
      tipo === "python-cron"
        ? { ...comum, tipo: "python-cron", config: python }
        : { ...comum, tipo: "n8n", config: n8n },
    );

    setEnviando(false);

    if (resultado.erro) {
      setErroEnvio(resultado.erro);
      return;
    }

    router.push("/automacoes");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="space-y-8" noValidate>
      {/* ------------------------------ Tipo ------------------------------ */}
      <SeletorTipo tipo={tipo} onSelecionar={setTipo} />

      {/* --------------------------- Identificação ------------------------- */}
      <FormSection
        title="Identificação"
        description="Como a automação aparece nas listagens e no histórico."
      >
        <Field label="Nome" required error={erros.nome}>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Sincronizar pedidos do ERP"
            aria-invalid={Boolean(erros.nome)}
          />
        </Field>
        <Field label="Descrição" hint="Uma linha explicando o que a automação faz.">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: Busca pedidos novos e grava no banco."
          />
        </Field>
        {/* Quem cria é o responsável — a Server Action grava o vínculo. */}
        <Field label="Responsável">
          <Input value={responsavel} readOnly disabled />
        </Field>
      </FormSection>

      {/* ------------------------ Configuração: Python --------------------- */}
      {tipo === "python-cron" ? (
        <FormSection
          title="Execução do script"
          description="O agendador do painel roda o arquivo Python no intervalo definido."
        >
          <CampoCron
            label="Agendamento"
            valor={python.cron}
            erro={erros.cronPython}
            onChange={(cron) => setPython({ ...python, cron })}
          />
          <Field
            label="Arquivo de entrada"
            hint="Caminho relativo à raiz do repositório da automação."
            required
            error={erros.entrada}
          >
            <Input
              value={python.entrada}
              onChange={(e) => setPython({ ...python, entrada: e.target.value })}
              placeholder="scripts/sincronizar_pedidos.py"
              className="font-mono text-xs"
              aria-invalid={Boolean(erros.entrada)}
            />
          </Field>
          <Field
            label="Tempo limite por execução"
            hint="Em segundos."
            layout="inline"
            error={erros.timeout}
          >
            <Input
              value={String(python.timeoutSegundos)}
              onChange={(e) =>
                setPython({
                  ...python,
                  timeoutSegundos: Number(e.target.value.replace(/\D/g, "")),
                })
              }
              inputMode="numeric"
              aria-invalid={Boolean(erros.timeout)}
            />
          </Field>
          <Field label="Tentativas em caso de erro" layout="inline">
            <Select
              options={[
                { valor: "0", rotulo: "Nenhuma" },
                { valor: "1", rotulo: "1 tentativa" },
                { valor: "3", rotulo: "3 tentativas" },
                { valor: "5", rotulo: "5 tentativas" },
              ]}
              value={String(python.tentativas)}
              onChange={(e) =>
                setPython({ ...python, tentativas: Number(e.target.value) })
              }
            />
          </Field>
          <Field
            label="Variáveis de ambiente"
            hint="Uma por linha, no formato CHAVE=valor. Para segredos, referencie o Infisical em vez de escrever o valor."
          >
            <Textarea
              value={python.variaveis}
              onChange={(e) => setPython({ ...python, variaveis: e.target.value })}
              placeholder={
                "API_BASE_URL=https://api.exemplo.com\nAPI_TOKEN={{infisical.API_TOKEN}}"
              }
              rows={4}
            />
          </Field>
          <p className="text-xs text-fg-subtle">
            Segredos são resolvidos a cada execução a partir do{" "}
            <Link
              href="/configuracoes"
              className="font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
            >
              Infisical
            </Link>{" "}
            e ficam mascarados no histórico.
          </p>
        </FormSection>
      ) : (
        /* -------------------------- Configuração: n8n -------------------- */
        <FormSection
          title="Conexão com o n8n"
          description="O workflow roda na instância de n8n conectada pela Proos. O painel dispara e acompanha o resultado das execuções."
        >
          <Field
            label="Workflow"
            hint="Lista apenas os workflows da instância que ainda não foram vinculados a outra automação."
            required
            error={erros.workflowId}
          >
            {erroWorkflows ? (
              <p className="text-xs text-danger">{erroWorkflows}</p>
            ) : workflows.length === 0 ? (
              <p className="text-xs text-fg-muted">
                Todos os workflows da instância já estão vinculados a alguma
                automação.
              </p>
            ) : (
              <Select
                value={n8n.workflowId}
                onChange={(e) => setN8n({ ...n8n, workflowId: e.target.value })}
                aria-invalid={Boolean(erros.workflowId)}
                options={[
                  { valor: "", rotulo: "Selecione um workflow…" },
                  ...workflows.map((workflow) => ({
                    valor: workflow.id,
                    // O inativo continua na lista, mas rotulado: vincular um
                    // workflow desligado é válido, só não vai registrar nada
                    // enquanto ninguém o ativar no n8n.
                    rotulo: workflow.ativo
                      ? workflow.nome
                      : `${workflow.nome} · inativo no n8n`,
                  })),
                ]}
              />
            )}
          </Field>
          <Field
            label="Modo de disparo"
            hint="Como a execução do workflow é iniciada."
            layout="inline"
          >
            <Select
              options={(["webhook", "agendado", "manual"] as ModoDisparoN8n[]).map(
                (modo) => ({ valor: modo, rotulo: rotuloModoDisparo[modo] })
              )}
              value={n8n.modoDisparo}
              onChange={(e) =>
                setN8n({ ...n8n, modoDisparo: e.target.value as ModoDisparoN8n })
              }
            />
          </Field>
          {n8n.modoDisparo === "agendado" ? (
            <CampoCron
              label="Agendamento"
              valor={n8n.cron}
              erro={erros.cronN8n}
              onChange={(cron) => setN8n({ ...n8n, cron })}
            />
          ) : null}
          <SwitchField
            label="Aguardar a resposta do workflow"
            hint="Mantém a execução aberta até o n8n concluir, registrando a saída no histórico."
            checked={n8n.aguardarResposta}
            onChange={(v) => setN8n({ ...n8n, aguardarResposta: v })}
          />
          <p className="text-xs text-fg-subtle">
            A chave de API da instância e as credenciais usadas pelo workflow vêm
            de{" "}
            <Link
              href="/configuracoes"
              className="font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
            >
              Configurações
            </Link>{" "}
            — a conexão no n8n e os segredos no Infisical.
          </p>
        </FormSection>
      )}

      {/* ----------------------------- Publicação -------------------------- */}
      <FormSection
        title="Publicação"
        description="Estado inicial da automação depois de criada."
      >
        <SwitchField
          label="Ativar imediatamente"
          hint="Desligado, a automação é criada como rascunho e não dispara."
          checked={ativarAgora}
          onChange={setAtivarAgora}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">
            Gatilho resultante:{" "}
            <span className="font-mono text-fg-muted">{gatilhoDe(configAtual)}</span>
          </p>
          <Badge tone="outline">{TIPOS_AUTOMACAO.find((t) => t.id === tipo)?.rotulo}</Badge>
        </div>
      </FormSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-6">
        {erroEnvio ? (
          <p role="alert" className="mr-auto text-sm text-danger">
            {erroEnvio}
          </p>
        ) : null}
        <Link href="/automacoes" className={classesBotao("ghost")}>
          Cancelar
        </Link>
        <Button type="submit" variant="primary" disabled={enviando}>
          {enviando ? "Criando…" : "Criar automação"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------ Seletor de tipo --------------------------- */

function SeletorTipo({
  tipo,
  onSelecionar,
}: {
  tipo: TipoAutomacao;
  onSelecionar: (tipo: TipoAutomacao) => void;
}) {
  const grupo = useId();

  return (
    <section className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-8">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Tipo de automação</h2>
        <p className="text-sm text-fg-muted">
          Define o motor de execução e os campos de configuração. Não pode ser
          alterado depois da criação.
        </p>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Tipo de automação</legend>
        {TIPOS_AUTOMACAO.map((opcao) => {
          const Icone = ICONE_TIPO[opcao.id];
          const selecionado = tipo === opcao.id;

          return (
            <label
              key={opcao.id}
              className={clsx(
                "block cursor-pointer rounded-lg border bg-surface p-4 transition-colors",
                "focus-within:ring-2 focus-within:ring-ring",
                selecionado
                  ? "border-fg ring-1 ring-fg"
                  : "border-border hover:border-border-strong hover:bg-surface-muted/40"
              )}
            >
              <input
                type="radio"
                name={grupo}
                value={opcao.id}
                checked={selecionado}
                onChange={() => onSelecionar(opcao.id)}
                className="sr-only"
              />
              <span className="flex items-start gap-3">
                <span
                  className={clsx(
                    "grid size-9 shrink-0 place-items-center rounded-md border",
                    selecionado
                      ? "border-transparent bg-accent text-accent-fg"
                      : "border-border bg-surface-muted text-fg-muted"
                  )}
                >
                  <Icone className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{opcao.rotulo}</span>
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "grid size-4 shrink-0 place-items-center rounded-full border",
                        selecionado
                          ? "border-fg bg-fg"
                          : "border-border-strong bg-surface"
                      )}
                    >
                      <span
                        className={clsx(
                          "size-1.5 rounded-full",
                          selecionado ? "bg-surface" : "bg-transparent"
                        )}
                      />
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-fg-muted">
                    {opcao.resumo}
                  </span>
                  {/* Spans, e não uma <ul>: <label> só aceita conteúdo de frase. */}
                  <span className="mt-3 block space-y-1">
                    {opcao.detalhes.map((detalhe) => (
                      <span
                        key={detalhe}
                        className="flex gap-2 text-xs text-fg-subtle"
                      >
                        <span aria-hidden="true">·</span>
                        {detalhe}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}

/* -------------------------------- Campo cron ------------------------------ */

function CampoCron({
  label,
  valor,
  erro,
  onChange,
}: {
  label: string;
  valor: string;
  erro?: string;
  onChange: (valor: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Field
        label={label}
        hint="Expressão cron de 5 campos: minuto, hora, dia, mês e dia da semana."
        required
        error={erro}
      >
        <Input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder="*/15 * * * *"
          className="font-mono text-xs"
          aria-invalid={Boolean(erro)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {PRESETS_CRON.map((preset) => (
          <button
            key={preset.expressao}
            type="button"
            onClick={() => onChange(preset.expressao)}
            aria-pressed={valor.trim() === preset.expressao}
            className={clsx(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              valor.trim() === preset.expressao
                ? "border-fg bg-accent text-accent-fg"
                : "border-border-strong text-fg-muted hover:bg-surface-muted hover:text-fg"
            )}
          >
            {preset.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
