"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { entrar, type EstadoLogin } from "./acoes";

const ESTADO_INICIAL: EstadoLogin = {};

export function FormularioLogin() {
  const [estado, acao, enviando] = useActionState(entrar, ESTADO_INICIAL);
  const proximo = useSearchParams().get("proximo") ?? "";

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="proximo" value={proximo} />

      <Field label="E-mail" required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@empresa.com.br"
          required
        />
      </Field>

      <Field label="Senha" required>
        <Input
          name="senha"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Link
        href="/esqueci-senha"
        className="block text-right text-sm text-fg-muted hover:text-fg"
      >
        Esqueci minha senha
      </Link>

      {estado.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={enviando} className="w-full">
        {enviando ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
