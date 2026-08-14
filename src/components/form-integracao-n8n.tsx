"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { salvarIntegracaoN8n } from "@/lib/acoes";

/**
 * A chave de API nunca volta do servidor: uma vez salva, o campo fica vazio e
 * só é reenviado se você digitar uma nova. `urlAtual` existe para você ver a
 * qual instância a empresa está ligada sem expor a credencial.
 */
export function FormIntegracaoN8n({
  urlAtual,
  conectado,
}: {
  urlAtual: string;
  conectado: boolean;
}) {
  const [instanciaUrl, setInstanciaUrl] = useState(urlAtual);
  const [apiKey, setApiKey] = useState("");
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string } | { tipo: "ok" }
  >({ tipo: "ocioso" });

  async function conectar() {
    setEstado({ tipo: "salvando" });
    const resultado = await salvarIntegracaoN8n({ instanciaUrl, apiKey });

    if (resultado.erro) {
      setEstado({ tipo: "erro", msg: resultado.erro });
      return;
    }
    setApiKey("");
    setEstado({ tipo: "ok" });
  }

  return (
    <>
      <Field
        layout="inline"
        label="URL da instância"
        hint="Endereço do editor, sem barra no final."
      >
        <Input
          value={instanciaUrl}
          onChange={(e) => setInstanciaUrl(e.target.value)}
          placeholder="https://n8n.suaempresa.com"
        />
      </Field>

      <Field
        layout="inline"
        label="Chave de API"
        hint={
          conectado
            ? "Já existe uma chave salva. Preencha apenas para substituí-la."
            : "Gerada no n8n em Settings → n8n API."
        }
      >
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="off"
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          {estado.tipo === "erro" ? (
            <span role="alert" className="text-danger">
              {estado.msg}
            </span>
          ) : estado.tipo === "ok" ? (
            "Conexão testada e credenciais salvas."
          ) : (
            "A conexão vale apenas para a empresa selecionada no painel."
          )}
        </p>
        <Button
          variant="primary"
          onClick={conectar}
          disabled={estado.tipo === "salvando" || !instanciaUrl || !apiKey}
        >
          {estado.tipo === "salvando" ? "Testando…" : conectado ? "Atualizar" : "Conectar"}
        </Button>
      </div>
    </>
  );
}
