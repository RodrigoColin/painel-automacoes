"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Td } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { IconUpload } from "@/components/icons";
import {
  aprovarCriacao,
  consultarExcedentes,
  enfileirarExcedentes,
  listarDePara,
  resolverExcecao,
  type LinhaExcedente,
  type SelecaoAprovacao,
  type StatusLote,
} from "@/lib/acoes-excedentes";

const EM_ANDAMENTO = ["na_fila", "planejando", "aprovado", "criando"];

// Checklist de progresso em linguagem do operador. O worker grava a etapa
// como "nome" ou "nome:atual/total" — o sufixo vira contador e barra.
type PassoProgresso = { chaves: string[]; rotulo: string; unidade?: string };

const PASSOS_PLANO: PassoProgresso[] = [
  { chaves: ["iniciando", "de_para"], rotulo: "Ler a planilha" },
  {
    chaves: ["clientes_contratos"],
    rotulo: "Localizar clientes e contratos no Omie",
    unidade: "linha",
  },
  {
    chaves: ["detalhes_contratos", "detalhes_clientes"],
    rotulo: "Buscar vencimentos e e-mails",
    unidade: "contrato",
  },
  { chaves: ["idempotencia"], rotulo: "Conferir o que já existe no Omie" },
  { chaves: ["montando"], rotulo: "Montar a prévia" },
];

const PASSOS_CRIACAO: PassoProgresso[] = [
  { chaves: ["iniciando", "montando"], rotulo: "Preparar o que você aprovou" },
  { chaves: ["criando"], rotulo: "Criar as OSs no Omie", unidade: "OS" },
  {
    chaves: ["contratos"],
    rotulo: "Aplicar excedentes nos contratos",
    unidade: "contrato",
  },
];

function CardProcessando({
  status,
  etapa,
  nomeArquivo,
}: {
  status: StatusLote["status"];
  etapa?: string | null;
  nomeArquivo?: string | null;
}) {
  if (status === "na_fila") {
    return (
      <Card className="flex items-center gap-3 p-5">
        <Spinner />
        <div>
          <p className="text-sm font-medium">
            Aguardando a vez — outro arquivo está sendo processado.
          </p>
          <p className="text-xs text-fg-muted">Começa sozinho, não precisa fazer nada.</p>
        </div>
      </Card>
    );
  }

  const faseCriacao = status === "aprovado" || status === "criando";
  const passos = faseCriacao ? PASSOS_CRIACAO : PASSOS_PLANO;
  const [nomeEtapa, progresso] = (etapa ?? "").split(":");
  const [atual, total] = (progresso ?? "")
    .split("/")
    .map((n) => Number(n) || 0);
  const indiceAtual = Math.max(
    0,
    passos.findIndex((p) => p.chaves.includes(nomeEtapa)),
  );

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <Spinner />
        <div>
          <p className="text-sm font-medium">
            {faseCriacao
              ? "Criando no Omie o que você aprovou…"
              : `Processando ${nomeArquivo ?? "a planilha"}…`}
          </p>
          <p className="text-xs text-fg-muted">
            {faseCriacao
              ? "Esta é a única fase que grava no Omie — exatamente o que o resumo mostrou."
              : "Lendo e conferindo com o Omie — nada é gravado nesta fase."}
          </p>
        </div>
      </div>

      <ol className="space-y-2">
        {passos.map((p, i) => {
          const feito = i < indiceAtual;
          const atualPasso = i === indiceAtual;
          return (
            <li key={p.rotulo} className="text-sm">
              <div className="flex items-center gap-2">
                {feito ? (
                  <span className="w-4 text-center text-success">✓</span>
                ) : atualPasso ? (
                  <span className="flex w-4 justify-center">
                    <Spinner pequeno />
                  </span>
                ) : (
                  <span className="w-4 text-center text-fg-subtle">○</span>
                )}
                <span
                  className={clsx(
                    feito && "text-fg-muted",
                    atualPasso && "font-medium",
                    !feito && !atualPasso && "text-fg-subtle",
                  )}
                >
                  {p.rotulo}
                </span>
                {atualPasso && atual > 0 && total > 0 ? (
                  <span className="ml-auto text-xs tabular-nums text-fg-muted">
                    {p.unidade ?? "item"} {atual} de {total}
                  </span>
                ) : null}
              </div>
              {atualPasso && atual > 0 && total > 0 ? (
                <div className="ml-6 mt-1.5 h-1 overflow-hidden rounded bg-surface-muted">
                  <div
                    className="h-full bg-accent transition-all duration-500"
                    style={{ width: `${Math.min(100, (atual / total) * 100)}%` }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-fg-subtle">
        ⏱{" "}
        {faseCriacao
          ? "Normalmente leva menos de um minuto."
          : "Costuma levar de 2 a 4 minutos."}{" "}
        Pode sair desta tela — o processamento continua e o resultado estará
        aqui quando você voltar.
      </p>
    </Card>
  );
}

function Spinner({ pequeno }: { pequeno?: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block shrink-0 animate-spin rounded-full border-2 border-border border-t-accent",
        pequeno ? "size-3" : "mt-0.5 size-4",
      )}
    />
  );
}

// Traduz os erros conhecidos para o operador, com a próxima ação.
function erroAmigavel(
  erro: string,
  concluidoEm: string | null | undefined,
): { texto: string; acao: string } | null {
  const baixo = erro.toLowerCase();
  if (baixo.includes("interrompido")) {
    return {
      texto: "O processamento foi interrompido por uma atualização do sistema.",
      acao: "Reenvie a planilha — nada foi gravado no Omie.",
    };
  }
  if (baixo.includes("consumo indevido") || baixo.includes("bloqueada")) {
    let acao = "Aguarde cerca de 30 minutos e reenvie a planilha.";
    if (concluidoEm) {
      const libera =
        new Date(concluidoEm.replace(" ", "T")).getTime() + 30 * 60 * 1000;
      if (Number.isFinite(libera)) {
        acao =
          libera > Date.now()
            ? `Tente novamente depois das ${new Date(libera).toLocaleTimeString(
                "pt-BR",
                { hour: "2-digit", minute: "2-digit" },
              )}.`
            : "Já deve ter liberado — reenvie a planilha.";
      }
    }
    return {
      texto:
        "O Omie limitou as consultas por 30 minutos (proteção do próprio Omie contra excesso de chamadas).",
      acao,
    };
  }
  return null;
}

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

type ExclusaoContrato = {
  n_cod_ctr: number;
  numero_contrato: string;
  cliente: string | null;
  n_cod_serv: number;
  desc_excedente: string;
  valor_atual: string | null;
};

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

type PrefsTabela = {
  filtros?: Partial<Record<ColunaOs, string>>;
  coluna?: ColunaOs;
  dir?: 1 | -1;
  detalhes?: boolean;
};

function lerPrefsTabela(empresaId: string): PrefsTabela | null {
  if (typeof window === "undefined") return null;
  try {
    const salvo = sessionStorage.getItem(`excedentes-tabela-${empresaId}`);
    if (!salvo) return null;
    const p = JSON.parse(salvo) as PrefsTabela;
    return {
      filtros: p.filtros && typeof p.filtros === "object" ? p.filtros : undefined,
      coluna: COLUNAS.some(({ c }) => c === p.coluna) ? p.coluna : undefined,
      dir: p.dir === 1 || p.dir === -1 ? p.dir : undefined,
      detalhes: typeof p.detalhes === "boolean" ? p.detalhes : undefined,
    };
  } catch {
    return null; // preferências corrompidas: segue com o padrão
  }
}

// Seleção gravada na aprovação (lote.resumo.selecao) — depois de aprovado,
// é ela quem diz o que ficou de fora do lote.
type SelecaoGravada = { oss: string[] | null; contratos: number[] | null };

function lerSelecaoGravada(resumo: Record<string, unknown> | null | undefined): SelecaoGravada | null {
  const bruto = resumo?.selecao as { oss?: unknown; contratos?: unknown } | undefined;
  if (!bruto || typeof bruto !== "object") return null;
  return {
    oss: Array.isArray(bruto.oss) ? bruto.oss.map(String) : null,
    contratos: Array.isArray(bruto.contratos) ? bruto.contratos.map(Number) : null,
  };
}

export function PainelExcedentes({ empresaId }: { empresaId: string }) {
  const [lote, setLote] = useState<StatusLote | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aprovando, setAprovando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  // Bump reinicia o polling (novo upload, aprovação, exceção resolvida).
  const [versao, setVersao] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seleção do analista: guarda os DESMARCADOS (padrão = tudo selecionado).
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [modalAberto, setModalAberto] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false);

  // Filtros e ordenação da tabela vivem aqui (os badges do resumo filtram a
  // tabela) e sobrevivem a recarregar a página (sessionStorage por empresa).
  // Inicializar lendo o storage é seguro: a tabela só aparece depois do
  // primeiro poll (client-side), então nada disso entra no HTML do servidor.
  const [filtros, setFiltros] = useState<Partial<Record<ColunaOs, string>>>(
    () => lerPrefsTabela(empresaId)?.filtros ?? {},
  );
  const [coluna, setColuna] = useState<ColunaOs>(
    () => lerPrefsTabela(empresaId)?.coluna ?? "valor",
  );
  const [dir, setDir] = useState<1 | -1>(() => lerPrefsTabela(empresaId)?.dir ?? -1);
  // Colunas técnicas (e-mail de envio) escondidas por padrão p/ o operador.
  const [detalhes, setDetalhes] = useState<boolean>(
    () => lerPrefsTabela(empresaId)?.detalhes ?? false,
  );

  const refRemocoes = useRef<HTMLDivElement>(null);
  const refExcecoes = useRef<HTMLDivElement>(null);
  const refIgnoradas = useRef<HTMLDivElement>(null);

  const atualizar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        `excedentes-tabela-${empresaId}`,
        JSON.stringify({ filtros, coluna, dir, detalhes }),
      );
    } catch {
      // storage cheio/indisponível: sem drama
    }
  }, [empresaId, filtros, coluna, dir, detalhes]);

  // Novo lote = seleção volta ao padrão (tudo marcado). Padrão "derivar
  // durante o render" (não effect): aplica antes de pintar, sem cascata.
  const loteId = lote?.loteId;
  const [loteIdVisto, setLoteIdVisto] = useState<number | undefined>(loteId);
  if (loteIdVisto !== loteId) {
    setLoteIdVisto(loteId);
    setDesmarcados(new Set());
    setModalAberto(false);
  }

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
    // 2s: suficiente p/ a barra de progresso andar fluida; o polling para
    // sozinho no primeiro estado terminal.
    timer = setInterval(() => void tick(), 2000);
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
  const exclusoes =
    (lote?.resumo?.exclusoes_contrato as ExclusaoContrato[] | undefined) ?? [];
  const aguardando = lote?.status === "aguardando_aprovacao";
  const concluido = lote?.status === "concluido";
  const criacao = (lote?.resumo as { criacao?: Record<string, unknown> } | null)
    ?.criacao as Record<string, unknown> | undefined;

  /* ------------------------------ seleção ------------------------------ */

  // Contagens por ação de contrato, para o resumo em palavras e o modal.
  const linhasContrato = contratos.flatMap((g) => g.linhas);
  const ctrManter = linhasContrato.filter((l) => l.contratoAcao === "manter").length;
  const ctrMudar = linhasContrato.length - ctrManter;

  const selecionado = (o: OsAgrupada) => !desmarcados.has(o.codigo);
  const ossSelecionadas = ossNovas.filter(selecionado);
  const contratosSelecionados = contratos.filter(selecionado);
  const valorOssSel = ossSelecionadas.reduce((s, o) => s + o.valor, 0);
  const valorCtrSel = contratosSelecionados.reduce((s, o) => s + o.valor, 0);
  const ctrSelecionadosNcod = new Set(
    contratosSelecionados
      .map((g) => g.linhas[0]?.nCodCtr)
      .filter((n): n is number => n != null),
  );
  // Contrato desmarcado pula a reconciliação inteira — remoções inclusive.
  const exclusoesAtivas = exclusoes.filter((e) => ctrSelecionadosNcod.has(e.n_cod_ctr));
  const totalDesmarcados =
    ossNovas.length - ossSelecionadas.length + contratos.length - contratosSelecionados.length;
  const valorDesmarcados =
    valorNovas - valorOssSel + valorContratos - valorCtrSel;

  function alternarGrupo(codigo: string) {
    setDesmarcados((d) => {
      const novo = new Set(d);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  }

  function alternarVarios(codigos: string[], marcar: boolean) {
    setDesmarcados((d) => {
      const novo = new Set(d);
      for (const c of codigos) {
        if (marcar) novo.delete(c);
        else novo.add(c);
      }
      return novo;
    });
  }

  // Depois de aprovado, quem diz o que ficou de fora é a seleção gravada.
  const selecaoGravada = lerSelecaoGravada(lote?.resumo);

  function grupoForaDoLote(o: OsAgrupada): boolean {
    if (aguardando) return !selecionado(o);
    if (!selecaoGravada) return false;
    if (o.forma === "contrato") {
      const n = o.linhas[0]?.nCodCtr;
      return (
        selecaoGravada.contratos != null &&
        n != null &&
        !selecaoGravada.contratos.includes(n)
      );
    }
    if (o.jaExiste) return false;
    return selecaoGravada.oss != null && !selecaoGravada.oss.includes(o.codigo);
  }

  function linhaForaDoLote(l: LinhaExcedente): boolean {
    if (!["ok", "resolvida"].includes(l.status)) return false;
    if (l.formaFaturamento === "contrato") {
      if (aguardando) return desmarcados.has(`ctr:${l.numeroContrato}`);
      return (
        selecaoGravada?.contratos != null &&
        l.nCodCtr != null &&
        !selecaoGravada.contratos.includes(l.nCodCtr)
      );
    }
    if (aguardando) return l.codigoIntOs != null && desmarcados.has(l.codigoIntOs);
    return (
      selecaoGravada?.oss != null &&
      l.codigoIntOs != null &&
      !selecaoGravada.oss.includes(l.codigoIntOs)
    );
  }

  async function aprovar() {
    if (!lote?.loteId) return;
    const selecao: SelecaoAprovacao = {
      oss: ossSelecionadas.map((o) => o.codigo),
      contratos: [...ctrSelecionadosNcod],
    };
    setAprovando(true);
    setErroAcao(null);
    const r = await aprovarCriacao(empresaId, lote.loteId, selecao);
    setAprovando(false);
    if (r.erro) {
      setErroAcao(r.erro);
      return;
    }
    setModalAberto(false);
    setLote({ ...lote, status: "aprovado" });
    atualizar();
  }

  /* -------------------------- badges que filtram ------------------------- */

  function filtroBadgeAtivo(mapa: Partial<Record<ColunaOs, string>>): boolean {
    return Object.entries(mapa).every(([c, v]) => filtros[c as ColunaOs] === v);
  }

  function alternarFiltroBadge(mapa: Partial<Record<ColunaOs, string>>) {
    setFiltros((f) => {
      const novo = { ...f };
      if (filtroBadgeAtivo(mapa)) {
        for (const c of Object.keys(mapa)) delete novo[c as ColunaOs];
      } else {
        Object.assign(novo, mapa);
      }
      return novo;
    });
  }

  function rolarAte(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-4">
      <Card
        className={clsx(
          "space-y-4 p-5 transition-shadow",
          arrastando && "ring-2 ring-ring",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (enviando || processando) return;
          const arquivo = e.dataTransfer.files?.[0];
          if (!arquivo) return;
          if (!arquivo.name.toLowerCase().endsWith(".xlsx")) {
            setErroAcao("Use um arquivo .xlsx.");
            return;
          }
          void enviar(arquivo);
        }}
      >
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
          {!enviando && !processando ? (
            <span className="text-xs text-fg-subtle">
              {arrastando ? "Solte o arquivo para enviar" : "ou arraste o arquivo até aqui"}
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
        {lote?.status === "erro" && lote.erro
          ? (() => {
              const amigavel = erroAmigavel(lote.erro, lote.concluidoEm);
              return (
                <div
                  className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger"
                  title={lote.erro}
                >
                  <p>{amigavel ? amigavel.texto : lote.erro}</p>
                  {amigavel ? (
                    <p className="mt-1 text-xs opacity-80">{amigavel.acao}</p>
                  ) : null}
                </div>
              );
            })()
          : null}
      </Card>

      {processando && lote ? (
        <CardProcessando
          status={lote.status}
          etapa={lote.etapa}
          nomeArquivo={lote.planilhaNome}
        />
      ) : null}

      {lote?.status === "nenhum" ? (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">Como funciona</h3>
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-fg-muted">
            <li>Baixe a planilha mensal de excedentes enviada pela OYSTR (.xlsx).</li>
            <li>Arraste o arquivo para o quadro acima (ou clique em “Escolher planilha”).</li>
            <li>
              O sistema monta a prévia e compara tudo com o Omie —{" "}
              <b>sem escrever nada</b>. Badges cinza (“já no Omie”, “já no
              contrato”) significam que não há nada a fazer naquela linha.
            </li>
            <li>Resolva o que aparecer em “precisam de decisão” e desmarque o que não quiser enviar.</li>
            <li>
              Clique em <b>Aprovar</b> e confira o resumo — só depois dessa
              confirmação algo é criado no Omie, sempre na etapa Faturar
              (nunca faturado).
            </li>
          </ol>
          <p className="text-xs text-fg-subtle">
            Enviou algo errado? Sem pânico: reenviar a mesma planilha não
            duplica nada — o que já existe aparece como “já no Omie”.
          </p>
        </Card>
      ) : null}

      {linhas.length > 0 ? (
        <>
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeFiltro
                tone="success"
                ativo={filtroBadgeAtivo({ forma: "os", situacao: "a criar" })}
                onClick={() => alternarFiltroBadge({ forma: "os", situacao: "a criar" })}
                title="Filtrar a tabela pelas OSs a criar"
              >
                {ossNovas.length} OS a criar · {reais(valorNovas)}
              </BadgeFiltro>
              {contratos.length > 0 ? (
                <BadgeFiltro
                  tone="warning"
                  ativo={filtroBadgeAtivo({ forma: "contrato" })}
                  onClick={() => alternarFiltroBadge({ forma: "contrato" })}
                  title="Filtrar a tabela pelos excedentes que vão dentro do contrato"
                >
                  {contratos.length} no contrato · {reais(valorContratos)}
                </BadgeFiltro>
              ) : null}
              {exclusoes.length > 0 ? (
                <BadgeFiltro
                  tone="danger"
                  ativo={false}
                  onClick={() => rolarAte(refRemocoes)}
                  title="Ver o que será removido dos contratos"
                >
                  {exclusoes.length} a remover do contrato
                </BadgeFiltro>
              ) : null}
              {excecoes.length > 0 ? (
                <BadgeFiltro
                  tone="danger"
                  ativo={false}
                  onClick={() => rolarAte(refExcecoes)}
                  title="Ver as linhas que o sistema não resolveu sozinho"
                >
                  {excecoes.length} precisam de decisão
                </BadgeFiltro>
              ) : null}
              {ossExistentes.length > 0 ? (
                <BadgeFiltro
                  tone="neutral"
                  ativo={filtroBadgeAtivo({ situacao: "já no omie" })}
                  onClick={() => alternarFiltroBadge({ situacao: "já no omie" })}
                  title="Filtrar a tabela pelas OSs que já existem no Omie"
                >
                  {ossExistentes.length} já no Omie
                </BadgeFiltro>
              ) : null}
              {ignoradas.length > 0 ? (
                <BadgeFiltro
                  tone="neutral"
                  ativo={mostrarIgnoradas}
                  onClick={() => {
                    setMostrarIgnoradas((v) => !v);
                    if (!mostrarIgnoradas) setTimeout(() => rolarAte(refIgnoradas), 50);
                  }}
                  title="Ver as linhas deixadas de fora pelo analista"
                >
                  {ignoradas.length} ignorada(s)
                </BadgeFiltro>
              ) : null}
              <span className="text-xs text-fg-subtle">
                {linhas.length} linha(s) processável(is)
                {lote?.resumo?.linhas_ignoradas
                  ? ` · ${String(lote.resumo.linhas_ignoradas)} já marcadas na planilha`
                  : ""}
              </span>
            </div>

            {aguardando ? (
              <p className="text-xs text-fg-muted">
                Em palavras:{" "}
                {[
                  ossNovas.length
                    ? `${ossNovas.length} cobrança(s) nova(s) por OS (${reais(valorNovas)})`
                    : "",
                  ctrMudar
                    ? `${ctrMudar} item(ns) de contrato para ajustar`
                    : "",
                  ctrManter
                    ? `${ctrManter} já certo(s) no Omie — nada a fazer para eles`
                    : "",
                  excecoes.length
                    ? `${excecoes.length} linha(s) esperando sua decisão`
                    : "",
                  exclusoes.length
                    ? `${exclusoes.length} item(ns) saem do contrato`
                    : "",
                  ossExistentes.length
                    ? `${ossExistentes.length} OS já criadas antes`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "nada a fazer neste lote"}
                .
              </p>
            ) : null}

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
                <Button variant="secondary" onClick={() => exportarCsv(linhas, linhaForaDoLote)}>
                  Exportar relatório (CSV)
                </Button>
              </div>
            ) : null}

            {aguardando ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => setModalAberto(true)}
                  disabled={
                    aprovando ||
                    (ossSelecionadas.length === 0 && contratosSelecionados.length === 0)
                  }
                >
                  {aprovando
                    ? "Enviando…"
                    : `Aprovar · ${ossSelecionadas.length} OS` +
                      (contratosSelecionados.length
                        ? ` + ${contratosSelecionados.length} contrato(s)`
                        : "")}
                </Button>
                <span className="text-xs text-fg-subtle">
                  {totalDesmarcados > 0
                    ? `${totalDesmarcados} destino(s) desmarcado(s) ficam de fora (${reais(valorDesmarcados)}). `
                    : ""}
                  Nada é escrito no Omie antes desta aprovação.
                  {excecoes.length > 0
                    ? ` ${excecoes.length} linha(s) sem decisão ficam de fora até você resolvê-las.`
                    : ""}
                </span>
                <Button variant="secondary" onClick={() => exportarCsv(linhas, linhaForaDoLote)}>
                  Exportar plano (CSV)
                </Button>
              </div>
            ) : null}
          </Card>

          {exclusoes.length > 0 ? (
            <div ref={refRemocoes}>
              <Card className="space-y-2 p-5">
                <div>
                  <h3 className="text-sm font-semibold text-danger">
                    Serão removidos dos contratos ({exclusoesAtivas.length}
                    {exclusoesAtivas.length !== exclusoes.length
                      ? ` de ${exclusoes.length}`
                      : ""}
                    )
                  </h3>
                  <p className="text-xs text-fg-muted">
                    Excedentes que hoje estão no contrato mas não vêm na base deste
                    mês. Ao aprovar, são excluídos do contrato (o recorrente não é
                    tocado).
                    {exclusoesAtivas.length !== exclusoes.length
                      ? " Remoção de contrato desmarcado na tabela não é executada."
                      : ""}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse whitespace-nowrap text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-fg-subtle">
                        <th className="px-3 py-1.5">Cliente</th>
                        <th className="px-3 py-1.5">Contrato</th>
                        <th className="px-3 py-1.5">Serviço excedente</th>
                        <th className="px-3 py-1.5 text-right">Valor atual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exclusoes.map((e, i) => {
                        const pulada =
                          aguardando && !ctrSelecionadosNcod.has(e.n_cod_ctr);
                        return (
                          <tr
                            key={`${e.n_cod_ctr}-${e.n_cod_serv}-${i}`}
                            className={clsx("border-t border-border", pulada && "opacity-50")}
                          >
                            <td className="px-3 py-2">
                              <span className="block max-w-[16rem] truncate" title={e.cliente ?? ""}>
                                {e.cliente}
                              </span>
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {e.numero_contrato}
                              {pulada ? (
                                <span className="ml-2 text-xs text-fg-subtle">
                                  (contrato desmarcado — não remove)
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <span className="block max-w-[24rem] truncate" title={e.desc_excedente}>
                                {e.desc_excedente}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {reais(e.valor_atual ?? "0")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : null}

          {excecoes.length > 0 && aguardando ? (
            <div ref={refExcecoes}>
              <FilaExcecoes
                empresaId={empresaId}
                excecoes={excecoes}
                aoResolver={() => void atualizar()}
              />
            </div>
          ) : null}

          {ignoradas.length > 0 && mostrarIgnoradas ? (
            <div ref={refIgnoradas}>
              <Card className="space-y-2 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Linhas ignoradas ({ignoradas.length})
                    </h3>
                    <p className="text-xs text-fg-muted">
                      Deixadas de fora pelo analista na fila de exceções — não entram
                      na criação, só no relatório.
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setMostrarIgnoradas(false)}>
                    Fechar
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse whitespace-nowrap text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-fg-subtle">
                        <th className="px-3 py-1.5">Linha</th>
                        <th className="px-3 py-1.5">Cliente</th>
                        <th className="px-3 py-1.5">Serviço (planilha)</th>
                        <th className="px-3 py-1.5 text-right">Valor</th>
                        <th className="px-3 py-1.5">Motivo original</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ignoradas.map((l) => (
                        <tr key={l.id} className="border-t border-border">
                          <td className="px-3 py-2 tabular-nums">{l.linhaPlanilha}</td>
                          <td className="px-3 py-2">
                            <span className="block max-w-[16rem] truncate" title={l.cliente ?? ""}>
                              {l.cliente}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="block max-w-[24rem] truncate" title={l.descricao ?? ""}>
                              {l.descricao}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {reais(l.valorTotal)}
                          </td>
                          <td className="px-3 py-2">
                            <span className="block max-w-[20rem] truncate" title={l.excecaoMotivo ?? ""}>
                              {l.excecaoMotivo ?? "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : null}

          <TabelaOss
            oss={grupos}
            filtros={filtros}
            aoMudarFiltros={setFiltros}
            detalhes={detalhes}
            aoAlternarDetalhes={() => {
              // Esconder a coluna também desativa o filtro dela (um filtro
              // invisível e ativo confundiria).
              if (detalhes) {
                setFiltros((f) => {
                  const novo = { ...f };
                  delete novo.email;
                  return novo;
                });
              }
              setDetalhes(!detalhes);
            }}
            coluna={coluna}
            dir={dir}
            aoMudarOrdem={(c, d) => {
              setColuna(c);
              setDir(d);
            }}
            selecionavel={aguardando}
            estaSelecionado={(o) => selecionado(o)}
            aoAlternar={alternarGrupo}
            aoAlternarVarios={alternarVarios}
            foraDoLote={grupoForaDoLote}
          />

          {modalAberto && lote?.loteId ? (
            <ModalAprovacao
              ossSelecionadas={ossSelecionadas}
              contratosSelecionados={contratosSelecionados}
              valorOss={valorOssSel}
              valorContratos={valorCtrSel}
              exclusoesAtivas={exclusoesAtivas}
              exclusoesPuladas={exclusoes.length - exclusoesAtivas.length}
              totalDesmarcados={totalDesmarcados}
              valorDesmarcados={valorDesmarcados}
              excecoesPendentes={excecoes.length}
              aprovando={aprovando}
              aoConfirmar={() => void aprovar()}
              aoCancelar={() => setModalAberto(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ----------------------------- modal de aprovação ----------------------------- */

function ModalAprovacao({
  ossSelecionadas,
  contratosSelecionados,
  valorOss,
  valorContratos,
  exclusoesAtivas,
  exclusoesPuladas,
  totalDesmarcados,
  valorDesmarcados,
  excecoesPendentes,
  aprovando,
  aoConfirmar,
  aoCancelar,
}: {
  ossSelecionadas: OsAgrupada[];
  contratosSelecionados: OsAgrupada[];
  valorOss: number;
  valorContratos: number;
  exclusoesAtivas: ExclusaoContrato[];
  exclusoesPuladas: number;
  totalDesmarcados: number;
  valorDesmarcados: number;
  excecoesPendentes: number;
  aprovando: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const linhasCtr = contratosSelecionados.flatMap((g) => g.linhas);
  const atualizacoes = linhasCtr.filter((l) => l.contratoAcao === "atualizar").length;
  const mantidos = linhasCtr.filter((l) => l.contratoAcao === "manter").length;
  const inclusoes = linhasCtr.length - atualizacoes - mantidos;
  const valorRemocoes = exclusoesAtivas.reduce(
    (s, e) => s + Number(e.valor_atual ?? 0),
    0,
  );

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoCancelar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoCancelar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={aoCancelar}
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar aprovação"
    >
      <Card
        className="w-full max-w-lg space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold">Confirmar aprovação</h3>
          <p className="text-xs text-fg-muted">
            Esta é a única escrita no Omie. As OSs entram na etapa Faturar (50) —
            nada é faturado pelo portal.
          </p>
        </div>

        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-2">
            <span>
              <Badge tone="success">{ossSelecionadas.length} OS</Badge>{" "}
              serão criadas no Omie
            </span>
            <span className="tabular-nums">{reais(valorOss)}</span>
          </li>
          {contratosSelecionados.length > 0 ? (
            <li className="flex items-center justify-between gap-2">
              <span>
                <Badge tone="warning">{contratosSelecionados.length} contrato(s)</Badge>{" "}
                dia 2 recebem o excedente dentro do contrato
                {atualizacoes || inclusoes || mantidos
                  ? ` (${[
                      atualizacoes ? `${atualizacoes} atualização(ões) de valor` : "",
                      inclusoes ? `${inclusoes} inclusão(ões)` : "",
                      mantidos
                        ? `${mantidos} já correto(s) — nada será enviado`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(", ")})`
                  : ""}
              </span>
              <span className="tabular-nums">{reais(valorContratos)}</span>
            </li>
          ) : null}
          {exclusoesAtivas.length > 0 ? (
            <li className="flex items-center justify-between gap-2 rounded-md bg-danger-bg px-2 py-1.5 text-danger">
              <span>
                <b>{exclusoesAtivas.length} item(ns) serão REMOVIDOS</b> dos
                contratos (não vêm na base deste mês)
              </span>
              <span className="tabular-nums">{reais(valorRemocoes)}</span>
            </li>
          ) : null}
        </ul>

        {totalDesmarcados > 0 || excecoesPendentes > 0 || exclusoesPuladas > 0 ? (
          <div className="rounded-md border border-border bg-surface-muted/40 p-3 text-xs text-fg-muted">
            <p className="font-medium text-fg">Fica de fora desta aprovação:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {totalDesmarcados > 0 ? (
                <li>
                  {totalDesmarcados} destino(s) desmarcado(s) na tabela (
                  {reais(valorDesmarcados)}) — para criá-los depois, reenvie a
                  planilha e aprove o restante.
                </li>
              ) : null}
              {exclusoesPuladas > 0 ? (
                <li>
                  {exclusoesPuladas} remoção(ões) de contrato desmarcado — o item
                  continua no contrato.
                </li>
              ) : null}
              {excecoesPendentes > 0 ? (
                <li>
                  {excecoesPendentes} linha(s) sem decisão — ficam só no relatório.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={aoCancelar} disabled={aprovando}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={aoConfirmar} disabled={aprovando}>
            {aprovando ? "Enviando…" : "Aprovar e criar no Omie"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- tabela --------------------------------- */

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

// Linguagem do operador, não do sistema: "vai ser criada" em vez de "pronta",
// "corrigida por você" em vez de "resolvida".
function labelSituacao(os: OsAgrupada): string {
  const l = os.linhas[0];
  if (l?.criacaoStatus === "criada") return `os ${l.numeroOs ?? ""} criada`;
  if (l?.criacaoStatus === "falha") return "falha";
  if (os.jaExiste || l?.criacaoStatus === "ja_existia")
    return `já no omie ${os.numeroOs ?? ""}`;
  if (os.linhas.some((x) => x.status === "resolvida")) return "corrigida por você";
  return "vai ser criada";
}

// "serviço" e "servico" devem casar no filtro. Remove os diacríticos da faixa
// de combinantes Unicode (0x300–0x36f) depois do normalize("NFD") — sem regex
// de propósito: a sequência escapada já foi corrompida por camada de
// ferramenta no caminho até o disco.
function semAcentos(s: string): string {
  const decomposta = s.normalize("NFD");
  let r = "";
  for (const ch of decomposta) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x300 || c > 0x36f) r += ch;
  }
  return r;
}

// Texto buscável por coluna (usado pelo filtro "contém"). A situação ganha o
// sufixo sintético "a criar" para o badge do resumo poder filtrar por ele.
const TEXTO: Record<ColunaOs, (os: OsAgrupada) => string> = {
  cliente: (os) => os.cliente ?? "",
  contrato: (os) => os.contrato ?? "sem contrato",
  forma: (os) => (os.forma === "contrato" ? "contrato" : "os"),
  servico: (os) => os.linhas.map((l) => l.descExcedente ?? l.descricao ?? "").join(" "),
  valor: (os) => `${os.valor} ${reais(os.valor)}`,
  vencimento: (os) => dataBr(os.linhas[0]?.vencFinal ?? null),
  email: (os) => os.linhas[0]?.emailEnvio ?? "",
  situacao: (os) => {
    const aCriar =
      os.forma === "os" && !os.jaExiste && !os.linhas[0]?.criacaoStatus
        ? " a criar"
        : "";
    return labelSituacao(os) + aCriar;
  },
};

function BadgeFiltro({
  tone,
  ativo,
  onClick,
  title,
  children,
}: {
  tone: React.ComponentProps<typeof Badge>["tone"];
  ativo: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge
        tone={tone}
        className={clsx(
          "cursor-pointer transition-shadow hover:opacity-80",
          ativo && "ring-2 ring-ring",
        )}
      >
        {children}
      </Badge>
    </button>
  );
}

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

function TabelaOss({
  oss,
  filtros,
  aoMudarFiltros,
  detalhes,
  aoAlternarDetalhes,
  coluna,
  dir,
  aoMudarOrdem,
  selecionavel,
  estaSelecionado,
  aoAlternar,
  aoAlternarVarios,
  foraDoLote,
}: {
  oss: OsAgrupada[];
  filtros: Partial<Record<ColunaOs, string>>;
  aoMudarFiltros: React.Dispatch<
    React.SetStateAction<Partial<Record<ColunaOs, string>>>
  >;
  detalhes: boolean;
  aoAlternarDetalhes: () => void;
  coluna: ColunaOs;
  dir: 1 | -1;
  aoMudarOrdem: (c: ColunaOs, d: 1 | -1) => void;
  selecionavel: boolean;
  estaSelecionado: (os: OsAgrupada) => boolean;
  aoAlternar: (codigo: string) => void;
  aoAlternarVarios: (codigos: string[], marcar: boolean) => void;
  foraDoLote: (os: OsAgrupada) => boolean;
}) {
  const [expandido, setExpandido] = useState(false);
  const refCabecalho = useRef<HTMLInputElement>(null);

  // Coluna de e-mail é detalhe técnico: fora por padrão (filtro dela idem).
  const colunas = detalhes ? COLUNAS : COLUNAS.filter(({ c }) => c !== "email");

  const ativos = colunas.filter(({ c }) => (filtros[c] ?? "").trim() !== "");
  const filtradas = oss.filter((os) =>
    ativos.every(({ c }) =>
      semAcentos(TEXTO[c](os).toLowerCase()).includes(
        semAcentos((filtros[c] ?? "").trim().toLowerCase()),
      ),
    ),
  );

  const ordenadas = [...filtradas].sort((a, b) => {
    const va = ACESSOR[coluna](a);
    const vb = ACESSOR[coluna](b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "pt-BR") * dir;
  });

  // Seleção em lote opera sobre o que está FILTRADO: filtre e marque/desmarque.
  // Grupos "já no Omie" não entram (não há o que criar). Lote sem NADA
  // selecionável (ex.: tudo "já no Omie") esconde checkbox e contador.
  const comSelecao =
    selecionavel && oss.some((o) => o.forma === "contrato" || !o.jaExiste);
  const selecionaveisFiltradas = filtradas.filter(
    (o) => o.forma === "contrato" || !o.jaExiste,
  );
  const selecionadasFiltradas = selecionaveisFiltradas.filter(estaSelecionado);
  const todasMarcadas =
    selecionaveisFiltradas.length > 0 &&
    selecionadasFiltradas.length === selecionaveisFiltradas.length;
  const parcial =
    selecionadasFiltradas.length > 0 &&
    selecionadasFiltradas.length < selecionaveisFiltradas.length;

  useEffect(() => {
    if (refCabecalho.current) refCabecalho.current.indeterminate = parcial;
  }, [parcial]);

  const somaFiltrada = filtradas.reduce((s, o) => s + o.valor, 0);
  const temFiltro = ativos.length > 0;

  if (oss.length === 0) return null;

  function ordenarPor(c: ColunaOs) {
    if (c === coluna) aoMudarOrdem(c, dir === 1 ? -1 : 1);
    else aoMudarOrdem(c, 1);
  }

  // Expandir/recolher é VERTICAL: compacto mostra as primeiras LIMITE OSs.
  const visiveis = expandido ? ordenadas : ordenadas.slice(0, LIMITE_COMPACTO);
  const temMais = ordenadas.length > LIMITE_COMPACTO;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs text-fg-subtle">
          {temFiltro
            ? `${filtradas.length} de ${oss.length} OS · ${reais(somaFiltrada)} · filtro ativo`
            : `${oss.length} OS · ${reais(somaFiltrada)} · clique no título da coluna para ordenar`}
          {comSelecao
            ? ` · ${selecionadasFiltradas.length} de ${selecionaveisFiltradas.length} selecionada(s)`
            : ""}
        </span>
        <div className="flex items-center gap-3">
          {temFiltro ? (
            <button
              className="text-xs font-medium text-brand hover:underline"
              onClick={() => aoMudarFiltros({})}
            >
              Limpar filtros
            </button>
          ) : null}
          <button
            className="text-xs font-medium text-fg-subtle hover:text-fg"
            onClick={aoAlternarDetalhes}
            title="Mostra/esconde colunas técnicas (e-mail de envio)"
          >
            {detalhes ? "Ocultar detalhes" : "Mostrar detalhes"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <thead>
            <tr>
              {comSelecao ? (
                <th className="sticky top-0 z-10 w-8 border-b border-border bg-surface-muted/60 px-3 py-2">
                  <input
                    ref={refCabecalho}
                    type="checkbox"
                    checked={todasMarcadas}
                    onChange={() =>
                      aoAlternarVarios(
                        selecionaveisFiltradas.map((o) => o.codigo),
                        !todasMarcadas,
                      )
                    }
                    aria-label="Marcar ou desmarcar tudo que está filtrado"
                    title="Marca/desmarca o que está filtrado"
                  />
                </th>
              ) : null}
              {colunas.map(({ c, label, right }) => (
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
              {comSelecao ? (
                <th className="border-b border-border bg-surface-muted/30 px-2 py-1.5" />
              ) : null}
              {colunas.map(({ c, right }) => (
                <th key={c} className="border-b border-border bg-surface-muted/30 px-2 py-1.5">
                  <input
                    value={filtros[c] ?? ""}
                    onChange={(e) =>
                      aoMudarFiltros((f) => ({ ...f, [c]: e.target.value }))
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
                <Td
                  className="py-6 text-center text-fg-subtle"
                  colSpan={colunas.length + (comSelecao ? 1 : 0)}
                >
                  Nenhum item corresponde ao filtro.
                </Td>
              </tr>
            ) : null}
            {visiveis.map((os) => {
              const podeSelecionar =
                comSelecao && (os.forma === "contrato" || !os.jaExiste);
              const marcado = estaSelecionado(os);
              const fora = foraDoLote(os);
              return os.linhas.map((l, i) => {
                // Só avisos relevantes (o "Líquido ≠ valor" foi removido;
                // pode estar gravado em lotes antigos).
                const avisos = l.avisos.filter((a) => !a.includes("Líquido"));
                return (
                  <tr
                    key={l.id}
                    className={clsx(
                      "border-t border-border",
                      podeSelecionar && !marcado && "opacity-50",
                    )}
                  >
                    {comSelecao ? (
                      <Td className="w-8">
                        {i === 0 && podeSelecionar ? (
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => aoAlternar(os.codigo)}
                            aria-label={`Incluir ${os.cliente ?? os.codigo} na aprovação`}
                          />
                        ) : null}
                      </Td>
                    ) : null}
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
                    {detalhes ? (
                      <Td>
                        <span className="block max-w-[16rem] truncate" title={l.emailEnvio ?? ""}>
                          {l.emailEnvio || "—"}
                        </span>
                      </Td>
                    ) : null}
                    <Td>
                      {!selecionavel && fora && !l.criacaoStatus ? (
                        <Badge
                          tone="neutral"
                          title="Desmarcado na aprovação — não foi criado; reenvie a planilha para aprovar depois"
                        >
                          fora do lote
                        </Badge>
                      ) : os.forma === "contrato" ? (
                        l.criacaoStatus === "contrato_incluido" ? (
                          <Badge tone="success">incluído no contrato</Badge>
                        ) : l.criacaoStatus === "contrato_atualizado" ? (
                          <Badge tone="success">atualizado no contrato</Badge>
                        ) : l.criacaoStatus === "contrato_mantido" ? (
                          <Badge
                            tone="neutral"
                            title="O valor já estava correto — nada foi enviado ao Omie"
                          >
                            já estava certo
                          </Badge>
                        ) : l.criacaoStatus === "falha" ? (
                          <Badge tone="danger" title={l.criacaoErro ?? ""}>
                            falha no contrato
                          </Badge>
                        ) : l.contratoAcao === "manter" ? (
                          <Badge
                            tone="neutral"
                            title="O contrato já está com este valor — nada será enviado ao Omie"
                          >
                            já no contrato · {reais(l.contratoValorAtual ?? l.valorTotal)}
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
                        <Badge
                          tone="warning"
                          title="Você resolveu esta linha na fila de decisões; será criada na aprovação"
                        >
                          corrigida por você
                        </Badge>
                      ) : (
                        <Badge tone="success" title="Será criada no Omie quando você aprovar">
                          vai ser criada
                        </Badge>
                      )}
                    </Td>
                  </tr>
                );
              });
            })}
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

/* -------------------------------- exceções -------------------------------- */

type OpcaoServico = {
  nCodServ: number;
  descricao: string;
  categoria: string | null;
};

function FilaExcecoes({
  empresaId,
  excecoes,
  aoResolver,
}: {
  empresaId: string;
  excecoes: LinhaExcedente[];
  aoResolver: () => void;
}) {
  // Serviços de excedente já conhecidos (distintos do De/Para): viram opções
  // do seletor nos cartões — o analista não precisa caçar o nCodServ no Omie.
  const [servicos, setServicos] = useState<OpcaoServico[]>([]);
  useEffect(() => {
    let vivo = true;
    void listarDePara(empresaId).then((r) => {
      if (!vivo || !r.itens) return;
      const porCodigo = new Map<number, OpcaoServico>();
      for (const i of r.itens) {
        if (!i.nCodServExcedente) continue;
        porCodigo.set(i.nCodServExcedente, {
          nCodServ: i.nCodServExcedente,
          descricao:
            i.descricaoExcedente ?? i.codExcedente ?? String(i.nCodServExcedente),
          categoria: i.categoriaExcedente,
        });
      }
      setServicos(
        [...porCodigo.values()].sort((a, b) =>
          a.descricao.localeCompare(b.descricao, "pt-BR"),
        ),
      );
    });
    return () => {
      vivo = false;
    };
  }, [empresaId]);

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">
          Linhas que precisam da sua decisão
        </h3>
        <p className="text-xs text-fg-muted">
          O sistema não conseguiu resolver estas sozinho. Quem confirma é você;
          linha sem decisão fica de fora da criação e aparece no relatório.
        </p>
      </div>
      {excecoes.map((l) => (
        <CartaoExcecao
          key={l.id}
          empresaId={empresaId}
          linha={l}
          servicos={servicos}
          aoResolver={aoResolver}
        />
      ))}
    </Card>
  );
}

function CartaoExcecao({
  empresaId,
  linha,
  servicos,
  aoResolver,
}: {
  empresaId: string;
  linha: LinhaExcedente;
  servicos: OpcaoServico[];
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
  const opcaoAtual = servicos.find((s) => String(s.nCodServ) === nCodServ.trim());

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
        {servicos.length > 0 ? (
          <label className="text-xs text-fg-muted">
            Serviço excedente conhecido (De/Para)
            <select
              className="mt-1 block w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              value={opcaoAtual ? String(opcaoAtual.nCodServ) : ""}
              onChange={(e) => {
                const op = servicos.find((s) => String(s.nCodServ) === e.target.value);
                if (!op) return;
                setNCodServ(String(op.nCodServ));
                setDescricao(op.descricao);
                if (op.categoria) setCategoria(op.categoria);
              }}
              disabled={ocupado}
            >
              <option value="">— escolher da lista ou digitar o código —</option>
              {servicos.map((s) => (
                <option key={s.nCodServ} value={String(s.nCodServ)}>
                  {s.descricao} ({s.nCodServ})
                </option>
              ))}
            </select>
          </label>
        ) : null}
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

/* ---------------------------------- CSV ---------------------------------- */

function exportarCsv(
  linhas: LinhaExcedente[],
  foraDoLote?: (l: LinhaExcedente) => boolean,
): void {
  const cab = [
    "linha_planilha", "cliente", "cnpj", "servico_recorrente", "cod_recorrente",
    "contrato", "forma", "contrato_acao", "contrato_valor_atual",
    "servico_excedente", "valor_total", "vencimento", "regra_venc",
    "email_envio", "status", "fora_da_selecao", "avisos", "excecao",
    "cCodIntOS", "numero_os", "criacao_status", "criacao_erro",
  ];
  const corpo = linhas.map((l) =>
    [
      l.linhaPlanilha, l.cliente, l.cnpj, l.descricao, l.codRecorrente,
      l.numeroContrato ?? "", l.formaFaturamento, l.contratoAcao ?? "",
      l.contratoValorAtual ?? "",
      l.descExcedente ?? "", l.valorTotal,
      dataBr(l.vencFinal), l.regraVenc ?? "", l.emailEnvio ?? "", l.status,
      foraDoLote?.(l) ? "sim" : "",
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
