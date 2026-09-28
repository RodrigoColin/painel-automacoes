import { Card, PageHeader } from "@/components/ui";

/**
 * Placeholders das telas que dependem de chamadas lentas (Omie, Infisical).
 * O cabeçalho já mostra o nome do cliente selecionado, então quem troca de
 * empresa vê na hora que a troca aconteceu enquanto o conteúdo carrega.
 */

function Bloco({ className }: { className: string }) {
  return <div className={`rounded-md bg-current opacity-10 ${className}`} />;
}

export function EsqueletoTela({
  titulo,
  descricao,
  aviso,
}: {
  titulo: string;
  descricao: string;
  /** Explica a espera quando ela pode passar de alguns segundos. */
  aviso?: string;
}) {
  return (
    <div aria-busy="true">
      <PageHeader title={titulo} description={descricao} />
      <div className="mt-6 animate-pulse space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="space-y-3 p-4">
              <Bloco className="h-3 w-24" />
              <Bloco className="h-7 w-32" />
            </Card>
          ))}
        </div>
        <Card className="p-4">
          <Bloco className="h-64 w-full" />
        </Card>
      </div>
      {aviso ? <p className="mt-4 text-xs text-fg-subtle">{aviso}</p> : null}
    </div>
  );
}
