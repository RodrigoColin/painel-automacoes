"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Field, Input, Select, SwitchField } from "@/components/form";
import { salvarConfiguracaoInfisical } from "@/lib/acoes";

/**
 * Configuração do Infisical da plataforma — só aparece para admin da Proos,
 * com a Proos selecionada.
 *
 * Não há campo de credencial: Client ID e Client Secret vêm das variáveis de
 * ambiente da aplicação. Aqui se escolhe onde o app trabalha dentro do
 * Infisical (projeto, ambiente, pasta raiz dos clientes) e como os segredos
 * são usados nas execuções. Salvar testa a conexão antes de gravar.
 */
export function FormIntegracaoInfisical({
  configAtual,
  siteUrl,
  variaveisFaltando,
}: {
  configAtual: {
    projetoId: string;
    ambiente: string;
    pastaRaiz: string;
    injetarSegredos: boolean;
    mascararValores: boolean;
  } | null;
  siteUrl: string;
  variaveisFaltando: string[];
}) {
  const [projetoId, setProjetoId] = useState(configAtual?.projetoId ?? "");
  const [ambiente, setAmbiente] = useState(configAtual?.ambiente ?? "prod");
  const [pastaRaiz, setPastaRaiz] = useState(configAtual?.pastaRaiz ?? "/clientes");
  const [injetarSegredos, setInjetarSegredos] = useState(configAtual?.injetarSegredos ?? true);
  const [mascararValores, setMascararValores] = useState(configAtual?.mascararValores ?? true);
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string } | { tipo: "ok" }
  >({ tipo: "ocioso" });

  const semVariaveis = variaveisFaltando.length > 0;

  async function salvar() {
    setEstado({ tipo: "salvando" });
    const resultado = await salvarConfiguracaoInfisical({
      projetoId,
      ambiente,
      pastaRaiz,
      injetarSegredos,
      mascararValores,
    });

    setEstado(resultado.erro ? { tipo: "erro", msg: resultado.erro } : { tipo: "ok" });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2.5 text-xs">
        {semVariaveis ? (
          <p className="text-danger">
            Faltam variáveis de ambiente na aplicação:{" "}
            <span className="font-mono">{variaveisFaltando.join(", ")}</span>. Cadastre-as no
            projeto da Vercel (ou no <span className="font-mono">.env.local</span>) e reinicie o
            servidor.
          </p>
        ) : (
          <p className="text-fg-muted">
            Credenciais lidas das variáveis de ambiente · instância{" "}
            <span className="font-mono">{siteUrl}</span>
          </p>
        )}
      </div>

      <Field
        layout="inline"
        label="ID do projeto"
        hint="No Infisical, em Project Settings → Project ID."
      >
        <Input
          value={projetoId}
          onChange={(e) => setProjetoId(e.target.value)}
          placeholder="7c1f0a2e-…"
          autoComplete="off"
          className="font-mono text-xs"
        />
      </Field>

      <Field layout="inline" label="Ambiente" hint="Onde as pastas e chaves dos clientes ficam.">
        <Select
          value={ambiente}
          onChange={(e) => setAmbiente(e.target.value)}
          options={[
            { valor: "prod", rotulo: "Produção (prod)" },
            { valor: "staging", rotulo: "Homologação (staging)" },
            { valor: "dev", rotulo: "Desenvolvimento (dev)" },
          ]}
        />
      </Field>

      <Field
        layout="inline"
        label="Pasta raiz dos clientes"
        hint="O app cria uma pasta por cliente aqui dentro, como /clientes/scopo."
      >
        <Input
          value={pastaRaiz}
          onChange={(e) => setPastaRaiz(e.target.value)}
          placeholder="/clientes"
          autoComplete="off"
          className="font-mono text-xs"
        />
      </Field>

      <div className="space-y-4 border-t border-border pt-5">
        <SwitchField
          label="Injetar segredos nas execuções"
          hint={'Resolve "{{infisical.NOME}}" nas automações no momento de rodar.'}
          checked={injetarSegredos}
          onChange={setInjetarSegredos}
        />
        <SwitchField
          label="Mascarar valores no histórico"
          hint="Substitui qualquer valor de segredo resolvido por ••• nas mensagens gravadas no histórico de execuções."
          checked={mascararValores}
          onChange={setMascararValores}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-fg-subtle">
          {estado.tipo === "erro" ? (
            <span role="alert" className="text-danger">
              {estado.msg}
            </span>
          ) : estado.tipo === "ok" ? (
            "Conexão testada e configuração salva."
          ) : (
            "Salvar testa se as credenciais do ambiente enxergam o projeto e o ambiente escolhidos."
          )}
        </p>
        <Button
          variant="primary"
          onClick={salvar}
          disabled={estado.tipo === "salvando" || semVariaveis || !projetoId.trim()}
        >
          {estado.tipo === "salvando" ? "Testando…" : configAtual ? "Atualizar" : "Salvar e conectar"}
        </Button>
      </div>
    </div>
  );
}
