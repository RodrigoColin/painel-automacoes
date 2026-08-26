"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { salvarCaminhoInfisicalCliente } from "@/lib/acoes";

/**
 * Define, por empresa cliente, em qual pasta do projeto Infisical
 * compartilhado os segredos dela vivem — é isso que isola a Scopo da Oystr
 * dentro do mesmo projeto. Só aparece para quem administra a Admin.
 */
export function FormCaminhosClientes({
  clientes,
}: {
  clientes: { id: string; nome: string; caminho: string }[];
}) {
  if (clientes.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Nenhuma empresa cliente cadastrada ainda.
      </p>
    );
  }

  return (
    <>
      {clientes.map((cliente) => (
        <LinhaCliente key={cliente.id} cliente={cliente} />
      ))}
    </>
  );
}

function LinhaCliente({ cliente }: { cliente: { id: string; nome: string; caminho: string } }) {
  const [caminho, setCaminho] = useState(cliente.caminho);
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string } | { tipo: "ok" }
  >({ tipo: "ocioso" });

  async function salvar() {
    setEstado({ tipo: "salvando" });
    const resultado = await salvarCaminhoInfisicalCliente({ empresaId: cliente.id, caminho });

    if (resultado.erro) {
      setEstado({ tipo: "erro", msg: resultado.erro });
      return;
    }
    setEstado({ tipo: "ok" });
  }

  return (
    <Field
      layout="inline"
      label={cliente.nome}
      hint={
        estado.tipo === "erro"
          ? estado.msg
          : estado.tipo === "ok"
            ? "Salvo."
            : "Pasta do projeto Infisical onde os segredos desta empresa ficam."
      }
    >
      <div className="flex items-center gap-2">
        <Input
          value={caminho}
          onChange={(e) => {
            setCaminho(e.target.value);
            setEstado({ tipo: "ocioso" });
          }}
          placeholder={`/clientes/${cliente.nome.toLowerCase()}`}
          className="font-mono text-xs"
        />
        <Button
          variant="secondary"
          onClick={salvar}
          disabled={estado.tipo === "salvando" || !caminho.startsWith("/")}
        >
          {estado.tipo === "salvando" ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </Field>
  );
}
