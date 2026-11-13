"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Td } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { IconUpload } from "@/components/icons";
import {
  aprovarCriacao,
  consultarExcedentes,
  enfileirarExcedentes,
  resolverExcecao,
  type LinhaExcedente,
  type StatusLote,
} from "@/lib/acoes-excedentes";

const ROTULO_ETAPA: Record<string, string> = {
  iniciando: "Iniciando…",
  de_para: "Aplicando o De/Para…",
  clientes_contratos: "Resolvendo clientes e contratos no Omie…",
  detalhes_contratos: "Lendo e-mail e vencimento dos contratos…",
  detalhes_clientes: "Lendo cadastros de clientes…",
  idempotencia: "Conferindo OSs já existentes no Omie…",
  montando: "Montando as OSs…",
  criando: "Criando OSs no Omie…",
};

const EM_ANDAMENTO = ["na_fila", "planejando", "aprovado", "criando"];

const dinheiro = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function reais(valor: string | number | null | undefined): string {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? dinheiro.format(n) : String(valor ?? "");
}

function dataBr(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

type OsAgrupada = {
  codigo: string;
  forma: "os" | "contrato";
  contrato: string | null;
  cliente: string | null;
  linhas: LinhaExcedente[];
  valor: number;
  jaExiste: boolean;
  numeroOs: string | null;
};

// Agrupa os "destinos": uma OS (por cCodIntOS) ou um contrato (por nº do
// contrato, para clientes dia 2 que faturam no contrato).
function agruparOss(linhas: LinhaExcedente[]): OsAgrupada[] {
  const grupos = new Map<string, OsAgrupada>();
  for (const l of linhas) {
    if (!["ok", "resolvida", "ja_existe"].includes(l.status)) continue;
    const contrato = l.formaFaturamento === "contrato";
    const chave = contrato ? `ctr:${l.numeroContrato}` : l.codigoIntOs;
    if (!chave) continue;
    const g = grupos.get(chave) ?? {
      codigo: chave,
      forma: contrato ? "contrato" : "os",
      contrato: l.numeroContrato,
      cliente: l.cliente,
      linhas: [],
      valor: 0,
      jaExiste: false,
      numeroOs: null,
    };
    g.linhas.push(l);
    g.valor += Number(l.valorTotal);
    if (l.status === "ja_existe") g.jaExiste = true;
    if (l.numeroOs) g.numeroOs = l.numeroOs;
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort((a, b) =>
    (a.cliente ?? "").localeCompare(b.cliente ?? ""),
  );
}

export function PainelExcedentes({ empresaId }: { empresaId: string }) {
  const [lote, setLote] = useState<StatusLote | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // Bump reinicia o polling (novo upload, aprovação, exceção resolvida).
  const [versao, setVersao] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const atualizar = useCallback(() => setVersao((v) => v + 1), []);

  // Carrega o lote mais recente ao abrir e mantém polling enquanto o worker
  // trabalha (plano ou criação); para no primeiro estado terminal.
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const parar = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const tick = async () => {
      const r = await consultarExcedentes(empresaId);
      if (!vivo) return;
      setLote(r);
      if (!EM_ANDAMENTO.includes(r.status)) parar();
    };
    void tick();
    timer = setInterval(() => void tick(), 3000);
    return () => {
      vivo = false;
      parar();
    };
  }, [empresaId, versao]);

  async function enviar(arquivo: File) {
    setEnviando(true);
    setErroAcao(null);
    const dados = new FormData();
    dados.set("empresaId", empresaId);
    dados.set("arquivo", arquivo);
    const r = await enfileirarExcedentes(dados);
    setEnviando(false);
    if (r.erro) {
      setErroAcao(r.erro);
      return;
    }
    setLote({ status: "na_fila", loteId: r.loteId });
    atualizar();
  }

  async function aprovar() {
    if (!lote?.loteId || !lote.linhas) return;
    const grupos = agruparOss(lote.linhas);
    const oss = grupos.filter((o) => o.forma === "os" && !o.jaExiste);
    const ctr = grupos.filter((o) => o.forma === "contrato");
    const valor = oss.reduce((s, o) => s + o.valor, 0);
    const linhaCtr = ctr.length
      ? ` E aplicar ${ctr.length} excedente(s) dentro do(s) contrato(s) dia 2 (atualiza/inclui o item na próxima NFS-e do contrato).`
      : "";
    const ok = window.confirm(
      `Criar ${oss.length} OS(s) no Omie, somando ${reais(valor)}?` +
        linhaCtr +
        "\n\nAs OSs entram na etapa Faturar (50). Nada é faturado pelo portal. " +
        "Exceções não resolvidas ficam de fora, só no relatório.",
    );
    if (!ok) return;
    setAprovando(true);
    setErroAcao(null);
    const r = await aprovarCriacao(empresaId, lote.loteId);
    setAprovando(false);
    if (r.erro) {
      setErroAcao(r.erro);
      return;
    }
    setLote({ ...lote, status: "aprovado" });
    atualizar();
  }

  const processando = lote != null && EM_ANDAMENTO.includes(lote.status);
  const linhas = lote?.linhas ?? [];
  const excecoes = linhas.filter((l) => l.status === "excecao");
  const ignoradas = linhas.filter((l) => l.status === "ignorada");
  const grupos = agruparOss(linhas);
  const oss = grupos.filter((o) => o.forma === "os");
  const contratos = grupos.filter((o) => o.forma === "contrato");
  const ossNovas = oss.filter((o) => !o.jaExiste);
  const ossExistentes = oss.filter((o) => o.jaExiste);
  const valorNovas = ossNovas.reduce((s, o) => s + o.valor, 0);
  const valorContratos = contratos.reduce((s, o) => s + o.valor, 0);
  const aguardando = lote?.status === "aguardando_aprovacao";
  const concluido = lote?.status === "concluido";
  const criacao = (lote?.resumo as { criacao?: Record<string, unknown> } | null)
    ?.criacao as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Enviar planilha de excedentes</h2>
          <p className="text-xs text-fg-muted">
            Sobe a planilha mensal (.xlsx) enviada pela OYSTR. O sistema monta a
            prévia completa — cliente, contrato, serviço excedente, valor,
            vencimento e e-mail — <b>sem escrever nada no Omie</b>. Linhas já
            marcadas na coluna R são ignoradas; OS já existente no Omie (mesmo
            código EXC) aparece como “já no Omie” e não é recriada.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          aria-label="Planilha de excedentes"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (arquivo) void enviar(arquivo);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={enviando || processando}
          >
            <IconUpload className="size-4" />
            {enviando ? "Enviando…" : "Escolher planilha (.xlsx)"}
          </Button>
          {processando ? (
            <span className="text-xs text-fg-subtle">
              {ROTULO_ETAPA[lote?.etapa ?? ""] ??
                (lote?.status === "na_fila" ? "Na fila…" : "Processando…")}
            </span>
          ) : null}
          {lote?.planilhaNome ? (
            <span className="text-xs text-fg-subtle">
              {lote.planilhaNome} · competência {lote.competencia} · por {lote.enviadoPor}
            </span>
          ) : null}
        </div>

        {erroAcao ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{erroAcao}</p>
        ) : null}
        {lote?.status === "erro" && lote.erro ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {lote.erro}
          </p>
        ) : null}
      </Card>

      {linhas.length > 0 ? (
        <>
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">
                {ossNovas.length} OS a criar · {reais(valorNovas)}
              </Badge>
              {contratos.length > 0 ? (
                <Badge tone="warning">
                  {contratos.length} no contrato · {reais(valorContratos)}
                </Badge>
              ) : null}
              {excecoes.length > 0 ? (
                <Badge tone="danger">{excecoes.length} exceção(ões)</Badge>
              ) : null}
              {ossExistentes.length > 0 ? (
                <Badge tone="neutral">{ossExistentes.length} já no Omie</Badge>
              ) : null}
              {ignoradas.length > 0 ? (
                <Badge tone="neutral">{ignoradas.length} ignorada(s)</Badge>
              ) : null}
              <span className="text-xs text-fg-subtle">
                {linhas.length} linha(s) processável(is)
                {lote?.resumo?.linhas_ignoradas
                  ? ` · ${String(lote.resumo.linhas_ignoradas)} já marcadas na planilha`
                  : ""}
              </span>
            </div>

            {concluido && criacao ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted/40 p-3">
                <Badge tone="success">{String(criacao.os_criadas ?? 0)} criada(s)</Badge>
                <Badge tone="neutral">{String(criacao.ja_existiam ?? 0)} já existiam</Badge>
                {Number(criacao.falhas ?? 0) > 0 ? (
                  <Badge tone="danger">{String(criacao.falhas)} falha(s)</Badge>
                ) : null}
                <span className="text-xs text-fg-subtle">
                  total criado {reais(String(criacao.valor_criado ?? "0"))} · aprovado por{" "}
                  {lote?.aprovadoPor}
                </span>
                <Button variant="secondary" onClick={() => exportarCsv(linhas)}>
                  Exportar relatório (CSV)
                </Button>
              </div>
            ) : null}

            {aguardando ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => void aprovar()}
                  disabled={aprovando || (ossNovas.length === 0 && contratos.length === 0)}
                >
                  {aprovando
                    ? "Enviando…"
                    : `Aprovar · ${ossNovas.length} OS` +
                      (contratos.length ? ` + ${contratos.length} contrato(s)` : "")}
                </Button>
                <span className="text-xs text-fg-subtle">
                  Nada é escrito no Omie antes desta aprovação. Aprovar cria as
                  OSs
                  {contratos.length > 0
                    ? ` e aplica ${contratos.length} excedente(s) dentro do(s) contrato(s) dia 2 (atualiza ou inclui o item)`
                    : ""}
                  .
                  {excecoes.length > 0
                    ? ` ${excecoes.length} exceção(ões) ficarão de fora até serem resolvidas.`
                    : ""}
                </span>
                <Button variant="secondary" onClick={() => exportarCsv(linhas)}>
                  Exportar plano (CSV)
                </Button>
              </div>
            ) : null}
          </Card>

          {excecoes.length > 0 && aguardando ? (
            <FilaExcecoes
              empresaId={empresaId}
              excecoes={excecoes}
              aoResolver={() => void atualizar()}
            />
          ) : null}

          <TabelaOss oss={grupos} />
        </>
      ) : null}
    </div>
  );
}

type ColunaOs =
  | "cliente"
  | "contrato"
  | "forma"
  | "servico"
  | "valor"
  | "vencimento"
  | "email"
  | "situacao";

function labelForma(os: OsAgrupada): string {
  return os.forma === "contrato" ? "contrato" : "os";
}

function rankSituacao(os: OsAgrupada): number {
  const l = os.linhas[0];
  if (l?.criacaoStatus === "falha") return 0;
  if (l?.criacaoStatus === "criada") return 1;
  if (os.jaExiste || l?.criacaoStatus === "ja_existia") return 2;
  if (os.linhas.some((x) => x.status === "resolvida")) return 3;
  return 4; // pronta
}

const ACESSOR: Record<ColunaOs, (os: OsAgrupada) => string | number> = {
  cliente: (os) => (os.cliente ?? "").toLowerCase(),
  contrato: (os) => (os.contrato ? Number(os.contrato) || os.contrato : "￿"),
  forma: labelForma,
  servico: (os) => (os.linhas[0]?.descExcedente ?? "").toLowerCase(),
  valor: (os) => os.valor,
  vencimento: (os) => os.linhas[0]?.vencFinal ?? "￿",
  email: (os) => (os.linhas[0]?.emailEnvio ?? "").toLowerCase(),
  situacao: rankSituacao,
};

const COLUNAS: { c: ColunaOs; label: string; right?: boolean }[] = [
  { c: "cliente", label: "Cliente" },
  { c: "contrato", label: "Contrato" },
  { c: "forma", label: "Forma" },
  { c: "servico", label: "Serviço excedente" },
  { c: "valor", label: "Valor", right: true },
  { c: "vencimento", label: "Vencimento" },
  { c: "email", label: "E-mail de envio" },
  { c: "situacao", label: "Situação" },
];

function labelSituacao(os: OsAgrupada): string {
  const l = os.linhas[0];
  if (l?.criacaoStatus === "criada") return `os ${l.numeroOs ?? ""} criada`;
  if (l?.criacaoStatus === "falha") return "falha";
  if (os.jaExiste || l?.criacaoStatus === "ja_existia")
    return `já no omie ${os.numeroOs ?? ""}`;
  if (os.linhas.some((x) => x.status === "resolvida")) return "resolvida";
  return "pronta";
}

// Texto buscável por coluna (usado pelo filtro "contém").
const TEXTO: Record<ColunaOs, (os: OsAgrupada) => string> = {
  cliente: (os) => os.cliente ?? "",
  contrato: (os) => os.contrato ?? "sem contrato",
  forma: (os) => (os.forma === "contrato" ? "contrato" : "os"),
  servico: (os) => os.linhas.map((l) => l.descExcedente ?? l.descricao ?? "").join(" "),
  valor: (os) => `${os.valor} ${reais(os.valor)}`,
  vencimento: (os) => dataBr(os.linhas[0]?.vencFinal ?? null),
  email: (os) => os.linhas[0]?.emailEnvio ?? "",
  situacao: labelSituacao,
};

function CabecalhoOrdenavel({
  c,
  label,
  right,
  colunaAtiva,
  dir,
  aoOrdenar,
}: {
  c: ColunaOs;
  label: string;
  right?: boolean;
  colunaAtiva: ColunaOs;
  dir: 1 | -1;
  aoOrdenar: (c: ColunaOs) => void;
}) {
  const ativo = colunaAtiva === c;
  return (
    <th
      className={clsx(
        "sticky top-0 z-10 cursor-pointer select-none border-b border-border bg-surface-muted/60 px-3 py-2 text-xs font-medium uppercase tracking-wider text-fg-subtle hover:text-fg",
        right ? "text-right" : "text-left",
      )}
      onClick={() => aoOrdenar(c)}
      aria-sort={ativo ? (dir === 1 ? "ascending" : "descending") : "none"}
    >
      <span className={clsx("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        {label}
        <span className="text-[10px] text-fg-subtle/70">{ativo ? (dir === 1 ? "▲" : "▼") : "↕"}</span>
      </span>
    </th>
  );
}

const LIMITE_COMPACTO = 12; // OSs mostradas antes de "Expandir"

function TabelaOss({ oss }: { oss: OsAgrupada[] }) {
  // Começa ordenada por valor do excedente, do maior para o menor.
  const [coluna, setColuna] = useState<ColunaOs>("valor");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [expandido, setExpandido] = useState(false);
  const [filtros, setFiltros] = useState<Partial<Record<ColunaOs, string>>>({});

  if (oss.length === 0) return null;

  function ordenarPor(c: ColunaOs) {
    if (c === coluna) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setColuna(c);
      setDir(1);
    }
  }

  const ativos = COLUNAS.filter(({ c }) => (filtros[c] ?? "").trim() !== "");
  const filtradas = oss.filter((os) =>
    ativos.every(({ c }) =>
      TEXTO[c](os).toLowerCase().includes((filtros[c] ?? "").trim().toLowerCase()),
    ),
  );

  const ordenadas = [...filtradas].sort((a, b) => {
    const va = ACESSOR[coluna](a);
    const vb = ACESSOR[coluna](b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "pt-BR") * dir;
  });

  // Expandir/recolher é VERTICAL: compacto mostra as primeiras LIMITE OSs.
  const visiveis = expandido ? ordenadas : ordenadas.slice(0, LIMITE_COMPACTO);
  const temMais = ordenadas.length > LIMITE_COMPACTO;

  const temFiltro = ativos.length > 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs text-fg-subtle">
          {temFiltro
            ? `${filtradas.length} de ${oss.length} OS · filtro ativo`
            : `${oss.length} OS · clique no título da coluna para ordenar`}
        </span>
        {temFiltro ? (
          <button
            className="text-xs font-medium text-brand hover:underline"
            onClick={() => setFiltros({})}
          >
            Limpar filtros
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <thead>
            <tr>
              {COLUNAS.map(({ c, label, right }) => (
                <CabecalhoOrdenavel
                  key={c}
                  c={c}
                  label={label}
                  right={right}
                  colunaAtiva={coluna}
                  dir={dir}
                  aoOrdenar={ordenarPor}
                />
              ))}
            </tr>
            <tr>
              {COLUNAS.map(({ c, right }) => (
                <th key={c} className="border-b border-border bg-surface-muted/30 px-2 py-1.5">
                  <input
                    value={filtros[c] ?? ""}
                    onChange={(e) =>
                      setFiltros((f) => ({ ...f, [c]: e.target.value }))
                    }
                    placeholder="filtrar…"
                    className={clsx(
                      "w-full min-w-[5rem] rounded border border-border bg-surface px-1.5 py-1 text-xs font-normal normal-case text-fg placeholder:text-fg-subtle/60",
                      right && "text-right",
                    )}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenadas.length === 0 ? (
              <tr>
                <Td className="py-6 text-center text-fg-subtle" colSpan={COLUNAS.length}>
                  Nenhum item corresponde ao filtro.
                </Td>
              </tr>
            ) : null}
            {visiveis.map((os) =>
              os.linhas.map((l, i) => {
                // Só avisos relevantes (o "Líquido ≠ valor" foi removido;
                // pode estar gravado em lotes antigos).
                const avisos = l.avisos.filter((a) => !a.includes("Líquido"));
                return (
                  <tr key={l.id} className="border-t border-border">
                    <Td>
                      <span className="block max-w-[15rem] truncate" title={os.cliente ?? ""}>
                        {i === 0 ? os.cliente : ""}
                      </span>
                    </Td>
                    <Td className="tabular-nums">
                      {i === 0 ? (os.contrato ?? "sem contrato") : ""}
                    </Td>
                    <Td>
                      {i === 0 ? (
                        os.forma === "contrato" ? (
                          <Badge tone="warning" title={`dia de faturamento ${l.nDiaFat ?? 2}`}>
                            Contrato
                          </Badge>
                        ) : (
                          <Badge tone="neutral">OS</Badge>
                        )
                      ) : null}
                    </Td>
                    <Td>
                      <span
                        className="inline-flex max-w-[24rem] items-center gap-1"
                        title={l.descExcedente ?? l.descricao ?? ""}
                      >
                        <span className="truncate">{l.descExcedente ?? l.descricao}</span>
                        {avisos.length > 0 ? (
                          <span className="shrink-0 text-warning" title={avisos.join("; ")}>
                            ⚠
                          </span>
                        ) : null}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{reais(l.valorTotal)}</Td>
                    <Td title={l.regraVenc ?? ""}>
                      {os.forma === "contrato" ? (
                        <span className="text-fg-subtle">no contrato</span>
                      ) : (
                        dataBr(l.vencFinal)
                      )}
                    </Td>
                    <Td>
                      <span className="block max-w-[16rem] truncate" title={l.emailEnvio ?? ""}>
                        {l.emailEnvio || "—"}
                      </span>
                    </Td>
                    <Td>
                      {os.forma === "contrato" ? (
                        l.criacaoStatus === "contrato_incluido" ? (
                          <Badge tone="success">incluído no contrato</Badge>
                        ) : l.criacaoStatus === "contrato_atualizado" ? (
                          <Badge tone="success">atualizado no contrato</Badge>
                        ) : l.criacaoStatus === "falha" ? (
                          <Badge tone="danger" title={l.criacaoErro ?? ""}>
                            falha no contrato
                          </Badge>
                        ) : l.contratoAcao === "atualizar" ? (
                          <Badge
                            tone="warning"
                            title={`valor atual no contrato: ${reais(l.contratoValorAtual ?? "0")}`}
                          >
                            atualizar {reais(l.contratoValorAtual ?? "0")} → {reais(l.valorTotal)}
                          </Badge>
                        ) : l.contratoAcao === "incluir" ? (
                          <Badge tone="success">incluir no contrato</Badge>
                        ) : (
                          <Badge tone="neutral">faturar no contrato</Badge>
                        )
                      ) : l.criacaoStatus === "criada" ? (
                        <Badge tone="success">OS {l.numeroOs ?? "criada"}</Badge>
                      ) : l.criacaoStatus === "falha" ? (
                        <Badge tone="danger" title={l.criacaoErro ?? ""}>
                          falha
                        </Badge>
                      ) : l.status === "ja_existe" || l.criacaoStatus === "ja_existia" ? (
                        <Badge tone="neutral">
                          já no Omie{os.numeroOs ? ` (${os.numeroOs})` : ""}
                        </Badge>
                      ) : l.status === "resolvida" ? (
                        <Badge tone="warning">resolvida</Badge>
                      ) : (
                        <Badge tone="success">pronta</Badge>
                      )}
                    </Td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {temMais ? (
        <div className="border-t border-border px-3 py-2 text-center">
          <Button variant="secondary" onClick={() => setExpandido((e) => !e)}>
            {expandido
              ? "Recolher"
              : `Expandir · ver todos os ${ordenadas.length} itens`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function FilaExcecoes({
  empresaId,
  excecoes,
  aoResolver,
}: {
  empresaId: string;
  excecoes: LinhaExcedente[];
  aoResolver: () => void;
}) {
  return (
    <Card className="space-y-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">Exceções — decisão do analista</h3>
        <p className="text-xs text-fg-muted">
          O sistema pode sugerir, mas quem confirma é você. Linha sem decisão
          fica de fora da criação e aparece no relatório.
        </p>
      </div>
      {excecoes.map((l) => (
        <CartaoExcecao
          key={l.id}
          empresaId={empresaId}
          linha={l}
          aoResolver={aoResolver}
        />
      ))}
    </Card>
  );
}

function CartaoExcecao({
  empresaId,
  linha,
  aoResolver,
}: {
  empresaId: string;
  linha: LinhaExcedente;
  aoResolver: () => void;
}) {
  const [nCodServ, setNCodServ] = useState(linha.nCodServ ? String(linha.nCodServ) : "");
  const [categoria, setCategoria] = useState(linha.categoria ?? "");
  const [descricao, setDescricao] = useState(linha.descExcedente ?? "");
  const [gravarDePara, setGravarDePara] = useState(true);
  const [semContrato, setSemContrato] = useState(!linha.nCodCtr);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const precisaServico = !linha.nCodServ;

  async function executar(
    decisao: Parameters<typeof resolverExcecao>[2],
  ): Promise<void> {
    setOcupado(true);
    setErro(null);
    const r = await resolverExcecao(empresaId, linha.id, decisao);
    setOcupado(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    aoResolver();
  }

  function resolver() {
    if (precisaServico || nCodServ.trim()) {
      const n = Number(nCodServ.trim());
      if (!Number.isInteger(n) || n <= 0) {
        setErro("Informe o código do serviço excedente no Omie (nCodServ).");
        return;
      }
      void executar({
        tipo: "escolher_servico",
        nCodServ: n,
        categoria: categoria.trim() || undefined,
        descricao: descricao.trim() || undefined,
        gravarDePara,
        criarSemContrato: semContrato,
      });
    } else {
      void executar({ tipo: "criar_sem_contrato" });
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{linha.cliente}</span>
        <span className="text-fg-subtle">linha {linha.linhaPlanilha}</span>
        <span className="tabular-nums">{reais(linha.valorTotal)}</span>
        <Badge tone="danger">{linha.excecaoMotivo}</Badge>
      </div>
      <p className="text-xs text-fg-muted">
        {linha.descricao} · serviço recorrente {linha.codRecorrente} · CNPJ {linha.cnpj}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-fg-muted">
          Serviço excedente no Omie (nCodServ)
          <input
            className="mt-1 block w-44 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            value={nCodServ}
            onChange={(e) => setNCodServ(e.target.value)}
            placeholder="ex.: 2174029906"
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Categoria
          <input
            className="mt-1 block w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="1.01.02"
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Descrição do serviço
          <input
            className="mt-1 block w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            disabled={ocupado}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={gravarDePara}
            onChange={(e) => setGravarDePara(e.target.checked)}
            disabled={ocupado}
          />
          gravar no De/Para para os próximos meses
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={semContrato}
            onChange={(e) => setSemContrato(e.target.checked)}
            disabled={ocupado || !linha.nCodCtr}
          />
          criar SEM contrato (vencimento hoje+3 dias úteis, e-mail do cadastro do cliente)
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={resolver} disabled={ocupado}>
          {ocupado ? "Salvando…" : "Confirmar e incluir na criação"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void executar({ tipo: "ignorar" })}
          disabled={ocupado}
        >
          Deixar fora (só relatório)
        </Button>
      </div>
      {erro ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{erro}</p>
      ) : null}
    </div>
  );
}

function exportarCsv(linhas: LinhaExcedente[]): void {
  const cab = [
    "linha_planilha", "cliente", "cnpj", "servico_recorrente", "cod_recorrente",
    "contrato", "forma", "contrato_acao", "contrato_valor_atual",
    "servico_excedente", "valor_total", "vencimento", "regra_venc",
    "email_envio", "status", "avisos", "excecao", "cCodIntOS", "numero_os",
    "criacao_status", "criacao_erro",
  ];
  const corpo = linhas.map((l) =>
    [
      l.linhaPlanilha, l.cliente, l.cnpj, l.descricao, l.codRecorrente,
      l.numeroContrato ?? "", l.formaFaturamento, l.contratoAcao ?? "",
      l.contratoValorAtual ?? "",
      l.descExcedente ?? "", l.valorTotal,
      dataBr(l.vencFinal), l.regraVenc ?? "", l.emailEnvio ?? "", l.status,
      l.avisos.join("; "), l.excecaoMotivo ?? "", l.codigoIntOs ?? "",
      l.numeroOs ?? "", l.criacaoStatus ?? "", l.criacaoErro ?? "",
    ]
      .map((c) => `"${String(c).replaceAll('"', '""')}"`)
      .join(";"),
  );
  const csv = "﻿" + [cab.join(";"), ...corpo].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "excedentes.csv";
  a.click();
  URL.revokeObjectURL(url);
}
