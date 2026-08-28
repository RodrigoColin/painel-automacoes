"use client";

import { useEffect, useState } from "react";
import { IconClose, IconPlus } from "@/components/icons";
import { Button, classesBotao } from "@/components/ui";
import { Field, Input, Select } from "@/components/form";
import { convidarUsuario } from "@/lib/acoes";

type Papel = "admin" | "membro";

/** Botão "Convidar usuário" da tela de Usuários — abre o modal de convite. */
export function BotaoConvidarUsuario({ empresaId }: { empresaId: string }) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={classesBotao("primary")}>
        <IconPlus className="size-4" />
        Convidar usuário
      </button>

      {aberto ? (
        <ModalConvite empresaId={empresaId} onFechar={() => setAberto(false)} />
      ) : null}
    </>
  );
}

function ModalConvite({
  empresaId,
  onFechar,
}: {
  empresaId: string;
  onFechar: () => void;
}) {
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<Papel>("membro");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    const emailLimpo = email.trim();
    if (!emailLimpo.includes("@")) {
      setErro("Informe um e-mail válido.");
      return;
    }

    setEnviando(true);
    const resultado = await convidarUsuario({ empresaId, email: emailLimpo, papel });
    setEnviando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }
    onFechar();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div
        role="presentation"
        onClick={onFechar}
        className="absolute inset-0 bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-convidar-usuario"
        className="relative w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2
              id="titulo-convidar-usuario"
              className="text-sm font-semibold tracking-tight"
            >
              Convidar usuário
            </h2>
            <p className="text-xs text-fg-muted">
              A pessoa recebe um e-mail para definir a senha e acessar esta empresa.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-muted"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-5 py-4">
          <Field label="E-mail" required>
            <Input
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErro(null);
              }}
              type="email"
              placeholder="pessoa@empresa.com.br"
            />
          </Field>

          <Field
            label="Papel"
            hint="Administrador gerencia usuários e configurações; membro trabalha nas automações."
          >
            <Select
              value={papel}
              onChange={(e) => setPapel(e.target.value as Papel)}
              options={[
                { valor: "membro", rotulo: "Membro" },
                { valor: "admin", rotulo: "Administrador" },
              ]}
            />
          </Field>

          {erro ? (
            <p role="alert" className="text-xs text-danger">
              {erro}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar convite"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
