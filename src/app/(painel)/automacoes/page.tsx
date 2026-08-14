import type { Metadata } from "next";
import {
  BotaoNovaAutomacao,
  ListaAutomacoes,
} from "@/components/lista-automacoes";
import { Button, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Automações · Painel" };

export default function AutomacoesPage() {
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

      <ListaAutomacoes />
    </>
  );
}
