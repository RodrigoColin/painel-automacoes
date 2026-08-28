import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { FormularioAtualizarSenha } from "./formulario";

export const metadata: Metadata = { title: "Atualizar senha · Painel" };

export default function AtualizarSenhaPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold text-fg">Escolha uma nova senha</h1>
          <p className="text-sm text-fg-muted">
            Sua nova senha substitui a anterior imediatamente.
          </p>
        </div>

        <Card className="p-6">
          <FormularioAtualizarSenha />
        </Card>
      </div>
    </div>
  );
}
