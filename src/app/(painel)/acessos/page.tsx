import type { Metadata } from "next";
import { BotaoNovaChave, ListaChaves } from "@/components/acessos-chaves";
import { EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, exigirTela } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarChaves } from "@/lib/consultas";

export const metadata: Metadata = { title: "Acessos e chaves · Painel" };

/**
 * Cofre de credenciais da empresa selecionada.
 *
 * Sem visão agregada, ao contrário de Automações: chave é da empresa, e
 * misturar as de vários clientes numa lista só convidaria a cadastrar no lugar
 * errado. A Proos alcança as de um cliente trocando o seletor de empresa.
 */
export default async function AcessosPage() {
  await exigirTela("acessos");
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

  if (!empresa) {
    return (
      <>
        <PageHeader title="Acessos e chaves" />
        <EmptyHint>Cadastre uma empresa para guardar credenciais.</EmptyHint>
      </>
    );
  }

  const chaves = await listarChaves(empresa.id);
  const podeGerenciar = empresa.papel !== "leitor";

  return (
    <>
      <PageHeader
        title="Acessos e chaves"
        description={`Credenciais de ${empresa.nome}, disponíveis para as automações desta empresa. O valor é gravado uma vez e não volta a ser exibido.`}
        actions={podeGerenciar ? <BotaoNovaChave /> : null}
      />

      <ListaChaves chaves={chaves} podeGerenciar={podeGerenciar} />
    </>
  );
}
