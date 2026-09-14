/**
 * Blocos visuais da tela "Resumo Omie": o passo a passo de configuração e o
 * painel com os dados. Só apresentação — quem busca no Infisical e no Omie é
 * `lib/omie/resumo.ts`, chamado pela página.
 */

import Link from "next/link";
import { BotaoAtualizarOmie } from "@/components/botao-atualizar-omie";
import { ChartCard, LegendItem, RankedBars } from "@/components/charts";
import { IconAlerta, IconCheck } from "@/components/icons";
import { Badge, Card, EmptyHint, Table, Td, Th } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import {
  SEGREDO_APP_KEY,
  SEGREDO_APP_SECRET,
  type Categoria,
  type EstadoResumoOmie,
  type ResumoOmie,
  type TituloAtrasado,
} from "@/lib/omie/resumo";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const nf = new Intl.NumberFormat("pt-BR");

const LIMITE_CATEGORIAS = 6;
const LIMITE_ATRASADOS = 10;

/* ------------------------------ Configuração ------------------------------ */

type Passo = { titulo: string; detalhe: React.ReactNode; feito: boolean };

function LinkConfiguracoes() {
  return (
    <Link
      href="/configuracoes"
      className="font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
    >
      Configurações
    </Link>
  );
}

const codigo = (texto: string) => <code className="font-mono text-xs">{texto}</code>;

export function ConfiguracaoOmie({
  estado,
  ehAdminPlataforma,
}: {
  estado: Exclude<EstadoResumoOmie, { estado: "ok" }>;
  ehAdminPlataforma: boolean;
}) {
  if (estado.estado === "erro") {
    return (
      <>
        <Card className="flex items-start gap-3 border-border-strong p-4">
          <IconAlerta className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Não foi possível consultar o Omie</p>
            <p className="text-sm text-fg-muted">{estado.mensagem}</p>
            {estado.origem === "omie" ? (
              <p className="text-xs text-fg-subtle">
                Confira se as chaves são da conta certa e se o usuário da API tem acesso ao
                módulo Finanças.
              </p>
            ) : null}
          </div>
        </Card>
      </>
    );
  }

  const infisicalOk = estado.estado !== "sem-infisical";

  const detalheInfisical =
    estado.estado === "sem-infisical" ? (
      <>
        {estado.variaveisFaltando.length > 0 ? (
          <span className="block">
            Faltam variáveis de ambiente:{" "}
            {estado.variaveisFaltando.map((nome, i) => (
              <span key={nome}>
                {i > 0 ? ", " : ""}
                {codigo(nome)}
              </span>
            ))}
            .
          </span>
        ) : null}
        {!estado.configurado ? (
          <span className="block">
            Projeto e ambiente ainda não definidos
            {ehAdminPlataforma ? (
              <>
                {" "}
                — em <LinkConfiguracoes />, com a Proos selecionada.
              </>
            ) : (
              "."
            )}
          </span>
        ) : null}
        {ehAdminPlataforma ? null : <span className="block">Peça para a Proos configurar.</span>}
      </>
    ) : (
      "Credenciais nas variáveis de ambiente e projeto definido pela Proos."
    );

  const pasta = estado.estado === "sem-chaves" ? estado.caminho : null;

  const passos: Passo[] = [
    { titulo: "Conectar o Infisical", detalhe: detalheInfisical, feito: infisicalOk },
    {
      titulo: "Cadastrar as chaves do Omie",
      detalhe: (
        <>
          App Key e App Secret do aplicativo em Omie → Configurações → Desenvolvedor. Ficam no
          Infisical como {codigo(SEGREDO_APP_KEY)} e {codigo(SEGREDO_APP_SECRET)}
          {pasta ? <> na pasta {codigo(pasta)}</> : ", numa pasta criada para este cliente"}.
          {estado.estado === "sem-chaves" && pasta ? (
            <span className="mt-1 block text-danger">
              Não encontrado: {estado.faltando.join(", ")}.
            </span>
          ) : null}
          <span className="block">
            {ehAdminPlataforma
              ? "Cadastre pelo botão “Gerenciar chaves”, no topo da página."
              : "Peça para a Proos cadastrar."}
          </span>
        </>
      ),
      feito: false,
    },
  ];

  return (
    <section className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-8">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Configurar integração</h2>
        <p className="text-sm text-fg-muted">
          O painel lê as chaves do Omie no Infisical a cada consulta — elas não ficam
          gravadas aqui.
        </p>
      </div>
      <Card className="divide-y divide-border">
        {passos.map((passo, i) => (
          <div key={passo.titulo} className="p-4">
            <div className="flex gap-3">
              <span
                className={clsx(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums",
                  passo.feito
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-border-strong text-fg-muted"
                )}
              >
                {passo.feito ? <IconCheck className="size-4" /> : i + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">
                  {passo.titulo}
                  <span className="sr-only">{passo.feito ? " (concluído)" : " (pendente)"}</span>
                </p>
                <p className="text-sm text-fg-muted">{passo.detalhe}</p>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}

/* --------------------------------- Painel --------------------------------- */

/*
 * Cores desta tela, cada uma com um único trabalho:
 *
 * - Identidade: "a receber" é sempre serie-1 (azul) e "a pagar" sempre
 *   serie-2 (laranja) — nos indicadores, nas barras e nas categorias. Quem
 *   aprende a cor num gráfico lê o próximo sem legenda nova.
 * - Estado: vencido/atraso usa os tokens de status (danger, warning), sempre
 *   com ícone e rótulo. Nunca encosta numa marca de série: no tema escuro o
 *   vermelho de status e o laranja da série ficam perto demais (ΔE 10), por
 *   isso o vencido tem medidor próprio sobre trilho neutro.
 * - Texto nunca veste a cor da série: a identidade vem do marcador ao lado.
 */

type Serie = "receber" | "pagar";

const TOM_SERIE: Record<Serie, "serie1" | "serie2"> = { receber: "serie1", pagar: "serie2" };
const FUNDO_SERIE: Record<Serie, string> = { receber: "bg-serie-1", pagar: "bg-serie-2" };

function Marcador({ serie }: { serie: Serie }) {
  return (
    <span aria-hidden="true" className={clsx("size-2.5 shrink-0 rounded-[3px]", FUNDO_SERIE[serie])} />
  );
}

/** "OYSTR SISTEMAS · 20.704.889/0001-03 · Curitiba · PR", ou o nome da empresa no painel. */
export function identificacaoOmie(nomeEmpresa: string, resumo: ResumoOmie | null) {
  const cadastro = resumo?.empresa;
  return cadastro
    ? [cadastro.nomeFantasia || cadastro.razaoSocial, cadastro.cnpj, cadastro.cidade]
        .filter(Boolean)
        .join(" · ")
    : nomeEmpresa;
}

/** Aba "Financeiro": o resumo consultado ao vivo (saldo, receber, pagar, atrasos). */
export function AbaFinanceiro({ resumo }: { resumo: ResumoOmie }) {
  const horario = new Date(resumo.consultadoEm).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

  const saldoProjetado = resumo.saldoContas + resumo.receber.valor - resumo.pagar.valor;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge tone="outline" className="tabular-nums">
          Consultado às {horario}
        </Badge>
        <BotaoAtualizarOmie />
      </div>

      {resumo.avisos.length > 0 ? (
        <Card className="flex items-start gap-3 p-4">
          <IconAlerta className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Parte dos dados não veio do Omie</p>
            <ul className="text-xs text-fg-muted">
              {resumo.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {/* ----------------------------- Indicadores ---------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Saldo em contas
          </p>
          <p className="mt-2 text-2xl font-semibold">{brl.format(resumo.saldoContas)}</p>
          <p className="mt-1 text-xs text-fg-muted">Soma das contas correntes</p>
          <div className="mt-3">
            <Tendencia
              valor={saldoProjetado}
              rotulo="projetado com os títulos em aberto"
            />
          </div>
        </Card>

        <IndicadorSerie serie="receber" rotulo="A receber" dados={resumo.receber} />
        <IndicadorSerie serie="pagar" rotulo="A pagar" dados={resumo.pagar} />

        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Cadastros
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-fg-muted">Clientes</dt>
              <dd className="text-2xl font-semibold">
                {resumo.totalClientes === null ? "—" : nf.format(resumo.totalClientes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Produtos</dt>
              <dd className="text-2xl font-semibold">
                {resumo.totalProdutos === null ? "—" : nf.format(resumo.totalProdutos)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {/* ------------------------ Comparativos lado a lado ---------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Em aberto: receber × pagar"
          hint="Total dos títulos em aberto de cada lado, na mesma escala."
        >
          {/* Sem legenda à parte: cada barra já traz o marcador e o nome da série. */}
          <BarrasComparadas
            linhas={[
              { serie: "receber", rotulo: "A receber", valor: resumo.receber.valor },
              { serie: "pagar", rotulo: "A pagar", valor: resumo.pagar.valor },
            ]}
          />
          <div className="border-t border-border pt-3">
            <Tendencia
              valor={resumo.receber.valor - resumo.pagar.valor}
              rotulo="de diferença entre receber e pagar"
            />
          </div>
        </ChartCard>

        {resumo.fluxoHoje ? (
          <ChartCard
            title="Fluxo de caixa de hoje"
            hint="Previsto para o dia: saídas à esquerda, entradas à direita."
            legend={
              <>
                {/* Mesma ordem do gráfico: saídas à esquerda. */}
                <LegendItem label="Saídas" tom="serie2" />
                <LegendItem label="Entradas" tom="serie1" />
              </>
            }
          >
            <FluxoDivergente
              entradas={resumo.fluxoHoje.receber}
              saidas={resumo.fluxoHoje.pagar}
            />
            <div className="border-t border-border pt-3">
              <Tendencia valor={resumo.fluxoHoje.saldo} rotulo="de saldo no dia" />
            </div>
          </ChartCard>
        ) : null}
      </div>

      {/* ------------------------------- Categorias ---------------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="A receber por categoria"
          hint={`Títulos em aberto, maiores ${LIMITE_CATEGORIAS} categorias.`}
          aside={<Marcador serie="receber" />}
        >
          <ListaCategorias serie="receber" itens={resumo.receberPorCategoria} />
        </ChartCard>
        <ChartCard
          title="A pagar por categoria"
          hint={`Títulos em aberto, maiores ${LIMITE_CATEGORIAS} categorias.`}
          aside={<Marcador serie="pagar" />}
        >
          <ListaCategorias serie="pagar" itens={resumo.pagarPorCategoria} />
        </ChartCard>
      </div>

      {/* -------------------------------- Atrasos ------------------------------ */}
      <TabelaAtrasados
        serie="receber"
        titulo="Recebimentos em atraso"
        descricao="Títulos vencidos que o cliente ainda não pagou, dos mais antigos aos mais recentes."
        rotuloPessoa="Cliente"
        itens={resumo.receberAtrasados}
      />
      <TabelaAtrasados
        serie="pagar"
        titulo="Pagamentos em atraso"
        descricao="Contas vencidas ainda não pagas, das mais antigas às mais recentes."
        rotuloPessoa="Fornecedor"
        itens={resumo.pagarAtrasados}
      />
    </>
  );
}

/* ------------------------------- Indicadores ------------------------------ */

function IndicadorSerie({
  serie,
  rotulo,
  dados,
}: {
  serie: Serie;
  rotulo: string;
  dados: { valor: number; titulos: number; atraso: number };
}) {
  const fracaoVencida = dados.valor > 0 ? Math.min(dados.atraso / dados.valor, 1) : 0;
  const percentual = (fracaoVencida * 100).toFixed(0);

  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
        <Marcador serie={serie} />
        {rotulo}
      </p>
      <p className="mt-2 text-2xl font-semibold">{brl.format(dados.valor)}</p>
      <p className="mt-1 text-xs text-fg-muted">
        {nf.format(dados.titulos)} título{dados.titulos === 1 ? "" : "s"} em aberto
      </p>

      {/* Medidor de severidade: o preenchimento é o vencido, o trilho neutro é
          o que ainda está no prazo. Ícone e texto carregam o estado junto. */}
      <div className="mt-3 space-y-1.5">
        <div
          role="meter"
          aria-label={`${rotulo} vencido`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(percentual)}
          title={`Vencido · ${brl.format(dados.atraso)} (${percentual}%)`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          {fracaoVencida > 0 ? (
            <div
              className="h-full min-w-[6px] rounded-full bg-danger"
              style={{ width: `${fracaoVencida * 100}%` }}
            />
          ) : null}
        </div>
        {dados.atraso > 0 ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <IconAlerta className="size-4 shrink-0" />
            {brl.format(dados.atraso)} vencidos · {percentual}%
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <IconCheck className="size-4 shrink-0" />
            Nada vencido
          </p>
        )}
      </div>
    </Card>
  );
}

/** Sinal do valor em texto e ícone — a cor de estado só reforça. */
function Tendencia({ valor, rotulo }: { valor: number; rotulo: string }) {
  const positivo = valor >= 0;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
      <span
        className={clsx(
          "inline-flex items-center gap-1 font-semibold",
          positivo ? "text-success" : "text-danger"
        )}
      >
        <span aria-hidden="true">{positivo ? "▲" : "▼"}</span>
        <span className="sr-only">{positivo ? "Positivo:" : "Negativo:"}</span>
        {brl.format(valor)}
      </span>
      {rotulo}
    </p>
  );
}

/* --------------------------------- Gráficos ------------------------------- */

/** Barras horizontais da mesma escala, uma por série, valor na ponta. */
function BarrasComparadas({
  linhas,
}: {
  linhas: { serie: Serie; rotulo: string; valor: number }[];
}) {
  const max = Math.max(...linhas.map((l) => l.valor), 1);

  return (
    <ul className="space-y-4">
      {linhas.map((linha) => (
        <li key={linha.serie} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Marcador serie={linha.serie} />
              {linha.rotulo}
            </span>
            <span className="tabular-nums text-fg-muted">{brl.format(linha.valor)}</span>
          </div>
          <div className="h-3 w-full rounded-full bg-surface-muted">
            <div
              title={`${linha.rotulo} · ${brl.format(linha.valor)}`}
              className={clsx("h-full rounded-full", FUNDO_SERIE[linha.serie])}
              style={{ width: `${(linha.valor / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Barra divergente a partir de um eixo central: saídas crescem para a
 * esquerda, entradas para a direita, na mesma escala. Os valores ficam fora
 * das barras, acima delas — assim nunca são cortados por uma barra curta.
 */
function FluxoDivergente({ entradas, saidas }: { entradas: number; saidas: number }) {
  const max = Math.max(entradas, saidas, 1);

  return (
    <div className="space-y-2">
      <div className="flex justify-between gap-3 text-sm">
        <span className="space-y-0.5">
          <span className="block text-xs text-fg-muted">Saídas</span>
          <span className="block font-medium tabular-nums">{brl.format(saidas)}</span>
        </span>
        <span className="space-y-0.5 text-right">
          <span className="block text-xs text-fg-muted">Entradas</span>
          <span className="block font-medium tabular-nums">{brl.format(entradas)}</span>
        </span>
      </div>
      <div className="relative grid h-3 grid-cols-2 gap-[2px]">
        <div className="flex justify-end rounded-l-full bg-surface-muted">
          <div
            title={`Saídas · ${brl.format(saidas)}`}
            className="h-full rounded-l-full bg-serie-2"
            style={{ width: `${(saidas / max) * 100}%` }}
          />
        </div>
        <div className="flex rounded-r-full bg-surface-muted">
          <div
            title={`Entradas · ${brl.format(entradas)}`}
            className="h-full rounded-r-full bg-serie-1"
            style={{ width: `${(entradas / max) * 100}%` }}
          />
        </div>
        {/* Eixo central: linha fina, uma nuance acima da superfície. */}
        <span
          aria-hidden="true"
          className="absolute -inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border-strong"
        />
      </div>
    </div>
  );
}

function ListaCategorias({ serie, itens }: { serie: Serie; itens: Categoria[] }) {
  if (itens.length === 0) return <EmptyHint>Nenhum título em aberto.</EmptyHint>;

  const principais = itens.slice(0, LIMITE_CATEGORIAS);
  const resto = itens.slice(LIMITE_CATEGORIAS);
  // Categorias além do limite viram "Outras" em vez de sumirem do total.
  if (resto.length > 0) {
    principais.push({
      descricao: `Outras (${resto.length})`,
      valor: resto.reduce((s, c) => s + c.valor, 0),
      quantidade: resto.reduce((s, c) => s + c.quantidade, 0),
    });
  }

  return (
    <RankedBars
      tom={TOM_SERIE[serie]}
      formatar={(valor) => brl.format(valor)}
      itens={principais.map((c) => ({
        rotulo: c.descricao,
        valor: c.valor,
        detalhe: `${nf.format(c.quantidade)} título${c.quantidade === 1 ? "" : "s"}`,
      }))}
    />
  );
}

/* --------------------------------- Atrasos -------------------------------- */

/** Faixas de atraso: até 30 dias pede atenção, acima disso é crítico. */
function SeveridadeAtraso({ dias }: { dias: number }) {
  const critico = dias > 30;
  return (
    <Badge tone={critico ? "danger" : "warning"} className="tabular-nums">
      <IconAlerta className="size-4" />
      {nf.format(dias)} dia{dias === 1 ? "" : "s"}
      <span className="sr-only">{critico ? " — crítico" : " — atenção"}</span>
    </Badge>
  );
}

function TabelaAtrasados({
  serie,
  titulo,
  descricao,
  rotuloPessoa,
  itens,
}: {
  serie: Serie;
  titulo: string;
  descricao: string;
  rotuloPessoa: string;
  itens: TituloAtrasado[];
}) {
  const total = itens.reduce((s, t) => s + t.valor, 0);
  const criticos = itens.filter((t) => t.diasAtraso > 30).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Marcador serie={serie} />
            {titulo}
          </h2>
          <p className="text-xs text-fg-muted">{descricao}</p>
        </div>
        {itens.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-fg-subtle">
            {criticos > 0 ? (
              <Badge tone="danger">
                <IconAlerta className="size-4" />
                {nf.format(criticos)} acima de 30 dias
              </Badge>
            ) : null}
            <span>
              {nf.format(itens.length)} título{itens.length === 1 ? "" : "s"} · {brl.format(total)}
            </span>
          </div>
        ) : null}
      </div>

      {itens.length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-sm text-fg-subtle">
          <IconCheck className="size-4 text-success" />
          Nada em atraso.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{rotuloPessoa}</Th>
              <Th>Categoria</Th>
              <Th>Vencimento</Th>
              <Th>Atraso</Th>
              <Th className="text-right">Valor</Th>
            </tr>
          </thead>
          <tbody>
            {itens.slice(0, LIMITE_ATRASADOS).map((titulo) => (
              <tr key={titulo.id} className="hover:bg-surface-muted/50">
                <Td className="font-medium">{titulo.cliente}</Td>
                <Td className="text-fg-muted">{titulo.categoria}</Td>
                <Td className="tabular-nums text-fg-muted">{titulo.vencimento}</Td>
                <Td>
                  <SeveridadeAtraso dias={titulo.diasAtraso} />
                </Td>
                <Td className="text-right font-medium tabular-nums">{brl.format(titulo.valor)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {itens.length > LIMITE_ATRASADOS ? (
        <p className="text-xs text-fg-subtle">
          Mostrando os {LIMITE_ATRASADOS} mais antigos de {nf.format(itens.length)}.
        </p>
      ) : null}
    </>
  );
}
