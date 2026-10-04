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

export type Extra = {
  ref: string;
  ano: number;
  hist: MesHistorico[];
  /** mês (`aaaa-mm`) -> categoria -> valor (positivo entra, negativo sai). */
  catmes: Record<string, Record<string, number>>;
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
    /** Linha por cliente: `tot` e uma chave `aaaa-mm` por mês de vencimento. */
    cxm: ({ cliente: string; tot: number } & Record<string, number | string>)[];
    meses: string[];
    fatAno: number;
    top5: number;
  };
  atrasos: {
    ref: string;
    faixas: Record<"7" | "15" | "30", { valor: number; n: number; clientes: number }>;
    itens: { cliente: string; venc: string; dias: number; valor: number; categoria: string; doc: string }[];
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

export type Checagem = {
  ref: string;
  consultadoEm: string;
  caixaProprio: number;
  limiteConta: number;
  vencidoAno: number;
  avisos: string[];
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
