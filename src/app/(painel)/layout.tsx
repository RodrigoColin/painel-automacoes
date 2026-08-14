import { Sidebar } from "@/components/sidebar";
import { verificarSessao } from "@/lib/dal";

/**
 * Casca do painel. O `verificarSessao` aqui é a barreira que vale: o
 * `proxy.ts` faz triagem otimista, mas é neste ponto — junto dos dados — que
 * a sessão é de fato validada antes de qualquer tela renderizar.
 */
export default async function PainelLayout({
  children,
}: LayoutProps<"/">) {
  await verificarSessao();

  return (
    <div className="lg:flex">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
