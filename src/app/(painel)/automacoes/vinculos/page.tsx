import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BotaoAtualizarN8n, VinculosAutomacoes } from "@/components/vinculos-automacoes";
import { PageHeader } from "@/components/ui";
import { empresasDoUsuario, souAdminPlataforma, verificarSessao } from "@/lib/dal";
import { listarVinculos } from "@/lib/consultas";

export const metadata: Metadata = { title: "Vínculos · Painel" };

/**
 * Atribui a empresa dona de cada workflow vindo do n8n.
 *
 * Os workflows chegam sozinhos pela sincronização, sempre na empresa
 * principal. Esta tela é o único lugar onde essa atribuição muda — e mudar
 * leva o histórico junto, então o cliente passa a ver as execuções passadas
 * do workflow, não só as próximas.
 */
export default async function VinculosPage() {
  await verificarSessao();

  // Atribuir dono é decisão de plataforma: um cliente não escolhe o que é dele.
  if (!(await souAdminPlataforma())) redirect("/automacoes");

  const [vinculos, empresas] = await Promise.all([
    listarVinculos(),
    empresasDoUsuario(),
  ]);

  return (
    <>
      <div className="text-xs text-fg-subtle">
        <Link href="/automacoes" className="hover:text-fg">
          Automações
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-fg-muted">Vínculos</span>
      </div>

      <PageHeader
        title="Vínculos com empresas"
        description="Todo workflow do n8n aparece aqui automaticamente, na Proos. Atribua a empresa cliente correspondente — o histórico acompanha a mudança."
        actions={<BotaoAtualizarN8n />}
      />

      <VinculosAutomacoes
        vinculos={vinculos}
        empresas={empresas.map((empresa) => ({
          id: empresa.id,
          nome: empresa.nome,
          ehPlataforma: empresa.eh_plataforma,
        }))}
      />
    </>
  );
}
