import { clsx } from "@/lib/clsx";
import { Card } from "@/components/ui";

/* ------------------------------------------------------------------
   Gráficos em SVG/CSS puro — sem dependências e sem JavaScript no
   cliente. A camada de hover usa <title> nativo e realce por CSS.
   Paleta monocromática, alinhada aos tokens de `globals.css`.
   ------------------------------------------------------------------ */

const nf = new Intl.NumberFormat("pt-BR");

/** Arredonda o topo da escala para um número “redondo” acima do máximo. */
function escalaMaxima(valores: number[]) {
  const max = Math.max(...valores, 1);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

export function ChartCard({
  title,
  hint,
  aside,
  legend,
  children,
}: {
  title: string;
  hint?: string;
  aside?: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
        </div>
        {aside}
      </div>
      {legend ? <div className="flex flex-wrap gap-4">{legend}</div> : null}
      {children}
    </Card>
  );
}

/**
 * Tom da marca. `success`/`danger` só entram quando a série É o estado
 * (sucesso × erro); o resto dos gráficos segue na escala neutra.
 */
export type TomMarca = "neutro" | "success" | "danger" | "serie1" | "serie2";

function classesMarca(tom: TomMarca, variant: "solid" | "hachurado") {
  if (variant === "hachurado") {
    // A hachura é desenhada com currentColor.
    return clsx(
      "marca-hachurada",
      tom === "success" && "text-success",
      tom === "danger" && "text-danger",
      tom === "neutro" && "text-fg-muted",
      tom === "serie1" && "text-serie-1",
      tom === "serie2" && "text-serie-2"
    );
  }
  return clsx(
    tom === "success" && "bg-success",
    tom === "danger" && "bg-danger",
    tom === "neutro" && "bg-fg",
    tom === "serie1" && "bg-serie-1",
    tom === "serie2" && "bg-serie-2"
  );
}

export function LegendItem({
  label,
  variant = "solid",
  tom = "neutro",
}: {
  label: string;
  variant?: "solid" | "hachurado";
  tom?: TomMarca;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
      {/* O texto fica na tinta neutra: quem carrega a identidade é a marca. */}
      <span className={clsx("size-2.5 rounded-[3px]", classesMarca(tom, variant))} />
      {label}
    </span>
  );
}

/* ---------------------------------- Área ---------------------------------- */

/**
 * Linha com área preenchida. Série única — o título do card já a nomeia,
 * então não há legenda.
 */
export function AreaChart({
  pontos,
  sufixo,
}: {
  pontos: { rotulo: string; valor: number }[];
  sufixo?: string;
}) {
  const W = 1000;
  const H = 300;
  const TOPO = 16;
  const max = escalaMaxima(pontos.map((p) => p.valor));
  const passo = pontos.length > 1 ? W / (pontos.length - 1) : W;

  const coords = pontos.map((p, i) => ({
    x: i * passo,
    y: H - (p.valor / max) * (H - TOPO),
    ...p,
  }));

  const linha = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const area = `${linha} L${W},${H} L0,${H} Z`;

  const rotulosVisiveis = coords.filter(
    (_, i) => i === 0 || i === coords.length - 1 || i % Math.ceil(coords.length / 5) === 0
  );

  return (
    <figure className="m-0">
      <div className="relative pl-10">
        {/* Eixo Y como HTML: não distorce junto com o SVG. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-9 flex-col justify-between text-right text-[10px] tabular-nums text-fg-subtle">
          <span>{nf.format(max)}</span>
          <span>{nf.format(Math.round(max / 2))}</span>
          <span>0</span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-48 w-full sm:h-56"
          role="img"
          aria-label={`Série temporal com ${pontos.length} pontos, máximo de ${nf.format(
            Math.max(...pontos.map((p) => p.valor))
          )}`}
        >
          <defs>
            <linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--fg)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--fg)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((t) => (
            <line
              key={t}
              x1="0"
              x2={W}
              y1={TOPO + t * (H - TOPO)}
              y2={TOPO + t * (H - TOPO)}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill="url(#grad-area)" />
          <path
            d={linha}
            fill="none"
            stroke="var(--fg)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Alvos de hover: uma coluna por ponto, com crosshair e tooltip. */}
          {coords.map((c, i) => (
            <g key={c.rotulo + i} className="group">
              <rect
                x={c.x - passo / 2}
                y={0}
                width={passo}
                height={H}
                fill="transparent"
              >
                <title>{`${c.rotulo} · ${nf.format(c.valor)}${sufixo ? ` ${sufixo}` : ""}`}</title>
              </rect>
              <line
                x1={c.x}
                x2={c.x}
                y1={TOPO}
                y2={H}
                stroke="var(--border-strong)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                className="opacity-0 transition-opacity group-hover:opacity-100"
              />
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex justify-between pl-10 text-[10px] tabular-nums text-fg-subtle">
        {rotulosVisiveis.map((c) => (
          <span key={c.rotulo}>{c.rotulo}</span>
        ))}
      </div>
    </figure>
  );
}

/* -------------------------------- Colunas -------------------------------- */

/**
 * Colunas em CSS (sem distorção de escala). Série única: as séries de
 * grandezas diferentes ficam em gráficos separados, nunca em dois eixos.
 */
export function ColumnChart({
  colunas,
  rotularCada = 1,
  sufixo,
  tom = "neutro",
}: {
  colunas: { rotulo: string; valor: number }[];
  rotularCada?: number;
  sufixo?: string;
  /** `danger` só quando a própria série é o estado de erro. */
  tom?: TomMarca;
}) {
  const max = escalaMaxima(colunas.map((c) => c.valor));

  return (
    <figure className="m-0">
      <div className="relative pl-10">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-9 flex-col justify-between text-right text-[10px] tabular-nums text-fg-subtle">
          <span>{nf.format(max)}</span>
          <span>{nf.format(Math.round(max / 2))}</span>
          <span>0</span>
        </div>

        <div className="relative flex h-44 items-end gap-[3px] border-b border-border">
          {/* Grades recessivas */}
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-border" />

          {colunas.map((c, i) => (
            <div
              key={c.rotulo + i}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${c.rotulo} · ${nf.format(c.valor)}${sufixo ? ` ${sufixo}` : ""}`}
            >
              <div
                className={clsx(
                  "rounded-t-[3px] transition-opacity group-hover:opacity-70",
                  classesMarca(tom, "solid"),
                  // Valor zero não ganha barra mínima: seria ler como “algum”.
                  c.valor > 0 && "min-h-[2px]"
                )}
                style={{ height: `${(c.valor / max) * 100}%` }}
              />
              <span className="sr-only">
                {c.rotulo}: {nf.format(c.valor)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex gap-[3px] pl-10 text-[10px] tabular-nums text-fg-subtle">
        {colunas.map((c, i) => (
          // `min-w-0` é essencial: sem ele o texto do rótulo vira largura
          // mínima da coluna e empurra a página além da viewport no mobile.
          <span
            key={c.rotulo + i}
            className="min-w-0 flex-1 whitespace-nowrap text-center"
          >
            {i % rotularCada === 0 ? c.rotulo : " "}
          </span>
        ))}
      </div>
    </figure>
  );
}

/* ---------------------------- Barras ordenadas ---------------------------- */

export function RankedBars({
  itens,
  sufixo,
  formatar = (valor) => nf.format(valor),
  tom = "neutro",
}: {
  itens: { rotulo: string; valor: number; detalhe?: string }[];
  sufixo?: string;
  /** Para valores que não são contagem — dinheiro, por exemplo. */
  formatar?: (valor: number) => string;
  /** Série única: todas as barras no mesmo tom, que identifica a série — nunca por valor. */
  tom?: TomMarca;
}) {
  const max = Math.max(...itens.map((i) => i.valor), 1);

  return (
    <ul className="space-y-4">
      {itens.map((item) => (
        <li key={item.rotulo} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{item.rotulo}</span>
            <span className="shrink-0 tabular-nums text-fg-muted">
              {formatar(item.valor)}
              {sufixo ? <span className="text-fg-subtle"> {sufixo}</span> : null}
            </span>
          </div>
          {/* O detalhe fica junto do título, antes da barra, para não ser lido
              como legenda do item seguinte. */}
          {item.detalhe ? (
            <p className="text-xs text-fg-subtle">{item.detalhe}</p>
          ) : null}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              title={`${item.rotulo} · ${formatar(item.valor)}`}
              className={clsx("h-full rounded-full", classesMarca(tom, "solid"))}
              style={{ width: `${(item.valor / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Medidor de taxa --------------------------- */

/**
 * Barra única de proporção. Serve para comparar duas grandezas de tamanhos
 * muito diferentes (sucesso × erro) sem esconder a menor: o segmento tem
 * largura mínima e ambos os valores são rotulados diretamente.
 */
export function RateMeter({
  segmentos,
}: {
  segmentos: {
    rotulo: string;
    valor: number;
    variant?: "solid" | "hachurado";
    tom?: TomMarca;
  }[];
}) {
  const total = segmentos.reduce((s, seg) => s + seg.valor, 0) || 1;

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface-muted">
        {segmentos.map((seg) => (
          <div
            key={seg.rotulo}
            title={`${seg.rotulo} · ${nf.format(seg.valor)}`}
            className={clsx(
              "h-full min-w-[6px] rounded-full",
              classesMarca(seg.tom ?? "neutro", seg.variant ?? "solid")
            )}
            style={{ width: `${(seg.valor / total) * 100}%` }}
          />
        ))}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {segmentos.map((seg) => (
          <div key={seg.rotulo} className="space-y-0.5">
            <dt>
              <LegendItem
                label={seg.rotulo}
                variant={seg.variant}
                tom={seg.tom}
              />
            </dt>
            <dd className="pl-[18px] text-sm font-medium tabular-nums">
              {nf.format(seg.valor)}
              <span className="ml-1.5 text-xs font-normal text-fg-subtle">
                {((seg.valor / total) * 100).toFixed(1).replace(".", ",")}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------- Sparkline ------------------------------- */

export function Sparkline({ valores }: { valores: number[] }) {
  const W = 100;
  const H = 28;
  const max = Math.max(...valores, 1);
  const min = Math.min(...valores);
  const span = max - min || 1;
  const passo = valores.length > 1 ? W / (valores.length - 1) : W;

  const d = valores
    .map((v, i) => {
      const x = i * passo;
      const y = H - ((v - min) / span) * (H - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-7 w-full text-fg-subtle"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
