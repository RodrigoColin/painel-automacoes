"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { solicitarRedefinicao, type EstadoEsqueciSenha } from "./acoes";

const ESTADO_INICIAL: EstadoEsqueciSenha = {};

export function FormularioEsqueciSenha() {
  const [estado, acao, enviando] = useActionState(
    solicitarRedefinicao,
    ESTADO_INICIAL,
  );

  if (estado.enviado) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-fg">
          Se houver uma conta com esse e-mail, enviamos um link para
          redefinir a senha. Confira também a caixa de spam.
        </p>
        <Link href="/login" className="font-medium text-accent hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-4">
      <Field label="E-mail" required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@empresa.com.br"
          required
        />
      </Field>

      {estado.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={enviando} className="w-full">
        {enviando ? "Enviando…" : "Enviar link de redefinição"}
      </Button>

      <Link
        href="/login"
        className="block text-center text-sm text-fg-muted hover:text-fg"
      >
        Voltar para o login
      </Link>
    </form>
  );
}
