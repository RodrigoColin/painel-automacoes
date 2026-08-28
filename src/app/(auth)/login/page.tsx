import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Entrar · Painel" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold text-fg">Painel de Automações</h1>
          <p className="text-sm text-fg-muted">
            Entre para acompanhar suas automações.
          </p>
        </div>

        <Card className="p-6 space-y-4">
          {erro === "link-invalido" ? (
            <p role="alert" className="text-sm text-danger">
              Esse link expirou ou já foi usado. Peça um novo link de
              redefinição de senha.
            </p>
          ) : null}

          {/* `useSearchParams` no formulário exige limite de Suspense. */}
          <Suspense fallback={<div className="h-64" />}>
            <FormularioLogin />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
