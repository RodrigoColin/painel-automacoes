import { Sidebar } from "@/components/sidebar";
import { eq } from "drizzle-orm";
import { empresaAtual, empresasDoUsuario, naSessao, verificarSessao } from "@/lib/dal";
import { perfis } from "@/lib/db/schema";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";

/**
 * Casca do painel. O `verificarSessao` aqui é a barreira que vale: o
 * `proxy.ts` faz triagem otimista, mas é neste ponto — junto dos dados — que
 * a sessão é de fato validada antes de qualquer tela renderizar.
 */
export default async function PainelLayout({ children }: LayoutProps<"/">) {
  const sessao = await verificarSessao();
  // O perfil não depende das empresas: roda junto, não depois.
  const [empresas, selecionada, [perfil]] = await Promise.all([
    empresasDoUsuario(),
    lerEmpresaSelecionada(),
    naSessao((tx) =>
      tx.select({ nome: perfis.nome }).from(perfis).where(eq(perfis.id, sessao.userId)),
    ),
  ]);
  const atual = await empresaAtual(selecionada);

  return (
    <div className="lg:flex">
      <Sidebar
        empresas={empresas}
        empresaAtual={atual}
        usuario={{ nome: perfil?.nome || sessao.email, email: sessao.email }}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
