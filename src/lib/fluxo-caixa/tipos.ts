/**
 * Formato do pacote que o container `caixa` grava em `caixa_pacote_diario`
 * (proos-omie-mcp/caixa/extrato.py e extra.py). Valores em R$; datas ISO.
 */

export type TipoConta = "corrente" | "aplicacao" | "garantida";

export type ContaExtrato = {
  codigo: number;
  descricao: string;
  banco: string;
  tipo: TipoConta;
  liquidezImediata: boolean;
  limite: number;
  saldo: number;
  somaNoCaixa: boolean;
  conciliadoAte: string | null;
  pendentesConciliacao: number;
};

export type Movimento = {
  id: string;
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
  /** Parcela deslocada pelo cenário de estresse. */
  cenario?: boolean;
};

export type DiaExtrato = {
  data: string;
  tipo: "realizado" | "hoje" | "previsto";
  entradas: number;
  saidas: number;
  saldo: number;
};

export type Extrato = {
  consultadoEm: string;
  hoje: string;
  saldoMinimo: number | null;
  contas: ContaExtrato[];
  dias: DiaExtrato[];
  movimentos: Movimento[];
  caixaProprio: number;
  limiteLivre: number;
  avisos: string[];
};

export type MesHistorico = {
  /** `aaaa-mm` */
  mes: string;
  fat: number;
  ent: number;
  sai: number;
  saldo: number;
  acum: number;
  status: "fechado" | "em_curso" | "projetado";
};

type Pontualidade = {
  previsto: number;
  realizado: number;
  noDia: number;
  ate5: number;
  dep5: number;
  aberto: number;
  deAntes: number;
  n: number;
};

/** Variação de uma categoria dentro de uma causa, com os maiores clientes aninhados. A lista de categorias é COMPLETA (a soma dos deltas = total da causa); só `clientes` é truncada. */
export type VariacaoItem = {
  categoria: string;
  delta: number;
  natureza?: "receita" | "despesa";
  clientes?: { cliente: string; delta: number }[];
  clientesTotal?: number;
  /** Formato antigo (pré-12/11): item por cliente, sem aninhamento. */
  cliente?: string;
};
export type VariacaoCausaBloco = { total: number; itens: VariacaoItem[]; itensTotal?: number };
/** Dinheiro que só mudou de mês (não altera o ano): cliente, valor e de→para. */
export type VariacaoTimingItem = { categoria: string; cliente?: string; valor: number; de: string; para: string; natureza?: "receita" | "despesa" };
export type VariacaoRef = {
  refData?: string;
  refRotulo?: string;
  mesCorrente: string;
  fimAno: string;
  /** chave `aaaa-mm` -> acumulado em A, em B e o delta (base de títulos e, com sufixo, com a regra do dashboard = o número da tela). Contém o mês corrente e o fim do ano. */
  alvos: Record<string, { acumA: number; acumB: number; delta: number; acumAComRegra: number; acumBComRegra: number; deltaComRegra: number }>;
  porMes: { mes: string; tipo: "corrente" | "futuro" | "fechado"; delta: number }[];
  porCategoria: { mes: string; categoria: string; valorA: number; valorB: number; delta: number }[];
  porCategoriaTotal?: number;
  causas: {
    fimAno: string;
    deltaFimAno: number;
    deltaFimAnoComRegra: number;
    realizacao: VariacaoCausaBloco;
    ancoragem: number;
    novoLancamento: VariacaoCausaBloco;
    mudancaReal: VariacaoCausaBloco;
    premissa: number;
    deslocamentoTiming: number;
    deslocamentoTimingRecebimentos?: number;
    deslocamentoTimingPagamentos?: number;
    deslocamentoTimingItens?: VariacaoTimingItem[];
    deslocamentoTimingItensTotal?: number;
    reconciliado: number;
    residuo: number;
  };
  reconciliacao: {
    deltaCorrente: number;
    somaFuturos: number;
    fimAnoReconciliado: number;
    residuoFimAno: number;
    residuoPorMesFuturo: { mes: string; residuo: number }[];
  };
};

export type Extra = {
  ref: string;
  ano: number;
  hist: MesHistorico[];
  /** mês (`aaaa-mm`) -> categoria -> valor (positivo entra, negativo sai). */
  catmes: Record<string, Record<string, number>>;
  /** mês (`aaaa-mm`) -> categoria -> parcela de RECEITA ainda não faturada (contratos/OS não faturados, "Previsão de..."), subconjunto de `catmes`. Ausente em pacotes antigos. Ver grupo "fat" em grupos.ts. */
  projetadoReal?: Record<string, Record<string, number>>;
  /** Variação (ponte) pré-calculada de cada ponto de referência ("7d", "15d") até hoje. Ausente em pacotes antigos. Fonte: caixa/variacao.py. */
  variacao?: Record<string, VariacaoRef>;
  /** mês (`aaaa-mm`) -> categoria -> cliente/fornecedor -> valor. Detalhe por nome do catmes acima — cobre o histórico inteiro (não só o horizonte do extrato diário), usado no popup de histórico anual ao clicar no nome da categoria. */
  porCliente: Record<string, Record<string, Record<string, number>>>;
  /** categoria -> média mensal dos últimos 6 meses fechados (só categorias de receita). */
  catBase: Record<string, number>;
  saidas: Record<string, number>;
  inad: {
    ref: string;
    ano: number;
    total: number;
    n: number;
    clientes: number;
    avencer: number;
    faixas: { faixa: string; valor: number; n: number }[];
    top: {
      cliente: string;
      valor: number;
      n: number;
      dias: number;
      antigo: string;
      vencidoTotal: number;
      titulosTotal: number;
    }[];
    pormes: { mes: string; valor: number }[];
    /** Linha por cliente: `tot` e uma chave `aaaa-mm` por mês de previsão. */
    cxm: ({ cliente: string; tot: number } & Record<string, number | string>)[];
    meses: string[];
    fatAno: number;
    top5: number;
  };
  atrasos: {
    ref: string;
    faixas: Record<"7" | "15" | "30", { valor: number; n: number; clientes: number }>;
    itens: { cliente: string; venc: string; vencOrig: string | null; dias: number; valor: number; categoria: string; doc: string }[];
  };
  inadx: {
    ref: string;
    vencidoTotal: number;
    nTotal: number;
    clientesTotal: number;
    legado: number;
    legadoN: number;
    legadoCli: number;
    legadoDias: number;
    recuperacao: {
      faixa: string;
      taxa: number;
      vencidoAno: number;
      vencidoTotal: number;
      esperadoAno: number;
      esperadoTotal: number;
    }[];
    reincidentes: {
      cliente: string;
      meses: number;
      atrasoMedio: number;
      recebidoMes: number;
      vencido: number;
      mrr: number;
    }[];
  };
  acur: {
    ini: string;
    fim: string;
    ent: Pontualidade;
    sai: Pontualidade;
    ent90: Pontualidade;
    sai90: Pontualidade;
    semanas: { ini: string; fim: string; entPrev: number; entReal: number; saiPrev: number; saiReal: number }[];
    saiAbertos: { nome: string; venc: string; vencOrig: string | null; categoria: string; valor: number }[];
  };
  faturamentoPorLinha: { meses: string[]; linhas: Record<string, number[]> };
  parametros: {
    contratosAtivos: number;
    recEfetivo: number;
    padraoIntramensal: number[];
    cenarios: {
      conservador: { frac: number; atraso: number; meses: number };
      pessimista: { frac: number; atraso: number; mes: string | null };
    };
  };
};

/** Resultado da conferência sombra (caixa/sombra.py): pacote × ListarMovimentos. */
export type SombraChecagem = {
  geradoEm: string;
  status: "ok" | "rateio_info" | "divergente" | "erro" | "desligada";
  fonte?: string;
  janela?: { de: string | null; ate: string | null };
  tolerancia?: number;
  meses?: {
    mes: string;
    entPainel: number;
    entOmie: number;
    difEnt: number;
    saiPainel: number;
    saiOmie: number;
    difSai: number;
  }[];
  categoriasDivergentes?: {
    mes: string;
    lado: "ENT" | "SAI";
    categoria: string;
    painel: number;
    omie: number;
    dif: number;
  }[];
  categoriasDivergentesTotal?: number;
  /** Mês já congelado em caixa_fechamento_mensal cujo valor mudou no Omie. */
  reclassificacoesRetroativas?: {
    mes: string;
    lado: "ENT" | "SAI";
    categoria: string;
    congelado: number;
    atual: number;
    dif: number;
  }[];
  reclassificacoesTotal?: number;
  /** Categoria que apareceu no último mês fechado e em nenhum anterior. */
  categoriasNovas?: { mes: string; lado: "ENT" | "SAI"; categoria: string; valor: number }[];
  /** Sombra do faturamento: Gestão de Receitas (OS) × títulos emitidos. */
  faturamento?: {
    status: "ok" | "divergente" | "indisponivel";
    meses?: { mes: string; painel: number; omie: number; dif: number }[];
    mesesDivergentes?: number;
    nota?: string;
  } | null;
  /** Sombra da inadimplência: conjunto de títulos vencidos painel × Omie. */
  inadimplencia?: {
    status: "ok" | "divergente" | "indisponivel";
    titulosPainel?: number;
    titulosOmie?: number;
    vencidoPainel?: number;
    vencidoOmieBruto?: number;
    faltamNoPainel?: { codigo: number; venc?: string; valorAberto?: number; cliente?: string }[];
    sobramNoPainel?: { codigo: number; venc?: string; valorAberto?: number; cliente?: string }[];
    faltamTotal?: number;
    sobramTotal?: number;
    nota?: string;
  } | null;
  /** Fechamento mensal automático: o mês congelado mais recente. */
  ultimoFechamento?: {
    mes: string;
    congeladoEm: string | null;
    ent: number;
    sai: number;
    resultado: number;
    congeladoAgora: boolean;
  } | null;
  nota?: string;
  erro?: string;
};

export type Checagem = {
  ref: string;
  consultadoEm: string;
  caixaProprio: number;
  limiteConta: number;
  vencidoAno: number;
  avisos: string[];
  /** Ausente em pacotes gravados antes da sombra existir (2026-10-07). */
  sombra?: SombraChecagem | null;
};

export type StatusExecucao = "na_fila" | "em_andamento" | "sucesso" | "erro";

export type ExecucaoCaixa = {
  id: number;
  origem: "agendado" | "manual";
  status: StatusExecucao;
  etapa: string | null;
  criadaEm: string;
  iniciadaEm: string | null;
  concluidaEm: string | null;
  avisos: string[];
  erro: string | null;
};

export type LinhaReceita = { nome: string; termos: string[] };

export type PacoteFluxoCaixa = {
  data: string;
  atualizadoEm: string;
  extrato: Extrato;
  extra: Extra;
  checagem: Checagem | null;
};
