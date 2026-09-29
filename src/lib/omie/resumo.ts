/**
 * Resumo do Omie de uma empresa, para a tela "Resumo Omie".
 *
 * As credenciais não ficam no painel: `OMIE_APP_KEY` e `OMIE_APP_SECRET` vivem
 * no Infisical, na pasta da empresa (`infisical_caminhos_clientes`). O resumo
 * fica no cache do banco por 24 h (renovado às 10h e 16h); só ao renovar o
 * servidor busca as chaves e chama a API do Omie. Nada disso vai para o
 * navegador, que só recebe os números já agregados.
 *
 * Quem chama precisa ter validado antes que a pessoa pertence à empresa
 * (`empresaAtual` no DAL). As credenciais do Infisical vêm das variáveis de
 * ambiente; a leitura da configuração e da pasta passa pelo RLS da sessão.
 */

import { lerSegredos, variaveisFaltando } from "@/lib/infisical/api";
import { caminhoGravado, lerConfiguracaoInfisical } from "@/lib/infisical/clientes";
import type { Executor } from "@/lib/db";
import { naSessao } from "@/lib/dal";
import { chamarOmie, ehListaVazia, ErroOmie, type CredenciaisOmie } from "@/lib/omie/cliente";
import { comCache, idadeMs, lerCache, VALIDADE_CACHE_MS } from "@/lib/cache-externo";

export const SEGREDO_APP_KEY = "OMIE_APP_KEY";
export const SEGREDO_APP_SECRET = "OMIE_APP_SECRET";

/**
 * Chaves lidas no Infisical, em memória (nunca no banco), por 24 horas — o
 * mesmo ciclo do cache dos dados. Limpas ao gravar chaves novas e no início
 * de cada rodada do cron das 10h e 16h.
 */
const VALIDADE_CHAVES_MS = 24 * 60 * 60 * 1000;
const chavesEmMemoria = new Map<string, { em: number; caminho: string; mapa: Record<string, string> }>();

export function descartarChavesOmie(empresaId?: string) {
  if (empresaId) chavesEmMemoria.delete(empresaId);
  else chavesEmMemoria.clear();
}

export type TituloAtrasado = {
  id: number;
  cliente: string;
  valor: number;
  vencimento: string;
  diasAtraso: number;
  categoria: string;
};

export type Categoria = { descricao: string; valor: number; quantidade: number };

export type ResumoOmie = {
  consultadoEm: string;
  empresa: { razaoSocial: string; nomeFantasia: string; cnpj: string; cidade: string } | null;
  saldoContas: number;
  receber: { valor: number; titulos: number; atraso: number };
  pagar: { valor: number; titulos: number; atraso: number };
  fluxoHoje: { receber: number; pagar: number; saldo: number } | null;
  receberPorCategoria: Categoria[];
  pagarPorCategoria: Categoria[];
  receberAtrasados: TituloAtrasado[];
  pagarAtrasados: TituloAtrasado[];
  /** `null` quando a contagem falhou — as outras seções seguem valendo. */
  totalClientes: number | null;
  totalProdutos: number | null;
  avisos: string[];
};

export type EstadoResumoOmie =
  | { estado: "sem-infisical"; variaveisFaltando: string[]; configurado: boolean }
  /** `caminho` nulo: a pasta do cliente ainda não foi criada. */
  | { estado: "sem-chaves"; caminho: string | null; faltando: string[] }
  /** `origem` separa recusa do Omie (chave errada, sem permissão) de falha do próprio painel. */
  | { estado: "erro"; origem: "omie" | "painel"; mensagem: string }
  | { estado: "ok"; resumo: ResumoOmie; caminho: string };

/* --------------------------- Tipos das respostas -------------------------- */

type ItemCategoria = { vTotal?: number; nTotal?: number; cDescCateg?: string; cCodCateg?: string };
type ItemAtraso = {
  nIdTitulo: number;
  cNomeCliente?: string;
  vDoc?: number;
  dVencimento?: string;
  nDiasAtraso?: number;
  cDescCateg?: string;
};

type RespostaResumoFinancas = {
  contaCorrente?: { vTotal?: number };
  contaPagar?: { nTotal?: number; vTotal?: number; vAtraso?: number };
  contaReceber?: { nTotal?: number; vTotal?: number; vAtraso?: number };
  contaPagarCategoria?: ItemCategoria[];
  contaReceberCategoria?: ItemCategoria[];
  contaPagarAtraso?: ItemAtraso[];
  contaReceberAtraso?: ItemAtraso[];
  fluxoCaixa?: { vPagar?: number; vReceber?: number; vSaldo?: number };
};

type RespostaListagem = { total_de_registros?: number };

type RespostaEmpresas = {
  empresas_cadastro?: {
    razao_social?: string;
    nome_fantasia?: string;
    cnpj?: string;
    cidade?: string;
    estado?: string;
  }[];
};

/* --------------------------------- Chaves -------------------------------- */

/**
 * Chaves do Omie da empresa, lidas no Infisical. Sem `banco`, usa a sessão
 * de quem está na tela (RLS); o cron passa `db`, que roda sem sessão.
 */
export async function credenciaisDaEmpresa(
  empresaId: string,
  banco?: Executor,
): Promise<
  | { estado: "ok"; credenciais: CredenciaisOmie; caminho: string }
  | Exclude<EstadoResumoOmie, { estado: "ok" }>
> {
  const faltandoAmbiente = variaveisFaltando();
  const ler = (tx: Executor) =>
    Promise.all([lerConfiguracaoInfisical(tx), caminhoGravado(tx, empresaId)]);
  const [config, caminho] = banco ? await ler(banco) : await naSessao(ler);

  if (faltandoAmbiente.length > 0 || !config) {
    return { estado: "sem-infisical", variaveisFaltando: faltandoAmbiente, configurado: Boolean(config) };
  }
  if (!caminho) return { estado: "sem-chaves", caminho: null, faltando: [SEGREDO_APP_KEY, SEGREDO_APP_SECRET] };

  const guardadas = chavesEmMemoria.get(empresaId);
  let mapa: Record<string, string>;
  if (guardadas && guardadas.caminho === caminho && Date.now() - guardadas.em < VALIDADE_CHAVES_MS) {
    mapa = guardadas.mapa;
  } else {
    mapa = await lerSegredos({ projetoId: config.projetoId, ambiente: config.ambiente, caminho });
    chavesEmMemoria.set(empresaId, { em: Date.now(), caminho, mapa });
  }

  const appKey = mapa[SEGREDO_APP_KEY]?.trim();
  const appSecret = mapa[SEGREDO_APP_SECRET]?.trim();

  if (!appKey || !appSecret) {
    const faltando = [
      ...(appKey ? [] : [SEGREDO_APP_KEY]),
      ...(appSecret ? [] : [SEGREDO_APP_SECRET]),
    ];
    return { estado: "sem-chaves", caminho, faltando };
  }

  return { estado: "ok", credenciais: { appKey, appSecret }, caminho };
}

/* --------------------------------- Resumo -------------------------------- */

/** Data de hoje no fuso do Omie (Brasil), no formato dd/mm/aaaa que a API espera. */
function hojeNoOmie() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

async function contarRegistros(
  modulo: string,
  call: string,
  extra: Record<string, unknown>,
  credenciais: CredenciaisOmie,
) {
  try {
    const resposta = await chamarOmie<RespostaListagem>(
      modulo,
      call,
      { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N", ...extra },
      credenciais,
    );
    return resposta.total_de_registros ?? 0;
  } catch (erro) {
    if (ehListaVazia(erro)) return 0;
    throw erro;
  }
}

const categorias = (itens: ItemCategoria[] = []): Categoria[] =>
  itens
    .map((item) => ({
      descricao: item.cDescCateg?.trim() || item.cCodCateg || "Sem categoria",
      valor: item.vTotal ?? 0,
      quantidade: item.nTotal ?? 0,
    }))
    .filter((item) => item.valor > 0)
    .sort((a, b) => b.valor - a.valor);

const atrasados = (itens: ItemAtraso[] = []): TituloAtrasado[] =>
  itens
    .map((item) => ({
      id: item.nIdTitulo,
      cliente: item.cNomeCliente?.trim() || "—",
      valor: item.vDoc ?? 0,
      vencimento: item.dVencimento ?? "—",
      diasAtraso: item.nDiasAtraso ?? 0,
      categoria: item.cDescCateg?.trim() || "—",
    }))
    .sort((a, b) => b.diasAtraso - a.diasAtraso);

function mensagemDe(erro: unknown) {
  return erro instanceof Error ? erro.message : String(erro);
}

async function montarResumo(credenciais: CredenciaisOmie): Promise<ResumoOmie> {
  // `allSettled`: uma seção que falha (permissão do usuário da API no Omie,
  // por exemplo) não derruba a tela inteira. Só o resumo financeiro é
  // obrigatório — sem ele não há o que mostrar.
  const [financas, empresas, clientes, produtos] = await Promise.allSettled([
    chamarOmie<RespostaResumoFinancas>(
      "financas/resumo",
      "ObterResumoFinancas",
      { dDia: hojeNoOmie(), lApenasResumo: false, lExibirCategoria: true },
      credenciais,
    ),
    chamarOmie<RespostaEmpresas>(
      "geral/empresas",
      "ListarEmpresas",
      { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N" },
      credenciais,
    ),
    contarRegistros("geral/clientes", "ListarClientesResumido", {}, credenciais),
    contarRegistros(
      "geral/produtos",
      "ListarProdutosResumido",
      { filtrar_apenas_omiepdv: "N" },
      credenciais,
    ),
  ]);

  if (financas.status === "rejected") throw financas.reason;

  const f = financas.value;
  const avisos: string[] = [];
  if (empresas.status === "rejected") avisos.push(`Dados da empresa: ${mensagemDe(empresas.reason)}`);
  if (clientes.status === "rejected") avisos.push(`Clientes: ${mensagemDe(clientes.reason)}`);
  if (produtos.status === "rejected") avisos.push(`Produtos: ${mensagemDe(produtos.reason)}`);

  const cadastro =
    empresas.status === "fulfilled" ? empresas.value.empresas_cadastro?.[0] : undefined;

  return {
    consultadoEm: new Date().toISOString(),
    empresa: cadastro
      ? {
          razaoSocial: cadastro.razao_social?.trim() ?? "",
          nomeFantasia: cadastro.nome_fantasia?.trim() ?? "",
          cnpj: cadastro.cnpj ?? "",
          cidade: [cadastro.cidade, cadastro.estado].filter(Boolean).join(" · "),
        }
      : null,
    saldoContas: f.contaCorrente?.vTotal ?? 0,
    receber: {
      valor: f.contaReceber?.vTotal ?? 0,
      titulos: f.contaReceber?.nTotal ?? 0,
      atraso: f.contaReceber?.vAtraso ?? 0,
    },
    pagar: {
      valor: f.contaPagar?.vTotal ?? 0,
      titulos: f.contaPagar?.nTotal ?? 0,
      atraso: f.contaPagar?.vAtraso ?? 0,
    },
    fluxoHoje: f.fluxoCaixa
      ? {
          receber: f.fluxoCaixa.vReceber ?? 0,
          pagar: f.fluxoCaixa.vPagar ?? 0,
          saldo: f.fluxoCaixa.vSaldo ?? 0,
        }
      : null,
    receberPorCategoria: categorias(f.contaReceberCategoria),
    pagarPorCategoria: categorias(f.contaPagarCategoria),
    receberAtrasados: atrasados(f.contaReceberAtraso),
    pagarAtrasados: atrasados(f.contaPagarAtraso),
    totalClientes: clientes.status === "fulfilled" ? clientes.value : null,
    totalProdutos: produtos.status === "fulfilled" ? produtos.value : null,
    avisos,
  };
}

/**
 * Intervalo mínimo entre duas consultas da mesma empresa ao forçar a
 * atualização: o Omie recusa a mesma chamada repetida em sequência
 * ("consumo redundante"), e um clique duplo derrubaria a tela com esse erro.
 */
export const INTERVALO_MINIMO_ATUALIZAR_MS = 60 * 1000;

/** Há quanto tempo o resumo guardado foi consultado, ou `null` se não há nenhum. */
export async function idadeResumoOmie(empresaId: string) {
  const guardado = await lerCache<ResumoOmie>(empresaId, "omie:resumo");
  return guardado ? idadeMs(guardado.em) : null;
}

/**
 * Resumo do Omie da empresa, do cache (`cache_externo`, 24 h, renovado às 10h
 * e 16h). `forcar` consulta o Omie mesmo com cache válido — botão "Atualizar"
 * e cron. `banco` = `db` quando não há sessão (cron).
 */
export async function obterResumoOmie(
  empresaId: string,
  { forcar = false, banco }: { forcar?: boolean; banco?: Executor } = {},
): Promise<EstadoResumoOmie> {
  try {
    if (!forcar) {
      const guardado = await lerCache<ResumoOmie>(empresaId, "omie:resumo");
      if (guardado && idadeMs(guardado.em) < VALIDADE_CACHE_MS) {
        const caminho = banco ? await caminhoGravado(banco, empresaId) : await naSessao((tx) => caminhoGravado(tx, empresaId));
        if (caminho) return { estado: "ok", resumo: guardado.valor, caminho };
      }
    }

    const chaves = await credenciaisDaEmpresa(empresaId, banco);
    if (chaves.estado !== "ok") return chaves;

    const { valor, em, desatualizado } = await comCache(
      empresaId,
      "omie:resumo",
      () => montarResumo(chaves.credenciais),
      { forcar: true },
    );
    const resumo = desatualizado
      ? {
          ...valor,
          avisos: [
            ...valor.avisos,
            `O Omie não respondeu na última atualização; os números são de ${new Date(em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`,
          ],
        }
      : valor;
    return { estado: "ok", resumo, caminho: chaves.caminho };
  } catch (erro) {
    return erro instanceof ErroOmie
      ? { estado: "erro", origem: "omie", mensagem: `O Omie recusou a consulta: ${erro.message}` }
      : {
          estado: "erro",
          origem: "painel",
          mensagem: `Não foi possível montar o resumo: ${mensagemDe(erro)}`,
        };
  }
}

/* ------------------------------ Status das chaves ------------------------------ */

export type PresencaChave = "cadastrada" | "ausente" | "desconhecida";

/**
 * O que a tela pode saber das chaves sem nunca receber o valor delas: se
 * existem no Infisical e se o Omie as aceitou na última consulta.
 */
export type StatusChavesOmie = {
  infisicalConfigurado: boolean;
  chaves: { nome: string; presenca: PresencaChave }[];
  validacao:
    | { tipo: "validas" }
    | { tipo: "recusadas"; mensagem: string }
    | { tipo: "ausentes" }
    | { tipo: "nao-verificadas"; mensagem: string };
};

export function statusDasChaves(estado: EstadoResumoOmie): StatusChavesOmie {
  const nomes = [SEGREDO_APP_KEY, SEGREDO_APP_SECRET];
  const todas = (presenca: PresencaChave) => nomes.map((nome) => ({ nome, presenca }));

  switch (estado.estado) {
    case "ok":
      return { infisicalConfigurado: true, chaves: todas("cadastrada"), validacao: { tipo: "validas" } };
    case "sem-chaves":
      return {
        infisicalConfigurado: true,
        chaves: nomes.map((nome) => ({
          nome,
          presenca: estado.faltando.includes(nome) ? "ausente" : "cadastrada",
        })),
        validacao: { tipo: "ausentes" },
      };
    case "erro":
      // Recusa do Omie só acontece depois de ler as duas chaves no Infisical.
      return estado.origem === "omie"
        ? {
            infisicalConfigurado: true,
            chaves: todas("cadastrada"),
            validacao: { tipo: "recusadas", mensagem: estado.mensagem },
          }
        : {
            infisicalConfigurado: true,
            chaves: todas("desconhecida"),
            validacao: { tipo: "nao-verificadas", mensagem: estado.mensagem },
          };
    case "sem-infisical":
      return {
        infisicalConfigurado: false,
        chaves: todas("desconhecida"),
        validacao: { tipo: "nao-verificadas", mensagem: "O Infisical ainda não está configurado." },
      };
  }
}
