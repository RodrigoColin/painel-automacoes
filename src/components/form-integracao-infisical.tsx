"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Field, Input, Select, SwitchField } from "@/components/form";
import { salvarIntegracaoInfisical } from "@/lib/acoes";

/**
 * Conexão única, compartilhada por todos os clientes — só quem administra a
 * Admin enxerga esta tela (a página só renderiza este componente para
 * admins da plataforma).
 *
 * O Client Secret nunca volta do servidor: uma vez salvo, o campo fica vazio
 * e só é reenviado se você digitar um novo. Os demais campos vêm de
 * `integracaoAtual`, lida em `integracao_infisical_plataforma` (sem policy
 * só para o Client Secret).
 *
 * Os dois switches (injetar/mascarar) são salvos junto com a conexão — igual
 * ao resto do formulário, mudar qualquer coisa aqui exige reenviar o Client
 * Secret. É a mesma exigência que a integração com o n8n já tem. O isolamento
 * entre clientes não é feito aqui: vem do caminho de cada empresa, definido
 * em "Clientes".
 */
export function FormIntegracaoInfisical({
  integracaoAtual,
  conectado,
}: {
  integracaoAtual: {
    siteUrl: string;
    clientId: string;
    projetoId: string;
    ambiente: string;
    injetarSegredos: boolean;
    mascararValores: boolean;
  };
  conectado: boolean;
}) {
  const [siteUrl, setSiteUrl] = useState(integracaoAtual.siteUrl || "https://app.infisical.com");
  const [clientId, setClientId] = useState(integracaoAtual.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [projetoId, setProjetoId] = useState(integracaoAtual.projetoId);
  const [ambiente, setAmbiente] = useState(integracaoAtual.ambiente || "prod");
  const [injetarSegredos, setInjetarSegredos] = useState(
    conectado ? integracaoAtual.injetarSegredos : true,
  );
  const [mascararValores, setMascararValores] = useState(
    conectado ? integracaoAtual.mascararValores : true,
  );
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string } | { tipo: "ok" }
  >({ tipo: "ocioso" });

  async function conectar() {
    setEstado({ tipo: "salvando" });
    const resultado = await salvarIntegracaoInfisical({
      siteUrl,
      clientId,
      clientSecret,
      projetoId,
      ambiente,
      injetarSegredos,
      mascararValores,
    });

    if (resultado.erro) {
      setEstado({ tipo: "erro", msg: resultado.erro });
      return;
    }
    setClientSecret("");
    setEstado({ tipo: "ok" });
  }

  const podeConectar =
    estado.tipo !== "salvando" && siteUrl && clientId && clientSecret && projetoId;

  return (
    <div className="space-y-5">
      <Field
        layout="inline"
        label="URL da instância"
        hint="Infisical Cloud ou instância auto-hospedada, sem barra no final."
      >
        <Input
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          placeholder="https://app.infisical.com"
          autoComplete="off"
        />
      </Field>

      <Field
        layout="inline"
        label="Client ID"
        hint="Machine Identity com permissão de leitura no projeto."
      >
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
        />
      </Field>

      <Field
        layout="inline"
        label="Client Secret"
        hint={
          conectado
            ? "Já existe um Client Secret salvo. Preencha apenas para substituí-lo."
            : "Gerado no Infisical em Identity → Universal Auth → Create Client Secret."
        }
      >
        <Input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="off"
        />
      </Field>

      <Field
        layout="inline"
        label="ID do projeto"
        hint="Encontrado no Infisical em Project Settings → Project ID."
      >
        <Input
          value={projetoId}
          onChange={(e) => setProjetoId(e.target.value)}
          placeholder="7c1f0a2e-…"
          autoComplete="off"
        />
      </Field>

      <Field layout="inline" label="Ambiente" hint="Slug do ambiente lido pelas automações.">
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

      <div className="space-y-4 border-t border-border pt-5">
        <SwitchField
          label="Injetar segredos nas execuções"
          hint={
            'Resolve "{{infisical.NOME}}" nas variáveis de ambiente das automações Python no momento de rodar.'
          }
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
            "Conexão testada e credenciais salvas."
          ) : (
            "Os segredos são buscados a cada execução — revogar no Infisical interrompe o acesso na hora."
          )}
        </p>
        <Button variant="primary" onClick={conectar} disabled={!podeConectar}>
          {estado.tipo === "salvando" ? "Testando…" : conectado ? "Atualizar" : "Conectar"}
        </Button>
      </div>
    </div>
  );
}
