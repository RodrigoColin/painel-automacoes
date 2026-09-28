/**
 * Leitura do faturamento sincronizado (`omie_faturamento_mensal`) e cálculo de
 * tudo que a aba "Faturamento e recorrência" mostra.
 *
 * Regras de recorrência — as mesmas escritas na tela, para ninguém ter de
 * adivinhar de onde vem cada número:
 *
 * - Categoria recorrente: categoria de receita cujo nome contém "Recorrente"
 *   (RPA Recorrente, Presto Recorrente).
 * - MRR do mês: soma faturada nas categorias recorrentes naquele mês.
 * - Cliente recorrente: faturou alguma categoria recorrente no mês.
 * - Churn (saída bruta): recorrente no mês anterior e sem faturamento
 *   recorrente no mês de referência. Churn rate = saídas ÷ recorrentes do mês
 *   anterior.
 * - Novo cliente: recorrente no mês de referência e não no anterior.
 */

import { asc, eq } from "drizzle-orm";
import { naSessao } from "@/lib/dal";
import {
  omieCategorias,
  omieClientes,
  omieContratos,
  omieFaturamentoMensal,
  omieSincronizacao,
} from "@/lib/db/schema";
import { classificarChurn } from "@/lib/omie/churn";
import { mesCorrente } from "@/lib/omie/sincronizacao";

/** Categorias além dessa quantidade viram "Outras" — a paleta categórica validada tem 7 slots em uso. */
const MAX_CATEGORIAS_COM_COR = 7;

/**
 * Categoria recorrente: nome contém "recorrente" mas não como parte de
 * "não recorrente" — sem a exclusão, `/recorrente/i` casa com "Não
 * recorrente" também, já que é substring.
 */
function ehCategoriaRecorrente(descricao: string) {
  return /recorrente/i.test(descricao) && !/n[ãa]o\s*recorrente/i.test(descricao);
}

export type CategoriaFaturamento = {
  codigo: string;
  descricao: string;
  recorrente: boolean;
  /** 1..7 para as categorias com cor própria; 0 para "Outras". */
  slot: number;
};

export type Mes = { chave: string; rotulo: string; rotuloCurto: string; parcial: boolean };

export type ClienteFaturamento = {
  codigo: number;
  nome: string;
  anterior: number;
  referencia: number;
  /** Valor por categoria no mês de referência e no anterior. */
  categorias: { codigo: string; anterior: number; referencia: number }[];
  /** Total por mês, na ordem de `meses`. */
  serie: number[];
  /** [mês][categoria] — mesmo formato de `porMesCategoria`, mas só deste cliente. */
  serieCategorias: number[][];
};

export type MovimentoCliente = {
  codigo: number;
  nome: string;
  categoria: string;
  mrr: number;
  /**
   * Situação do contrato no Omie **hoje** (não no mês do movimento) — é a
   * única foto que temos. "cancelado" é churn confirmado; "suspenso" e
   * "ativo" ainda podem ser reativação ou gap de faturamento; "sem-contrato"
   * é cliente sem contrato de serviço cadastrado lá.
   */
  situacaoContrato: "ativo" | "suspenso" | "cancelado" | "sem-contrato";
};

/**
 * Movimentação de clientes recorrentes e MRR num mês, contra o mês anterior.
 * `null` nos campos de variação no primeiro mês da série — não há anterior
 * dentro da janela para comparar.
 */
export type MovimentoMensal = {
  mes: Mes;
  saldoInicial: number | null;
  novos: number | null;
  saidas: number | null;
  saldoFinal: number;
  mrrGanho: number | null;
  mrrPerdido: number | null;
  liquido: number | null;
  /** Saída do mês classificada pelo status do contrato no Omie hoje; `null` no primeiro mês da série. */
  churn: {
    confirmado: { qtd: number; mrr: number };
    suspenso: { qtd: number; mrr: number };
    ativoRevisar: { qtd: number; mrr: number };
    semContrato: { qtd: number; mrr: number };
  } | null;
  /**
   * Contrato ativo/suspenso no Omie e zerado *neste* mês — foto acumulada,
   * não um delta do mês anterior: inclui quem parou de faturar há vários
   * meses, não só quem saiu agora (por isso não some com as colunas de
   * `churn`, que só olham a transição mês a mês).
   */
  semFaturar: {
    ativo: { qtd: number; mrr: number };
    suspenso: { qtd: number; mrr: number };
  };
};

/**
 * Cliente com contrato ativo ou suspenso no Omie (situação "10"/"90"), mas
 * sem faturamento recorrente no mês de referência — diferente de churn:
 * aqui o contrato continua vigente lá, só falta faturar (ou já devia ter
 * sido cancelado e ninguém atualizou).
 */
export type ClienteSemFaturamento = {
  codigo: number;
  nome: string;
  situacaoContrato: "ativo" | "suspenso";
  /** Categoria e valor do último mês em que faturou recorrente; `null` se nunca faturou recorrente. */
  ultimaCategoria: string | null;
  ultimoValor: number | null;
  /** Meses desde a última fatura recorrente; `null` se nunca faturou recorrente. */
  mesesSemFaturar: number | null;
  /** Fatura em categoria não recorrente neste mês — "nunca faturou" seria enganoso aqui. */
  faturaNaoRecorrente: boolean;
};

export type DadosFaturamento = {
  sincronizadoEm: string | null;
  erroSincronizacao: string | null;
  meses: Mes[];
  referencia: Mes;
  anterior: Mes;
  /** Meses que podem ser referência: os fechados com mês anterior disponível. */
  mesesReferencia: Mes[];
  categorias: CategoriaFaturamento[];
  /** [mês][categoria] — valores na ordem de `meses` e `categorias`. */
  porMesCategoria: number[][];
  clientes: ClienteFaturamento[];
  recorrencia: {
    categorias: CategoriaFaturamento[];
    /** MRR por mês, total e por categoria recorrente. */
    mrrPorMes: { total: number; porCategoria: number[] }[];
    clientesPorMes: number[];
    mrrReferencia: number;
    mrrAnterior: number;
    clientesReferencia: number;
    clientesAnterior: number;
    churnRate: number | null;
    churnRateAnterior: number | null;
    novos: MovimentoCliente[];
    saidas: MovimentoCliente[];
    /** Mesma movimentação, mês a mês, para todo o período sincronizado. */
    historicoMensal: MovimentoMensal[];
    /** Contrato ativo ou suspenso no Omie, mas sem faturamento recorrente no mês de referência. */
    naoFaturados: ClienteSemFaturamento[];
  };
};

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function descreverMes(chave: string, parcial: boolean): Mes {
  const [ano, mes] = chave.split("-").map(Number);
  const nome = MESES_PT[mes - 1];
  return {
    chave,
    rotulo: `${nome[0].toUpperCase()}${nome.slice(1)}/${String(ano).slice(2)}`,
    rotuloCurto: `${nome[0].toUpperCase()}${nome.slice(1)}${parcial ? "*" : ""}`,
    parcial,
  };
}

const chaveDe = (d: Date) => d.toISOString().slice(0, 7);

export async function lerFaturamentoOmie(
  empresaId: string,
  mesPedido?: string,
): Promise<DadosFaturamento | null> {
  // Pela sessão (RLS), numa transação só — uma conexão do pool em vez de cinco.
  // Sem paginação: o teto de 1000 linhas por consulta era do PostgREST.
  const [[sincronizacao], linhas, categoriasBanco, clientesBanco, contratosBanco] = await naSessao((tx) =>
    Promise.all([
      tx
        .select({
          concluida_em: omieSincronizacao.concluida_em,
          primeira_competencia: omieSincronizacao.primeira_competencia,
          erro: omieSincronizacao.erro,
        })
        .from(omieSincronizacao)
        .where(eq(omieSincronizacao.empresa_id, empresaId)),
      tx
        .select({
          competencia: omieFaturamentoMensal.competencia,
          cliente_codigo: omieFaturamentoMensal.cliente_codigo,
          categoria_codigo: omieFaturamentoMensal.categoria_codigo,
          valor: omieFaturamentoMensal.valor,
        })
        .from(omieFaturamentoMensal)
        .where(eq(omieFaturamentoMensal.empresa_id, empresaId))
        .orderBy(
          asc(omieFaturamentoMensal.competencia),
          asc(omieFaturamentoMensal.cliente_codigo),
          asc(omieFaturamentoMensal.categoria_codigo),
        ),
      tx
        .select({ codigo: omieCategorias.codigo, descricao: omieCategorias.descricao })
        .from(omieCategorias)
        .where(eq(omieCategorias.empresa_id, empresaId)),
      tx
        .select({ codigo: omieClientes.codigo, nome: omieClientes.nome })
        .from(omieClientes)
        .where(eq(omieClientes.empresa_id, empresaId)),
      // Todas as situações ("00" rascunho, "10" ativo, "90" suspenso, "99"
      // cancelado) — usadas tanto pra achar quem tem contrato ainda vigente sem
      // faturar quanto pra classificar o churn (confirmado vs. em revisão).
      // `categorias` filtra pra só considerar contrato de categoria recorrente.
      tx
        .select({
          cliente_codigo: omieContratos.cliente_codigo,
          situacao: omieContratos.situacao,
          categorias: omieContratos.categorias,
        })
        .from(omieContratos)
        .where(eq(omieContratos.empresa_id, empresaId)),
    ]),
  );

  if (!sincronizacao?.primeira_competencia || linhas.length === 0) {
    return null;
  }

  /* ------------------------------ Meses ------------------------------ */

  const atual = mesCorrente();
  const chaveAtual = chaveDe(atual);
  const inicio = new Date(`${sincronizacao.primeira_competencia}T00:00:00Z`);
  const meses: Mes[] = [];
  for (let d = inicio; d <= atual; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    meses.push(descreverMes(chaveDe(d), chaveDe(d) === chaveAtual));
  }
  const indiceMes = new Map(meses.map((m, i) => [m.chave, i]));

  // Referência: qualquer mês com anterior disponível, incluindo o corrente
  // (parcial) — quem escolhe sabe que é parcial, o rótulo avisa. Padrão
  // permanece o último mês fechado.
  const mesesReferencia = meses.filter((_, i) => i > 0);
  const mesesFechados = mesesReferencia.filter((m) => !m.parcial);
  const referencia =
    mesesReferencia.find((m) => m.chave === mesPedido) ?? mesesFechados.at(-1) ?? meses.at(-1)!;
  const iRef = indiceMes.get(referencia.chave)!;
  const anterior = meses[Math.max(iRef - 1, 0)];
  const iAnt = indiceMes.get(anterior.chave)!;

  /* ---------------------------- Categorias --------------------------- */

  const descricaoCategoria = new Map(categoriasBanco.map((c) => [c.codigo, c.descricao]));
  const totalPorCategoria = new Map<string, number>();
  for (const l of linhas) {
    totalPorCategoria.set(l.categoria_codigo, (totalPorCategoria.get(l.categoria_codigo) ?? 0) + Number(l.valor));
  }

  // Ordem estável por entidade, nunca por ranking do período: recorrentes
  // primeiro (ganham azul e laranja), depois as demais pelo código do Omie.
  const ordenadas = [...totalPorCategoria.keys()]
    .map((codigo) => {
      const descricao = descricaoCategoria.get(codigo) ?? (codigo === "sem-categoria" ? "Sem categoria" : codigo);
      return { codigo, descricao, recorrente: ehCategoriaRecorrente(descricao) };
    })
    .sort((a, b) => Number(b.recorrente) - Number(a.recorrente) || a.codigo.localeCompare(b.codigo));

  const comCor = ordenadas.slice(0, MAX_CATEGORIAS_COM_COR).map((c, i) => ({ ...c, slot: i + 1 }));
  const restantes = ordenadas.slice(MAX_CATEGORIAS_COM_COR);
  const categorias: CategoriaFaturamento[] =
    restantes.length > 0
      ? [...comCor, { codigo: "outras", descricao: `Outras (${restantes.length})`, recorrente: false, slot: 0 }]
      : comCor;
  const indiceCategoria = new Map<string, number>();
  comCor.forEach((c, i) => indiceCategoria.set(c.codigo, i));
  restantes.forEach((c) => indiceCategoria.set(c.codigo, categorias.length - 1));
  const recorrentes = new Set(ordenadas.filter((c) => c.recorrente).map((c) => c.codigo));
  // Do cadastro completo de categorias, não só das que já faturaram — um
  // contrato novo de categoria recorrente que ainda nunca foi faturado
  // precisa contar como recorrente mesmo assim (é exatamente o caso que
  // "Contrato Suspenso/Ativo sem faturamento" existe pra pegar).
  const categoriasRecorrentesCadastro = new Set(
    categoriasBanco.filter((c) => ehCategoriaRecorrente(c.descricao)).map((c) => c.codigo),
  );

  /* ------------------------------ Somas ------------------------------ */

  const porMesCategoria = meses.map(() => categorias.map(() => 0));
  // Total recorrente por mês, sem o limite de 7 categorias com cor: `categorias`
  // agrupa qualquer recorrente excedente em "Outras" (marcada não-recorrente)
  // só para efeito de exibição do gráfico — o MRR total não pode perder essa
  // fatia. Somado à parte pra bater com `mrrClientePorMes`, que já é irrestrito.
  const totalRecorrentePorMes = meses.map(() => 0);
  const nomeCliente = new Map(clientesBanco.map((c) => [c.codigo, c.nome]));

  // Situação mais "viva" do cliente no Omie, entre todos os contratos dele:
  // um "10" (ativo) vale mais que um "90" (suspenso), que vale mais que um
  // "99" (cancelado) — um cliente com contrato ativo em paralelo com um
  // cancelado não é considerado perdido. Só entra contrato com pelo menos um
  // item de categoria recorrente — contrato de serviço avulso cadastrado no
  // Omie por conveniência não deve aparecer nas telas de recorrência.
  const PRIORIDADE_SITUACAO: Record<string, number> = { "10": 3, "90": 2, "99": 1 };
  const situacaoPorCliente = new Map<number, string>();
  for (const c of contratosBanco) {
    if (!c.categorias.some((codigoCategoria) => categoriasRecorrentesCadastro.has(codigoCategoria))) continue;
    const atual = situacaoPorCliente.get(c.cliente_codigo);
    if (!atual || (PRIORIDADE_SITUACAO[c.situacao] ?? 0) > (PRIORIDADE_SITUACAO[atual] ?? 0)) {
      situacaoPorCliente.set(c.cliente_codigo, c.situacao);
    }
  }
  const rotuloSituacao = (codigo: number): "ativo" | "suspenso" | "cancelado" | "sem-contrato" => {
    switch (situacaoPorCliente.get(codigo)) {
      case "10":
        return "ativo";
      case "90":
        return "suspenso";
      case "99":
        return "cancelado";
      default:
        return "sem-contrato";
    }
  };

  const clientes = new Map<number, ClienteFaturamento>();
  // [mês] → cliente → MRR (e categoria recorrente de maior valor, para a lista).
  const mrrClientePorMes = meses.map(() => new Map<number, { mrr: number; categoria: string; maior: number }>());

  for (const l of linhas) {
    const iMes = indiceMes.get(l.competencia.slice(0, 7));
    if (iMes === undefined) continue;
    const valor = Number(l.valor);
    const iCat = indiceCategoria.get(l.categoria_codigo)!;
    porMesCategoria[iMes][iCat] += valor;

    let cliente = clientes.get(l.cliente_codigo);
    if (!cliente) {
      cliente = {
        codigo: l.cliente_codigo,
        nome: nomeCliente.get(l.cliente_codigo) ?? `Cliente ${l.cliente_codigo}`,
        anterior: 0,
        referencia: 0,
        categorias: [],
        serie: meses.map(() => 0),
        serieCategorias: meses.map(() => categorias.map(() => 0)),
      };
      clientes.set(l.cliente_codigo, cliente);
    }
    cliente.serie[iMes] += valor;
    cliente.serieCategorias[iMes][iCat] += valor;
    if (iMes === iRef || iMes === iAnt) {
      const codigoCor = categorias[iCat].codigo;
      let cat = cliente.categorias.find((c) => c.codigo === codigoCor);
      if (!cat) {
        cat = { codigo: codigoCor, anterior: 0, referencia: 0 };
        cliente.categorias.push(cat);
      }
      if (iMes === iRef) {
        cliente.referencia += valor;
        cat.referencia += valor;
      }
      if (iMes === iAnt && iAnt !== iRef) {
        cliente.anterior += valor;
        cat.anterior += valor;
      }
    }

    if (recorrentes.has(l.categoria_codigo)) {
      totalRecorrentePorMes[iMes] += valor;
      const atualCliente = mrrClientePorMes[iMes].get(l.cliente_codigo) ?? { mrr: 0, categoria: "", maior: 0 };
      atualCliente.mrr += valor;
      if (valor > atualCliente.maior) {
        atualCliente.maior = valor;
        atualCliente.categoria = descricaoCategoria.get(l.categoria_codigo) ?? l.categoria_codigo;
      }
      mrrClientePorMes[iMes].set(l.cliente_codigo, atualCliente);
    }
  }

  for (const cliente of clientes.values()) {
    cliente.categorias.sort((a, b) => indiceCategoria.get(a.codigo)! - indiceCategoria.get(b.codigo)!);
  }

  /* ---------------------------- Recorrência -------------------------- */

  const categoriasRecorrentes = categorias.filter((c) => c.recorrente);
  const mrrPorMes = meses.map((_, iMes) => {
    const porCategoria = categoriasRecorrentes.map((c) => porMesCategoria[iMes][categorias.indexOf(c)]);
    return { total: totalRecorrentePorMes[iMes], porCategoria };
  });
  const clientesPorMes = mrrClientePorMes.map((m) => m.size);

  const movimentos = (de: number, para: number, usarMrrDe: number): MovimentoCliente[] =>
    [...mrrClientePorMes[de].entries()]
      .filter(([codigo]) => !mrrClientePorMes[para].has(codigo))
      .map(([codigo]) => {
        const origem = mrrClientePorMes[usarMrrDe].get(codigo)!;
        return {
          codigo,
          nome: nomeCliente.get(codigo) ?? `Cliente ${codigo}`,
          categoria: origem.categoria,
          mrr: origem.mrr,
          situacaoContrato: rotuloSituacao(codigo),
        };
      })
      .sort((a, b) => b.mrr - a.mrr);

  const taxaChurn = (iMes: number) => {
    if (iMes <= 0) return null;
    const base = clientesPorMes[iMes - 1];
    if (base === 0) return null;
    const saidas = [...mrrClientePorMes[iMes - 1].keys()].filter((c) => !mrrClientePorMes[iMes].has(c)).length;
    return (saidas / base) * 100;
  };

  // Contrato ativo ou suspenso no Omie mas zerado no mês alvo — pode ser
  // cliente recém-fechado (nunca faturou) ou alguém que já vinha faturando e
  // parou sem o contrato ter sido cancelado lá. É uma foto acumulada do mês
  // (não compara com o mês anterior, como `movimentos` faz).
  function calcularNaoFaturados(iMesAlvo: number): ClienteSemFaturamento[] {
    return [...situacaoPorCliente.keys()]
      .filter((codigo) => {
        const situacao = rotuloSituacao(codigo);
        return (situacao === "ativo" || situacao === "suspenso") && !mrrClientePorMes[iMesAlvo].has(codigo);
      })
      .map((codigo) => {
        const situacaoContrato = rotuloSituacao(codigo) as "ativo" | "suspenso";
        let ultimoIndice = -1;
        for (let m = iMesAlvo - 1; m >= 0; m--) {
          if (mrrClientePorMes[m].has(codigo)) {
            ultimoIndice = m;
            break;
          }
        }
        const origem = ultimoIndice >= 0 ? mrrClientePorMes[ultimoIndice].get(codigo)! : null;
        // `mrrClientePorMes` só rastreia categoria recorrente — cliente pode
        // faturar todo mês numa categoria não recorrente (ex.: Execução
        // Única) e nunca aparecer aí. Sem checar isso, "nunca faturou" fica
        // enganoso pra quem fatura, só que fora de recorrente.
        const faturaNaoRecorrente = origem === null && (clientes.get(codigo)?.serie[iMesAlvo] ?? 0) > 0;
        return {
          codigo,
          nome: nomeCliente.get(codigo) ?? `Cliente ${codigo}`,
          situacaoContrato,
          ultimaCategoria: origem?.categoria ?? null,
          ultimoValor: origem?.mrr ?? null,
          mesesSemFaturar: ultimoIndice >= 0 ? iMesAlvo - ultimoIndice : null,
          faturaNaoRecorrente,
        };
      })
      .sort((a, b) => (b.ultimoValor ?? 0) - (a.ultimoValor ?? 0));
  }

  // Movimentação mês a mês do ano inteiro, não só do par referência/anterior
  // — para o histórico completo da seção de recorrência.
  const historicoMensal: MovimentoMensal[] = meses.map((mes, iMes) => {
    const semFaturarDoMes = calcularNaoFaturados(iMes);
    const somaUltimoValor = (lista: ClienteSemFaturamento[]) =>
      lista.reduce((s, c) => s + (c.ultimoValor ?? 0), 0);
    const semFaturarAtivo = semFaturarDoMes.filter((c) => c.situacaoContrato === "ativo");
    const semFaturarSuspenso = semFaturarDoMes.filter((c) => c.situacaoContrato === "suspenso");
    const semFaturar = {
      ativo: { qtd: semFaturarAtivo.length, mrr: somaUltimoValor(semFaturarAtivo) },
      suspenso: { qtd: semFaturarSuspenso.length, mrr: somaUltimoValor(semFaturarSuspenso) },
    };

    if (iMes === 0) {
      return {
        mes,
        saldoInicial: null,
        novos: null,
        saidas: null,
        saldoFinal: clientesPorMes[iMes],
        mrrGanho: null,
        mrrPerdido: null,
        liquido: null,
        churn: null,
        semFaturar,
      };
    }
    const entraram = movimentos(iMes, iMes - 1, iMes);
    const sairam = movimentos(iMes - 1, iMes, iMes - 1);
    const mrrGanho = entraram.reduce((s, c) => s + c.mrr, 0);
    const mrrPerdido = sairam.reduce((s, c) => s + c.mrr, 0);
    const classificado = classificarChurn(sairam);
    const somaMrr = (lista: MovimentoCliente[]) => lista.reduce((s, c) => s + c.mrr, 0);
    return {
      mes,
      saldoInicial: clientesPorMes[iMes - 1],
      novos: entraram.length,
      saidas: sairam.length,
      saldoFinal: clientesPorMes[iMes],
      mrrGanho,
      mrrPerdido,
      liquido: mrrGanho - mrrPerdido,
      churn: {
        confirmado: { qtd: classificado.confirmados.length, mrr: somaMrr(classificado.confirmados) },
        suspenso: { qtd: classificado.suspensos.length, mrr: somaMrr(classificado.suspensos) },
        ativoRevisar: { qtd: classificado.ativosRevisar.length, mrr: somaMrr(classificado.ativosRevisar) },
        semContrato: { qtd: classificado.semContrato.length, mrr: somaMrr(classificado.semContrato) },
      },
      semFaturar,
    };
  });

  const naoFaturados = calcularNaoFaturados(iRef);

  return {
    sincronizadoEm: sincronizacao.concluida_em,
    erroSincronizacao: sincronizacao.erro,
    meses,
    referencia,
    anterior,
    mesesReferencia,
    categorias,
    porMesCategoria,
    clientes: [...clientes.values()]
      .filter((c) => c.anterior > 0 || c.referencia > 0)
      .sort((a, b) => b.referencia - a.referencia),
    recorrencia: {
      categorias: categoriasRecorrentes,
      mrrPorMes,
      clientesPorMes,
      mrrReferencia: mrrPorMes[iRef].total,
      mrrAnterior: mrrPorMes[iAnt].total,
      clientesReferencia: clientesPorMes[iRef],
      clientesAnterior: clientesPorMes[iAnt],
      churnRate: taxaChurn(iRef),
      churnRateAnterior: taxaChurn(iAnt),
      novos: iRef > 0 ? movimentos(iRef, iAnt, iRef) : [],
      saidas: iRef > 0 ? movimentos(iAnt, iRef, iAnt) : [],
      historicoMensal,
      naoFaturados,
    },
  };
}
