"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { atualizarNomeEmpresa } from "@/lib/acoes";

/** Renomeia a empresa em uso — o nome que aparece na barra lateral e no seletor. */
export function FormNomeEmpresa({
  empresaId,
  nomeAtual,
}: {
  empresaId: string;
  nomeAtual: string;
}) {
  const [nome, setNome] = useState(nomeAtual);
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string } | { tipo: "ok" }
  >({ tipo: "ocioso" });

  async function salvar() {
    setEstado({ tipo: "salvando" });
    const resultado = await atualizarNomeEmpresa({ empresaId, nome });

    if (resultado.erro) {
      setEstado({ tipo: "erro", msg: resultado.erro });
      return;
    }
    setEstado({ tipo: "ok" });
  }

  return (
    <Field
      layout="inline"
      label="Nome do ambiente"
      hint={
        estado.tipo === "erro"
          ? estado.msg
          : estado.tipo === "ok"
            ? "Salvo."
            : "Aparece no topo da barra lateral."
      }
    >
      <div className="flex items-center gap-2">
        <Input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            setEstado({ tipo: "ocioso" });
          }}
          className="min-w-0 flex-1"
        />
        <Button
          variant="secondary"
          onClick={salvar}
          disabled={estado.tipo === "salvando" || !nome.trim() || nome === nomeAtual}
          className="shrink-0"
        >
          {estado.tipo === "salvando" ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </Field>
  );
}
