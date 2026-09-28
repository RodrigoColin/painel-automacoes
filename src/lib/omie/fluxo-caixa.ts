/**
 * Fluxo de caixa diário de uma empresa, para a tela "Fluxo de caixa".
 *
 * Mesma lógica da rotina já em produção na Proos (`fluxo_caixa.py` e
 * `omie_mcp/tools/extrato.py`), portada para o painel:
 *
 * - A fonte é o extrato do Omie (`ListarExtrato`), uma chamada por conta
 *   corrente. Ele já traz o realizado e o previsto no mesmo lugar, pela data
 *   em que o dinheiro entra ou sai (`dDataLancamento`), e o valor de título em
 *   aberto já vem líquido de retenções (`nValorDocumento`).
 * - Passado: só o que foi efetivamente liquidado ("Conta Recebida"/"Conta
 *   Paga") e os lançamentos diretos na conta. De hoje em diante: tudo, inclusive
 *   a previsão nativa de contratos e ordens de serviço ainda não faturados.
 * - O registro sintético "SALDO ANTERIOR" dá o saldo real de abertura de cada
 *   conta; o saldo do dia é ele mais os movimentos realizados.
 * - `ListarExtrato` não pagina e trunca períodos longos em silêncio: a janela é
 *   consultada mês a mês. Chamadas seguidas ao mesmo método esperam 1,5 s, para
 *   não esbarrar na trava de "consumo redundante" do Omie.
 *
 * Regras da Proos aplicadas aqui: conta garantida é dívida, não caixa — fica
 * fora do caixa próprio e aparece como limite; aplicação só soma no caixa
 * quando marcada com liquidez imediata; o saldo mínimo é definido pela Proos.
 * Essas marcações ficam em `fluxo_caixa_config` (migração 0036).
 */

import { eq } from "drizzle-orm";
import { chamarOmie, ehBloqueioTemporario, ehListaVazia, ErroOmie, type CredenciaisOmie } from "@/lib/omie/cliente";
import { credenciaisDaEmpresa, type EstadoResumoOmie } from "@/lib/omie/resumo";
import { naSessao } from "@/lib/dal";
import type { Executor } from "@/lib/db";
import { fluxoCaixaConfig } from "@/lib/db/schema";

const DIAS_PASSADOS = 7;
const DIAS_FUTUROS = 45;

const VALIDADE_CACHE_MS = 10 * 60 * 1000;
const ESPERA_ENTRE_CHAMADAS_MS = 1500;

const ORIGENS_PREVISTAS = new Set([
  "Conta a Receber",
  "Conta a Pagar",
  "Previsão de Pedido de Compra",
  "Previsão de Pedido de Venda",
  "Previsão de Contratos Mensais",
  "Previsão de Ordem de Serviço",
]);

/* --------------------------------- Tipos --------------------------------- */

export type TipoConta = "corrente" | "aplicacao" | "garantida";

/** Marcação de uma conta, feita pela Proos na implantação. */
export type ConfigConta = {
  entra: boolean;
  tipo: TipoConta;
  /** Só para aplicação: soma no caixa próprio. */
  liquidezImediata: boolean;
  /** Só para conta garantida: limite contratado. */
  limite: number;
};

type ConfigFluxoCaixa = {
  saldoMinimo: number | null;
  contas: Record<string, Partial<ConfigConta>>;
};

export type ContaFluxo = ConfigConta & {
  codigo: number;
  descricao: string;
  banco: string;
  /** Saldo realizado até agora (abertura do período + movimentos liquidados). */
  saldo: number;
  /** Conta no caixa próprio: entra, e não é garantida nem aplicação travada. */
  somaNoCaixa: boolean;
  /** Último dia com lançamento conciliado; `null` quando o Omie não informou. */
  conciliadoAte: string | null;
  /** Lançamentos realizados do período ainda sem conciliação. */
  pendentesConciliacao: number;
};

export type MovimentoFluxo = {
  id: string;
  /** ISO `aaaa-mm-dd`: dia em que o dinheiro entra ou sai da conta. */
  data: string;
  vencimento: string | null;
  conta: number;
  nome: string;
  categoria: string;
  documento: string;
  origem: string;
  /** Positivo entra, negativo sai. */
  valor: number;
  realizado: boolean;
};

export type DiaFluxo = {
  data: string;
  tipo: "realizado" | "hoje" | "previsto";
  entradas: number;
  saidas: number;
  /** Saldo do caixa próprio no fim do dia. */
  saldo: number;
};

export type FluxoCaixa = {
  consultadoEm: string;
  hoje: string;
  saldoMinimo: number | null;
  contas: ContaFluxo[];
  dias: DiaFluxo[];
  movimentos: MovimentoFluxo[];
  caixaProprio: number;
  limiteLivre: number;
  avisos: string[];
};

export type EstadoFluxoCaixa =
  | Exclude<EstadoResumoOmie, { estado: "ok" }>
  | { estado: "ok"; fluxo: FluxoCaixa };

type ContaOmie = {
  nCodCC: number;
  descricao?: string;
  tipo?: string;
  tipo_conta_corrente?: string;
  codigo_banco?: string;
  inativo?: string;
  nao_fluxo?: string;
  nao_resumo?: string;
  valor_limite?: number;
};

type MovimentoOmie = {
  nCodLancamento?: number;
  cDesCliente?: string;
  cRazCliente?: string;
  cOrigem?: string;
  cNatureza?: string;
  cSituacao?: string;
  cNumero?: string;
  cDesCategoria?: string;
  dDataLancamento?: string;
  dDataVencimento?: string;
  dDataConciliacao?: string;
  nValorDocumento?: number;
  nSaldo?: number;
};

/* -------------------------------- Utilidades ------------------------------ */

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Hoje em Brasília, como `aaaa-mm-dd` — o servidor roda em UTC. */
function hojeEmBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

function somarDias(iso: string, dias: number) {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

const paraOmie = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function deOmie(data?: string) {
  const partes = data?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : null;
}

/** Nomes vêm com entidade HTML do Omie ("&amp;" no lugar de "&"). */
function limparNome(texto?: string) {
  return (texto ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Quebra a janela em trechos dentro do mesmo mês. */
function trechosMensais(inicio: string, fim: string) {
  const trechos: { de: string; ate: string }[] = [];
  let de = inicio;
  while (de <= fim) {
    const [ano, mes] = [Number(de.slice(0, 4)), Number(de.slice(5, 7))];
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
    const ate = ultimoDia < fim ? ultimoDia : fim;
    trechos.push({ de, ate });
    de = somarDias(ate, 1);
  }
  return trechos;
}

async function comNovaTentativa<T>(chamada: () => Promise<T>): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await chamada();
    } catch (erro) {
      if (tentativa >= 2 || !ehBloqueioTemporario(erro)) throw erro;
      await esperar(4000 * (tentativa + 1));
    }
  }
}

/* ------------------------------ Configuração ----------------------------- */

/**
 * Marcações da Proos para a empresa. Se a tabela ainda não existe (migração
 * 0002 não aplicada) ou não há linha, vale o padrão: a tela abre do mesmo jeito.
 */
async function lerConfigFluxoCaixa(
  empresaId: string,
  bancoInformado?: Executor,
): Promise<ConfigFluxoCaixa> {
  try {
    const consultar = (tx: Executor) =>
      tx
        .select({ saldo_minimo: fluxoCaixaConfig.saldo_minimo, contas: fluxoCaixaConfig.contas })
        .from(fluxoCaixaConfig)
        .where(eq(fluxoCaixaConfig.empresa_id, empresaId))
        .limit(1);
    const [linha] = bancoInformado ? await consultar(bancoInformado) : await naSessao(consultar);
    if (!linha) return { saldoMinimo: null, contas: {} };
    return {
      saldoMinimo: linha.saldo_minimo,
      contas: (linha.contas ?? {}) as ConfigFluxoCaixa["contas"],
    };
  } catch {
    return { saldoMinimo: null, contas: {} };
  }
}

/**
 * Padrão de uma conta sem marcação: os flags do Omie decidem se entra, e o
 * nome sugere o tipo. Conta "virtual" de perda/prejuízo fica fora — o Omie a
 * devolve com flags de conta normal.
 */
function configPadrao(conta: ContaOmie): ConfigConta {
  const nome = (conta.descricao ?? "").toLowerCase();
  const tipoOmie = `${conta.tipo ?? ""} ${conta.tipo_conta_corrente ?? ""}`.toLowerCase();
  const virtual = /perda|preju[ií]zo/.test(nome);
  const garantida = /garantida|cheque especial/.test(nome);
  const aplicacao = !garantida && (/aplica|cdb|invest|poupan|fundo/.test(nome) || /\bca\b|aplic/.test(tipoOmie));
  return {
    entra:
      !virtual &&
      (conta.inativo ?? "N") === "N" &&
      (conta.nao_fluxo ?? "N") === "N" &&
      (conta.nao_resumo ?? "N") === "N",
    tipo: garantida ? "garantida" : aplicacao ? "aplicacao" : "corrente",
    liquidezImediata: true,
    limite: Number(conta.valor_limite ?? 0) || 0,
  };
}

/* --------------------------------- Omie ---------------------------------- */

async function listarContas(credenciais: CredenciaisOmie) {
  const contas: ContaOmie[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    try {
      const resposta = await comNovaTentativa(() =>
        chamarOmie<{ ListarContasCorrentes?: ContaOmie[]; total_de_paginas?: number }>(
          "geral/contacorrente",
          "ListarContasCorrentes",
          { pagina, registros_por_pagina: 100 },
          credenciais,
        ),
      );
      contas.push(...(resposta.ListarContasCorrentes ?? []));
      if (pagina >= (resposta.total_de_paginas ?? 1)) break;
    } catch (erro) {
      if (ehListaVazia(erro)) break;
      throw erro;
    }
  }
  return contas;
}

async function extratoDaConta(credenciais: CredenciaisOmie, codigo: number, inicio: string, fim: string) {
  const movimentos: MovimentoOmie[] = [];
  let abertura: number | null = null;
  for (const [indice, trecho] of trechosMensais(inicio, fim).entries()) {
    if (indice > 0) await esperar(ESPERA_ENTRE_CHAMADAS_MS);
    const resposta = await comNovaTentativa(() =>
      chamarOmie<{ listaMovimentos?: MovimentoOmie[] }>(
        "financas/extrato",
        "ListarExtrato",
        {
          nCodCC: codigo,
          cCodIntCC: "",
          dPeriodoInicial: paraOmie(trecho.de),
          dPeriodoFinal: paraOmie(trecho.ate),
        },
        credenciais,
      ),
    );
    for (const movimento of resposta.listaMovimentos ?? []) {
      if ((movimento.cDesCliente ?? "").toUpperCase() === "SALDO ANTERIOR") {
        // Só a abertura do primeiro trecho é o saldo de partida da janela.
        if (indice === 0 && abertura === null) abertura = Number(movimento.nSaldo ?? 0);
        continue;
      }
      movimentos.push(movimento);
    }
  }
  return { movimentos, abertura: abertura ?? 0 };
}

/* ------------------------------- Montagem -------------------------------- */

async function montarFluxo(
  credenciais: CredenciaisOmie,
  config: ConfigFluxoCaixa,
): Promise<FluxoCaixa> {
  const hoje = hojeEmBrasilia();
  const inicio = somarDias(hoje, -DIAS_PASSADOS);
  const fim = somarDias(hoje, DIAS_FUTUROS);
  const avisos: string[] = [];

  const contasOmie = await listarContas(credenciais);
  const marcadas = contasOmie.map((conta) => ({
    conta,
    config: { ...configPadrao(conta), ...(config.contas[String(conta.nCodCC)] ?? {}) },
  }));

  const contas: ContaFluxo[] = [];
  const movimentos: MovimentoFluxo[] = [];
  let primeira = true;

  for (const { conta, config: marcacao } of marcadas) {
    if (!marcacao.entra) continue;
    if (!primeira) await esperar(ESPERA_ENTRE_CHAMADAS_MS);
    primeira = false;

    let extrato: Awaited<ReturnType<typeof extratoDaConta>>;
    try {
      extrato = await extratoDaConta(credenciais, conta.nCodCC, inicio, fim);
    } catch (erro) {
      avisos.push(
        `Não foi possível ler o extrato de "${conta.descricao ?? conta.nCodCC}": ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
      continue;
    }

    let saldo = extrato.abertura;
    let conciliadoAte: string | null = null;
    let pendentes = 0;

    for (const bruto of extrato.movimentos) {
      const data = deOmie(bruto.dDataLancamento);
      const valorAbsoluto = Math.abs(Number(bruto.nValorDocumento ?? 0));
      if (!data || valorAbsoluto === 0) continue;

      const origem = bruto.cOrigem ?? "";
      const previsto = ORIGENS_PREVISTAS.has(origem);
      // Passado e hoje: o que não é previsão já aconteceu (título liquidado ou
      // lançamento direto na conta, como tarifa, rendimento e transferência).
      const realizado = !previsto && data <= hoje;
      if (data < hoje && !realizado) continue; // previsão vencida não é caixa

      const entra = bruto.cNatureza === "R";
      const valor = entra ? valorAbsoluto : -valorAbsoluto;

      if (realizado) {
        saldo += valor;
        const conciliado = /concilia/i.test(bruto.cSituacao ?? "") || Boolean(bruto.dDataConciliacao);
        if (conciliado) {
          if (!conciliadoAte || data > conciliadoAte) conciliadoAte = data;
        } else {
          pendentes++;
        }
      }

      movimentos.push({
        id: `${conta.nCodCC}-${bruto.nCodLancamento ?? movimentos.length}-${data}`,
        data,
        vencimento: deOmie(bruto.dDataVencimento),
        conta: conta.nCodCC,
        nome: limparNome(bruto.cRazCliente || bruto.cDesCliente) || "Sem identificação",
        categoria: limparNome(bruto.cDesCategoria) || "Sem categoria",
        documento: bruto.cNumero ?? "",
        origem,
        valor,
        realizado,
      });
    }

    const somaNoCaixa =
      marcacao.tipo === "corrente" || (marcacao.tipo === "aplicacao" && marcacao.liquidezImediata);

    contas.push({
      ...marcacao,
      codigo: conta.nCodCC,
      descricao: limparNome(conta.descricao) || String(conta.nCodCC),
      banco: conta.codigo_banco ?? "",
      saldo,
      somaNoCaixa,
      conciliadoAte,
      pendentesConciliacao: pendentes,
    });
  }

  // Transferência entre contas próprias aparece nas duas pontas e se anula no
  // total; o saldo diário considera só as contas do caixa próprio.
  const noCaixa = new Set(contas.filter((c) => c.somaNoCaixa).map((c) => c.codigo));
  const caixaProprio = contas.filter((c) => c.somaNoCaixa).reduce((soma, c) => soma + c.saldo, 0);
  const limiteLivre = contas
    .filter((c) => c.tipo === "garantida")
    .reduce((soma, c) => soma + Math.max(0, c.limite + Math.min(0, c.saldo)), 0);

  const porDia = new Map<string, { entradas: number; saidas: number; realizadoLiquido: number }>();
  for (const movimento of movimentos) {
    if (!noCaixa.has(movimento.conta)) continue;
    const dia = porDia.get(movimento.data) ?? { entradas: 0, saidas: 0, realizadoLiquido: 0 };
    if (movimento.valor > 0) dia.entradas += movimento.valor;
    else dia.saidas -= movimento.valor;
    if (movimento.realizado) dia.realizadoLiquido += movimento.valor;
    porDia.set(movimento.data, dia);
  }

  // O saldo de hoje é o realizado; para trás desconta, para frente soma.
  const dias: DiaFluxo[] = [];
  const datas: string[] = [];
  for (let data = inicio; data <= fim; data = somarDias(data, 1)) datas.push(data);

  const saldoFimDoDia = new Map<string, number>();
  let saldo = caixaProprio;
  for (const data of datas.filter((d) => d > hoje)) {
    const dia = porDia.get(data);
    saldo += (dia?.entradas ?? 0) - (dia?.saidas ?? 0);
    saldoFimDoDia.set(data, saldo);
  }
  // Hoje fecha com o realizado mais o que ainda está previsto para hoje.
  const diaHoje = porDia.get(hoje);
  const previstoHoje = (diaHoje?.entradas ?? 0) - (diaHoje?.saidas ?? 0) - (diaHoje?.realizadoLiquido ?? 0);
  saldoFimDoDia.set(hoje, caixaProprio + previstoHoje);
  if (previstoHoje !== 0) {
    for (const data of datas.filter((d) => d > hoje)) {
      saldoFimDoDia.set(data, (saldoFimDoDia.get(data) ?? 0) + previstoHoje);
    }
  }
  saldo = caixaProprio - (diaHoje?.realizadoLiquido ?? 0);
  for (const data of datas.filter((d) => d < hoje).reverse()) {
    saldoFimDoDia.set(data, saldo);
    saldo -= porDia.get(data)?.realizadoLiquido ?? 0;
  }

  for (const data of datas) {
    const dia = porDia.get(data);
    dias.push({
      data,
      tipo: data < hoje ? "realizado" : data === hoje ? "hoje" : "previsto",
      entradas: dia?.entradas ?? 0,
      saidas: dia?.saidas ?? 0,
      saldo: saldoFimDoDia.get(data) ?? 0,
    });
  }

  if (contas.length === 0) avisos.push("Nenhuma conta corrente marcada para o fluxo de caixa.");

  return {
    consultadoEm: new Date().toISOString(),
    hoje,
    saldoMinimo: config.saldoMinimo,
    contas,
    dias,
    movimentos: movimentos.sort((a, b) => a.data.localeCompare(b.data) || Math.abs(b.valor) - Math.abs(a.valor)),
    caixaProprio,
    limiteLivre,
    avisos,
  };
}

/* ---------------------------------- Cache -------------------------------- */

const cache = new Map<string, { em: number; fluxo: FluxoCaixa }>();

export function descartarFluxoCaixa(empresaId: string) {
  cache.delete(empresaId);
}

export function idadeFluxoCaixa(empresaId: string) {
  const guardado = cache.get(empresaId);
  return guardado ? Date.now() - guardado.em : null;
}

/** Contas do Omie com a marcação vigente, para a tela de configuração. */
export type ContaParaConfigurar = ConfigConta & { codigo: number; descricao: string };

export async function obterFluxoCaixa(empresaId: string): Promise<EstadoFluxoCaixa> {
  const guardado = cache.get(empresaId);
  if (guardado && Date.now() - guardado.em < VALIDADE_CACHE_MS) {
    return { estado: "ok", fluxo: guardado.fluxo };
  }

  try {
    const acesso = await credenciaisDaEmpresa(empresaId);
    if (acesso.estado !== "ok") return acesso;

    const config = await lerConfigFluxoCaixa(empresaId);
    const fluxo = await montarFluxo(acesso.credenciais, config);
    cache.set(empresaId, { em: Date.now(), fluxo });
    return { estado: "ok", fluxo };
  } catch (erro) {
    return {
      estado: "erro",
      origem: erro instanceof ErroOmie ? "omie" : "painel",
      mensagem: erro instanceof Error ? erro.message : String(erro),
    };
  }
}

/** Todas as contas do Omie, inclusive as que ficam fora, para a Proos marcar. */
export async function contasParaConfigurar(empresaId: string): Promise<ContaParaConfigurar[]> {
  const acesso = await credenciaisDaEmpresa(empresaId);
  if (acesso.estado !== "ok") return [];
  const [contas, config] = await Promise.all([
    listarContas(acesso.credenciais),
    lerConfigFluxoCaixa(empresaId),
  ]);
  return contas
    .filter((conta) => (conta.inativo ?? "N") === "N")
    .map((conta) => ({
      ...configPadrao(conta),
      ...(config.contas[String(conta.nCodCC)] ?? {}),
      codigo: conta.nCodCC,
      descricao: limparNome(conta.descricao) || String(conta.nCodCC),
    }));
}
