/**
 * Esqueleto mostrado na hora em que se troca de tela, enquanto o servidor
 * ainda consulta o banco. Sem este arquivo o Next só troca a tela quando a
 * página inteira está pronta, e o clique parece não ter feito nada.
 */
export default function Carregando() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-current opacity-10" />
        <div className="h-4 w-96 max-w-full rounded-md bg-current opacity-10" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-current opacity-10" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-current opacity-10" />
    </div>
  );
}
