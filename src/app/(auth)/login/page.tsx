import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { lerSessao } from "@/lib/auth/sessao";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Entrar · Painel" };

export default async function LoginPage() {
  // Aqui e não no proxy: o proxy só enxerga o cookie, e um cookie de sessão
  // vencida mandaria para o /dashboard, que devolveria para cá — em laço.
  if (await lerSessao()) redirect("/dashboard");

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
          {/* `useSearchParams` no formulário exige limite de Suspense. */}
          <Suspense fallback={<div className="h-64" />}>
            <FormularioLogin />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
