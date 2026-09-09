import type { Metadata } from "next";
import {
  BotaoNovaAutomacao,
  ListaAutomacoes,
} from "@/components/lista-automacoes";
import Link from "next/link";
import { EmptyHint, PageHeader, classesBotao } from "@/components/ui";
import { empresaAtual, empresasDoUsuario, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarAutomacoes } from "@/lib/consultas";

export const metadata: Metadata = { title: "Automações · Painel" };

export default async function AutomacoesPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const agregando = empresa?.eh_plataforma ?? false;

  // Criar e gerenciar automação é só da Proos; para o cliente esta tela é de
  // acompanhamento. Ver `exigirAdminPlataforma`, que aplica o mesmo nas ações.
  const podeGerenciar = await souAdminPlataforma();

  // A Admin vê as automações de todos os clientes ao mesmo tempo — o
  // seletor de empresa dentro da lista filtra sem precisar recarregar.
  const idsEscopo = agregando
    ? (await empresasDoUsuario()).map((e) => e.id)
    : empresa
      ? [empresa.id]
      : [];

  const automacoes = await listarAutomacoes(idsEscopo);

  return (
    <>
      <PageHeader
        title="Automações"
        description={
          agregando
            ? "Automações de todos os clientes da Proos. Para métricas e disparos, use o dashboard."
            : podeGerenciar
              ? "Crie, configure e gerencie os fluxos do ambiente. Para métricas e disparos, use o dashboard."
              : "Acompanhe os fluxos do ambiente. A criação e a configuração ficam a cargo da Proos."
        }
        actions={
          podeGerenciar ? (
            <>
              <Link href="/automacoes/vinculos" className={classesBotao("secondary")}>
                Vínculos
              </Link>
              <BotaoNovaAutomacao />
            </>
          ) : null
        }
      />

      {empresa ? (
        <ListaAutomacoes
          automacoes={automacoes}
          mostrarEmpresa={agregando}
          podeGerenciar={podeGerenciar}
        />
      ) : (
        <EmptyHint>
          Cadastre uma empresa para começar a criar automações.
        </EmptyHint>
      )}
    </>
  );
}
