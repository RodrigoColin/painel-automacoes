"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { atualizarSenha, type EstadoAtualizarSenha } from "./acoes";

const ESTADO_INICIAL: EstadoAtualizarSenha = {};

export function FormularioAtualizarSenha() {
  const [estado, acao, enviando] = useActionState(
    atualizarSenha,
    ESTADO_INICIAL,
  );

  return (
    <form action={acao} className="space-y-4">
      <Field label="Nova senha" required>
        <Input
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      <Field label="Confirme a nova senha" required>
        <Input
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      {estado.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={enviando} className="w-full">
        {enviando ? "Salvando…" : "Salvar nova senha"}
      </Button>
    </form>
  );
}
