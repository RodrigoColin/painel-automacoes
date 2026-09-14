"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { criarPastaInfisicalCliente } from "@/lib/acoes";

/**
 * Pasta de cada empresa cliente no projeto Infisical da Proos — é o que
 * isola a Scopo da Oystr dentro do mesmo projeto. O app cria a pasta (em
 * `<pasta raiz>/<nome>`); aqui só se vê o caminho e se cria a que falta.
 * Empresas novas já ganham a pasta no cadastro, quando o Infisical está
 * configurado.
 */
export function FormCaminhosClientes({
  clientes,
  habilitado,
}: {
  clientes: { id: string; nome: string; caminho: string }[];
  /** Falso enquanto o Infisical não está configurado. */
  habilitado: boolean;
}) {
  if (clientes.length === 0) {
    return <p className="text-sm text-fg-muted">Nenhuma empresa cliente cadastrada ainda.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {clientes.map((cliente) => (
        <LinhaCliente key={cliente.id} cliente={cliente} habilitado={habilitado} />
      ))}
    </ul>
  );
}

function LinhaCliente({
  cliente,
  habilitado,
}: {
  cliente: { id: string; nome: string; caminho: string };
  habilitado: boolean;
}) {
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "criando" } | { tipo: "erro"; msg: string }
  >({ tipo: "ocioso" });

  async function criar() {
    setEstado({ tipo: "criando" });
    const resultado = await criarPastaInfisicalCliente(cliente.id);
    setEstado(resultado.erro ? { tipo: "erro", msg: resultado.erro } : { tipo: "ocioso" });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{cliente.nome}</p>
        {estado.tipo === "erro" ? (
          <p role="alert" className="text-xs text-danger">
            {estado.msg}
          </p>
        ) : cliente.caminho ? (
          <p className="truncate font-mono text-xs text-fg-muted">{cliente.caminho}</p>
        ) : (
          <p className="text-xs text-fg-subtle">Pasta ainda não criada.</p>
        )}
      </div>
      {cliente.caminho ? null : (
        <Button
          variant="secondary"
          onClick={criar}
          disabled={!habilitado || estado.tipo === "criando"}
          className="shrink-0"
        >
          {estado.tipo === "criando" ? "Criando…" : "Criar pasta"}
        </Button>
      )}
    </li>
  );
}
