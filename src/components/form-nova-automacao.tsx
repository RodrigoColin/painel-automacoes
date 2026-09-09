"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { criarAutomacao } from "@/lib/acoes";
import {
  PRESETS_CRON,
  configPadraoPython,
  gatilhoDe,
  rotuloTipo,
  validarCron,
  type ConfigAutomacao,
  type ConfigPythonCron,
} from "@/lib/automacao-tipos";
import { Field, FormSection, Input, Select, SwitchField, Textarea } from "@/components/form";
import { Badge, Button, classesBotao } from "@/components/ui";

type Erros = Record<string, string | undefined>;

/**
 * Só cria automação Python. Workflow do n8n não se cadastra aqui: ele é
 * descoberto pela sincronização e atribuído a uma empresa na tela de vínculos.
 */
export function FormNovaAutomacao() {
  const router = useRouter();

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ativarAgora, setAtivarAgora] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const [python, setPython] = useState<ConfigPythonCron>(configPadraoPython);

  const [erros, setErros] = useState<Erros>({});

  const configAtual: ConfigAutomacao = { tipo: "python-cron", config: python };

  function validar(): Erros {
    const novos: Erros = {};

    if (!nome.trim()) novos.nome = "Informe o nome da automação.";

    const erroCron = validarCron(python.cron);
    if (erroCron) novos.cronPython = erroCron;
    if (!python.entrada.trim()) {
      novos.entrada = "Informe o arquivo Python que será executado.";
    }
    if (!Number.isFinite(python.timeoutSegundos) || python.timeoutSegundos < 1) {
      novos.timeout = "O tempo limite precisa ser de pelo menos 1 segundo.";
    }

    return novos;
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    const novos = validar();
    setErros(novos);
    if (Object.keys(novos).length > 0) return;

    setEnviando(true);
    setErroEnvio(null);

    const resultado = await criarAutomacao({
      nome: nome.trim(),
      descricao: descricao.trim() || "Sem descrição.",
      status: ativarAgora ? "ativa" : "rascunho",
      tipo: "python-cron",
      config: python,
    });

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
      </FormSection>

      {/* ------------------------ Configuração: Python --------------------- */}
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
          <Badge tone="outline">{rotuloTipo["python-cron"]}</Badge>
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
