import { brl, nomeMes } from "@/lib/fluxo-caixa/calculos";
import type { SombraChecagem } from "@/lib/fluxo-caixa/tipos";

/**
 * Selo da conferência sombra (checagem.sombra, gravada pela rodada do caixa):
 * os meses fechados do pacote foram comparados com uma leitura independente do
 * Omie (ListarMovimentos).
 *
 * - ok / rateio_info → selo verde discreto, visível para todo mundo: é o que
 *   dá confiança de que a tela bate com o realizado do Omie.
 * - divergente → caixa vermelha com o detalhe por mês (e categorias), só para
 *   admin da plataforma — é um problema do pipeline para a Proos resolver,
 *   não uma informação para o cliente operar.
 * - erro → nota discreta, só admin.
 * - pacote antigo sem sombra → nada.
 */
export function SeloSombra({ sombra, ehAdmin }: { sombra: SombraChecagem | null | undefined; ehAdmin: boolean }) {
  if (!sombra) return null;

  if (sombra.status === "ok" || sombra.status === "rateio_info") {
    const meses = sombra.meses ?? [];
    if (meses.length === 0) return null;
    const faixa =
      meses.length === 1
        ? nomeMes(meses[0].mes)
        : `${nomeMes(meses[0].mes)}–${nomeMes(meses[meses.length - 1].mes)}`;
    const reclass = sombra.reclassificacoesRetroativas ?? [];
    const novas = sombra.categoriasNovas ?? [];
    return (
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs text-success">
          <span aria-hidden>✓</span>
          Meses fechados ({faixa}) conferidos com o realizado do Omie na última rodada — entradas e saídas batem.
        </p>
        {ehAdmin && (reclass.length > 0 || novas.length > 0) ? (
          <div role="status" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-xs">
            {reclass.length > 0 ? (
              <p>
                <b>{sombra.reclassificacoesTotal ?? reclass.length} reclassificação(ões) retroativa(s) no Omie</b>{" "}
                em mês já fechado:{" "}
                {reclass
                  .slice(0, 4)
                  .map((r) => `${r.categoria} (${nomeMes(r.mes)}: ${brl(r.congelado)} → ${brl(r.atual)})`)
                  .join(" · ")}
                . Se estiver correta, apague o mês de caixa_fechamento_mensal para recongelar.
              </p>
            ) : null}
            {novas.length > 0 ? (
              <p className={reclass.length > 0 ? "mt-1" : undefined}>
                <b>Categoria(s) nova(s)</b> no último mês fechado:{" "}
                {novas.map((c) => `${c.categoria} (${brl(c.valor)})`).join(" · ")} — conferir o grupo no bloco de
                configuração.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (!ehAdmin) return null;

  if (sombra.status === "erro") {
    return (
      <p className="text-xs text-fg-muted">
        Conferência sombra falhou na última rodada{sombra.erro ? ` (${sombra.erro})` : ""} — os números não foram
        validados contra o Omie desta vez.
      </p>
    );
  }

  // divergente
  const mesesDivergentes = (sombra.meses ?? []).filter(
    (l) => Math.abs(l.difEnt) > (sombra.tolerancia ?? 1) || Math.abs(l.difSai) > (sombra.tolerancia ?? 1),
  );
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm">
      <b>Conferência sombra divergente:</b> o painel difere do realizado do Omie nos meses fechados.
      <ul className="mt-1 list-inside list-disc">
        {mesesDivergentes.map((l) => (
          <li key={l.mes}>
            {nomeMes(l.mes)}: entradas {brl(l.entPainel)} no painel × {brl(l.entOmie)} no Omie · saídas{" "}
            {brl(l.saiPainel)} × {brl(l.saiOmie)}
          </li>
        ))}
      </ul>
      {sombra.categoriasDivergentes?.length ? (
        <p className="mt-1 text-xs text-fg-muted">
          Maiores diferenças por categoria:{" "}
          {sombra.categoriasDivergentes
            .slice(0, 5)
            .map((c) => `${c.categoria} (${nomeMes(c.mes)}: ${brl(c.dif)})`)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
