import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { FormularioEsqueciSenha } from "./formulario";

export const metadata: Metadata = { title: "Esqueci minha senha · Painel" };

export default function EsqueciSenhaPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold text-fg">Redefinir senha</h1>
          <p className="text-sm text-fg-muted">
            Informe seu e-mail para receber um link de redefinição.
          </p>
        </div>

        <Card className="p-6">
          <FormularioEsqueciSenha />
        </Card>
      </div>
    </div>
  );
}
