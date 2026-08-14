import type { Metadata } from "next";
import {
  BotaoNovaAutomacao,
  ListaAutomacoes,
} from "@/components/lista-automacoes";
import { Button, EmptyHint, PageHeader } from "@/components/ui";
import { empresaAtual } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarAutomacoes } from "@/lib/consultas";

export const metadata: Metadata = { title: "Automações · Painel" };

export default async function AutomacoesPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const automacoes = empresa ? await listarAutomacoes(empresa.id) : [];

  return (
    <>
      <PageHeader
        title="Automações"
        description="Crie, configure e gerencie os fluxos do ambiente. Para métricas e disparos, use o dashboard."
        actions={
          <>
            <Button variant="secondary">Importar</Button>
            <BotaoNovaAutomacao />
          </>
        }
      />

      {empresa ? (
        <ListaAutomacoes automacoes={automacoes} />
      ) : (
        <EmptyHint>
          Cadastre uma empresa para começar a criar automações.
        </EmptyHint>
      )}
    </>
  );
}
