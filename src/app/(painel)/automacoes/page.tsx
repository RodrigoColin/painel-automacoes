import type { Metadata } from "next";
import {
  BotaoNovaAutomacao,
  ListaAutomacoes,
} from "@/components/lista-automacoes";
import { Button, EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual, empresasDoUsuario } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarAutomacoes } from "@/lib/consultas";

export const metadata: Metadata = { title: "Automações · Painel" };

export default async function AutomacoesPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const agregando = empresa?.eh_plataforma ?? false;

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
            ? "Automações de todos os clientes da Admin. Para métricas e disparos, use o dashboard."
            : "Crie, configure e gerencie os fluxos do ambiente. Para métricas e disparos, use o dashboard."
        }
        actions={
          <>
            <Button variant="secondary">Importar</Button>
            <BotaoNovaAutomacao />
          </>
        }
      />

      {empresa ? (
        <ListaAutomacoes automacoes={automacoes} mostrarEmpresa={agregando} />
      ) : (
        <EmptyHint>
          Cadastre uma empresa para começar a criar automações.
        </EmptyHint>
      )}
    </>
  );
}
