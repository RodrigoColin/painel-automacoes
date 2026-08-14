import { Sidebar } from "@/components/sidebar";
import { empresaAtual, empresasDoUsuario, verificarSessao } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Casca do painel. O `verificarSessao` aqui é a barreira que vale: o
 * `proxy.ts` faz triagem otimista, mas é neste ponto — junto dos dados — que
 * a sessão é de fato validada antes de qualquer tela renderizar.
 */
export default async function PainelLayout({ children }: LayoutProps<"/">) {
  const sessao = await verificarSessao();
  const [empresas, selecionada] = await Promise.all([
    empresasDoUsuario(),
    lerEmpresaSelecionada(),
  ]);
  const atual = await empresaAtual(selecionada);

  const supabase = await criarClienteServidor();
  const { data: perfil } = await supabase
    .from("perfis")
    .select("nome")
    .eq("id", sessao.userId)
    .single();

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
