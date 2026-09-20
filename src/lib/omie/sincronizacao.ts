/**
 * Sincroniza o faturamento do Omie de uma empresa para o banco.
 *
 * Base: ordens de serviço faturadas (ListarOS, status F), pela data de
 * faturamento — a mesma do resumo diário por e-mail. Cada OS vira valores por
 * competência × cliente × categoria. O total da OS (`nValorTotal`) é rateado
 * entre as categorias dos itens dela na proporção do valor bruto de cada item,
 * para a soma por categoria bater com o total faturado.
 *
 * Primeira vez: busca os últimos 13 meses (o ano corrente e o mês de
 * comparação anterior a ele). Depois: só o mês corrente e o anterior, que são
 * os que ainda mudam (faturamento em curso, cancelamento tardio).
 *
 * Grava com a secret key: as tabelas não têm policy de escrita. Quem chama
 * precisa ter conferido antes que a pessoa pertence à empresa.
 */

import { credenciaisDaEmpresa } from "@/lib/omie/resumo";
import {
  chamarOmie,
  ehBloqueioTemporario,
  ehListaVazia,
  ErroOmie,
  type CredenciaisOmie,
} from "@/lib/omie/cliente";
import { clienteAdmin } from "@/lib/supabase/admin";

const MESES_CARGA_INICIAL = 13;
const CONCORRENCIA = 3;
const POR_PAGINA = 100; // Teto do Omie para ListarOS e ListarClientesResumido.
/** Uma sincronização "iniciada" há mais que isso sem concluir é tratada como abandonada. */
const SINCRONIZACAO_TRAVADA_MS = 10 * 60 * 1000;

export type ResultadoSincronizacao =
  | { estado: "ok"; meses: number; ordens: number }
  | { estado: "sem-chaves" }
  | { estado: "em-andamento" }
  | { estado: "erro"; mensagem: string };

/* ------------------------------ Utilitários ------------------------------ */

const espera = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** O Omie devolve textos com entidades HTML ("GOES &amp; NICOLADELLI"). */
function decodificarEntidades(texto: string) {
  return texto
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Chamada com nova tentativa quando o Omie bloqueia por excesso de consumo. */
async function comRetentativa<T>(fn: () => Promise<T>): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await fn();
    } catch (erro) {
      if (tentativa >= 3 || !ehBloqueioTemporario(erro)) throw erro;
      await espera(3000 * (tentativa + 1));
    }
  }
}

/** Executa as tarefas com no máximo `limite` em paralelo, preservando a ordem. */
async function emParalelo<T>(tarefas: (() => Promise<T>)[], limite: number): Promise<T[]> {
  const resultados: T[] = new Array(tarefas.length);
  let proxima = 0;
  async function trabalhador() {
    while (proxima < tarefas.length) {
      const indice = proxima++;
      resultados[indice] = await tarefas[indice]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, trabalhador));
  return resultados;
}

const dataOmie = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** Competência (1º dia do mês, UTC) a partir de ano e mês 0-indexado. */
const competencia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 1));

/** Mês corrente no fuso do Brasil — é o calendário do faturamento do Omie. */
export function mesCorrente() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = Number(partes.find((p) => p.type === "year")!.value);
  const mes = Number(partes.find((p) => p.type === "month")!.value) - 1;
  return competencia(ano, mes);
}

/** Busca todas as páginas de uma listagem (a primeira em série, as demais em paralelo). */
async function todasAsPaginas<T>(
  buscar: (pagina: number) => Promise<{ total_de_paginas?: number; itens: T[] }>,
): Promise<T[]> {
  let primeira;
  try {
    primeira = await comRetentativa(() => buscar(1));
  } catch (erro) {
    if (ehListaVazia(erro)) return [];
    throw erro;
  }
  const total = primeira.total_de_paginas ?? 1;
  const resto = await emParalelo(
    Array.from({ length: Math.max(0, total - 1) }, (_, i) => () =>
      comRetentativa(() => buscar(i + 2)).catch((erro) => {
        if (ehListaVazia(erro)) return { itens: [] as T[] };
        throw erro;
      }),
    ),
    CONCORRENCIA,
  );
  return [primeira, ...resto].flatMap((pagina) => pagina.itens);
}

/* ------------------------------- Omie: dados ------------------------------ */

type OrdemServico = {
  Cabecalho?: { nCodCli?: number; nValorTotal?: number };
  InfoCadastro?: { cFaturada?: string; cCancelada?: string };
  InformacoesAdicionais?: { cCodCateg?: string };
  ServicosPrestados?: {
    cCodCategItem?: string;
    nValUnit?: number;
    nQtde?: number;
    nValorDesconto?: number;
    nValorAcrescimos?: number;
  }[];
};

async function ordensFaturadas(credenciais: CredenciaisOmie, inicio: Date) {
  const fim = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0));
  return todasAsPaginas<OrdemServico>(async (pagina) => {
    const r = await chamarOmie<{ total_de_paginas?: number; osCadastro?: OrdemServico[] }>(
      "servicos/os",
      "ListarOS",
      {
        pagina,
        registros_por_pagina: POR_PAGINA,
        filtrar_por_status: "F",
        filtrar_por_data_faturamento_de: dataOmie(inicio),
        filtrar_por_data_faturamento_ate: dataOmie(fim),
      },
      credenciais,
    );
    return { total_de_paginas: r.total_de_paginas, itens: r.osCadastro ?? [] };
  });
}

/** Valores de uma competência por cliente × categoria. */
function agregar(ordens: OrdemServico[]) {
  const mapa = new Map<string, { cliente: number; categoria: string; valor: number; os: number }>();

  for (const os of ordens) {
    if (os.InfoCadastro?.cCancelada === "S" || os.InfoCadastro?.cFaturada === "N") continue;
    const cliente = os.Cabecalho?.nCodCli;
    const total = os.Cabecalho?.nValorTotal ?? 0;
    if (!cliente || total === 0) continue;

    const categoriaCabecalho = os.InformacoesAdicionais?.cCodCateg || "sem-categoria";
    const brutoPorCategoria = new Map<string, number>();
    for (const item of os.ServicosPrestados ?? []) {
      const bruto =
        (item.nValUnit ?? 0) * (item.nQtde ?? 1) -
        (item.nValorDesconto ?? 0) +
        (item.nValorAcrescimos ?? 0);
      const categoria = item.cCodCategItem || categoriaCabecalho;
      brutoPorCategoria.set(categoria, (brutoPorCategoria.get(categoria) ?? 0) + Math.max(bruto, 0));
    }
    const somaBruta = [...brutoPorCategoria.values()].reduce((s, v) => s + v, 0);
    const partes =
      somaBruta > 0
        ? [...brutoPorCategoria].map(([categoria, bruto]) => [categoria, (total * bruto) / somaBruta] as const)
        : [[categoriaCabecalho, total] as const];

    for (const [categoria, valor] of partes) {
      const chave = `${cliente}|${categoria}`;
      const atual = mapa.get(chave) ?? { cliente, categoria, valor: 0, os: 0 };
      atual.valor += valor;
      atual.os += 1;
      mapa.set(chave, atual);
    }
  }

  return [...mapa.values()];
}

async function clientes(credenciais: CredenciaisOmie) {
  type Resumido = { codigo_cliente: number; razao_social?: string; nome_fantasia?: string };
  return todasAsPaginas<Resumido>(async (pagina) => {
    const r = await chamarOmie<{ total_de_paginas?: number; clientes_cadastro_resumido?: Resumido[] }>(
      "geral/clientes",
      "ListarClientesResumido",
      { pagina, registros_por_pagina: POR_PAGINA, apenas_importado_api: "N" },
      credenciais,
    );
    return { total_de_paginas: r.total_de_paginas, itens: r.clientes_cadastro_resumido ?? [] };
  });
}

async function categorias(credenciais: CredenciaisOmie) {
  type Categoria = { codigo: string; descricao: string };
  return todasAsPaginas<Categoria>(async (pagina) => {
    const r = await chamarOmie<{ total_de_paginas?: number; categoria_cadastro?: Categoria[] }>(
      "geral/categorias",
      "ListarCategorias",
      { pagina, registros_por_pagina: 500 },
      credenciais,
    );
    return { total_de_paginas: r.total_de_paginas, itens: r.categoria_cadastro ?? [] };
  });
}

/**
 * Situação do contrato de serviço (cCodSit): "00" rascunho, "10" ativo,
 * "90" suspenso, "99" cancelado — é o único jeito de saber se um cliente sem
 * faturamento no mês ainda tem contrato vigente ou já saiu de fato.
 */
async function contratos(credenciais: CredenciaisOmie) {
  type Contrato = {
    cabecalho?: { nCodCtr?: number; nCodCli?: number; cCodSit?: string };
    itensContrato?: { itemCabecalho?: { cCodCategItem?: string } }[];
  };
  return todasAsPaginas<Contrato>(async (pagina) => {
    const r = await chamarOmie<{ total_de_paginas?: number; contratoCadastro?: Contrato[] }>(
      "servicos/contrato",
      "ListarContratos",
      { pagina, registros_por_pagina: POR_PAGINA },
      credenciais,
    );
    return { total_de_paginas: r.total_de_paginas, itens: r.contratoCadastro ?? [] };
  });
}

/* ------------------------------- Gravação -------------------------------- */

async function emLotes<T>(itens: T[], tamanho: number, gravar: (lote: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < itens.length; i += tamanho) {
    const { error } = await gravar(itens.slice(i, i + tamanho));
    if (error) throw new Error(error.message);
  }
}

/* -------------------------------- Entrada -------------------------------- */

export async function sincronizarFaturamentoOmie(
  empresaId: string,
  opcoes: { completa?: boolean } = {},
): Promise<ResultadoSincronizacao> {
  const supabase = clienteAdmin();

  const { data: estadoAtual } = await supabase
    .from("omie_sincronizacao")
    .select("iniciada_em, concluida_em, primeira_competencia")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const iniciada = estadoAtual?.iniciada_em ? Date.parse(estadoAtual.iniciada_em) : 0;
  const concluida = estadoAtual?.concluida_em ? Date.parse(estadoAtual.concluida_em) : 0;
  if (iniciada > concluida && Date.now() - iniciada < SINCRONIZACAO_TRAVADA_MS) {
    return { estado: "em-andamento" };
  }

  const chaves = await credenciaisDaEmpresa(empresaId, supabase);
  if (chaves.estado !== "ok") return { estado: "sem-chaves" };

  const atual = mesCorrente();
  const completa = opcoes.completa || !estadoAtual?.primeira_competencia;
  const quantidadeMeses = completa ? MESES_CARGA_INICIAL : 2;
  const meses = Array.from({ length: quantidadeMeses }, (_, i) =>
    competencia(atual.getUTCFullYear(), atual.getUTCMonth() - (quantidadeMeses - 1 - i)),
  );

  const inicio = new Date().toISOString();
  await supabase
    .from("omie_sincronizacao")
    .upsert({ empresa_id: empresaId, iniciada_em: inicio, erro: null });

  try {
    // Tudo em série, só as páginas de cada listagem em paralelo: mantém as
    // chamadas simultâneas dentro do que o Omie tolera.
    const ordensPorMes: OrdemServico[][] = [];
    for (const mes of meses) ordensPorMes.push(await ordensFaturadas(chaves.credenciais, mes));
    const listaClientes = await clientes(chaves.credenciais);
    const listaCategorias = await categorias(chaves.credenciais);
    // Best-effort: conta sem o módulo de Contratos habilitado (ou uma falha
    // pontual da Omie) não pode derrubar a sincronização de faturamento por
    // causa disso — mas também não pode ser confundido com "não tem contrato
    // nenhum": só grava se a busca realmente funcionou, senão preserva o que
    // já estava no banco (ver uso de `contratosSincronizados` mais abaixo).
    let listaContratos: Awaited<ReturnType<typeof contratos>> = [];
    let contratosSincronizados = true;
    try {
      listaContratos = await contratos(chaves.credenciais);
    } catch {
      contratosSincronizados = false;
    }

    await emLotes(
      listaClientes.map((c) => ({
        empresa_id: empresaId,
        codigo: c.codigo_cliente,
        nome: decodificarEntidades(c.razao_social || c.nome_fantasia || `Cliente ${c.codigo_cliente}`).trim(),
      })),
      500,
      (lote) => supabase.from("omie_clientes").upsert(lote),
    );
    await emLotes(
      listaCategorias.map((c) => ({ empresa_id: empresaId, codigo: c.codigo, descricao: decodificarEntidades(c.descricao).trim() })),
      500,
      (lote) => supabase.from("omie_categorias").upsert(lote),
    );

    // Troca a lista inteira: contrato encerrado no Omie precisa sumir daqui,
    // não é algo que dá pra identificar comparando com o que já tínhamos. Só
    // faz isso se a busca funcionou — do contrário ficaríamos apagando o
    // espelho local por causa de uma falha passageira na Omie.
    if (contratosSincronizados) {
      const { error: erroExclusaoContratos } = await supabase
        .from("omie_contratos")
        .delete()
        .eq("empresa_id", empresaId);
      if (erroExclusaoContratos) throw new Error(erroExclusaoContratos.message);
      // Deduplica por código: páginas buscadas em paralelo podem repetir um
      // contrato. Upsert em vez de insert para duas sincronizações simultâneas
      // não colidirem entre o delete e a gravação.
      const contratosPorCodigo = new Map(
        listaContratos
          .filter((c) => c.cabecalho?.nCodCtr && c.cabecalho?.nCodCli && c.cabecalho?.cCodSit)
          .map((c) => [
            c.cabecalho!.nCodCtr!,
            {
              empresa_id: empresaId,
              codigo: c.cabecalho!.nCodCtr!,
              cliente_codigo: c.cabecalho!.nCodCli!,
              situacao: c.cabecalho!.cCodSit!,
              // Categorias dos itens do contrato — só um contrato com item de
              // categoria recorrente conta pras telas de recorrência.
              categorias: [
                ...new Set(
                  (c.itensContrato ?? [])
                    .map((item) => item.itemCabecalho?.cCodCategItem)
                    .filter((codigo): codigo is string => Boolean(codigo)),
                ),
              ],
            },
          ]),
      );
      await emLotes(
        [...contratosPorCodigo.values()],
        500,
        (lote) => supabase.from("omie_contratos").upsert(lote),
      );
    }

    let totalOrdens = 0;
    for (const [indice, mes] of meses.entries()) {
      const ordens = ordensPorMes[indice];
      totalOrdens += ordens.length;
      const dataCompetencia = mes.toISOString().slice(0, 10);

      // Troca o mês inteiro: OS cancelada depois do faturamento precisa sumir.
      const { error: erroExclusao } = await supabase
        .from("omie_faturamento_mensal")
        .delete()
        .eq("empresa_id", empresaId)
        .eq("competencia", dataCompetencia);
      if (erroExclusao) throw new Error(erroExclusao.message);

      await emLotes(
        agregar(ordens).map((linha) => ({
          empresa_id: empresaId,
          competencia: dataCompetencia,
          cliente_codigo: linha.cliente,
          categoria_codigo: linha.categoria,
          valor: Math.round(linha.valor * 100) / 100,
          quantidade_os: linha.os,
        })),
        1000,
        (lote) => supabase.from("omie_faturamento_mensal").insert(lote),
      );
    }

    await supabase.from("omie_sincronizacao").upsert({
      empresa_id: empresaId,
      iniciada_em: inicio,
      concluida_em: new Date().toISOString(),
      primeira_competencia: completa
        ? meses[0].toISOString().slice(0, 10)
        : estadoAtual?.primeira_competencia ?? meses[0].toISOString().slice(0, 10),
      erro: null,
    });

    return { estado: "ok", meses: meses.length, ordens: totalOrdens };
  } catch (erro) {
    const mensagem =
      erro instanceof ErroOmie
        ? `O Omie recusou a consulta: ${erro.message}`
        : erro instanceof Error
          ? erro.message
          : String(erro);
    await supabase
      .from("omie_sincronizacao")
      .upsert({ empresa_id: empresaId, concluida_em: new Date().toISOString(), erro: mensagem });
    return { estado: "erro", mensagem };
  }
}
