/**
 * Consultas do painel.
 *
 * Toda função recebe `empresaIds` explicitamente — quem resolve quais
 * empresas são válidas para a pessoa logada é o DAL (`empresaAtual` para uma
 * só, `empresasDoUsuario` para o escopo agregado da Admin). O RLS filtra de
 * novo no banco, então um esquecimento aqui não vira vazamento entre
 * clientes; o array normalmente tem uma posição só, e mais de uma apenas
 * quando a Admin está vendo dados de vários clientes ao mesmo tempo.
 */

import { and, asc, count, desc, eq, gte, inArray, isNotNull, max, sql } from "drizzle-orm";
import { naSessao } from "@/lib/dal";
import {
  acessosChaves,
  automacoes,
  empresas,
  execucoes,
  logsExecucao,
  membros,
  perfis,
  validacaoSaldoDiario,
} from "@/lib/db/schema";
import { gatilhoDe, type ConfigAutomacao } from "@/lib/automacao-tipos";
import type {
  Automacao,
  Execucao,
  Log,
  PontoDisparo,
  Usuario,
  ValidacaoSaldoDia,
} from "@/lib/tipos";

const UM_DIA = 86_400_000;

// Os "embeds" do PostgREST (`automacoes.select("..., empresas (nome)")`) viram
// LEFT JOIN: mesma semântica — a linha relacionada vem nula quando não existe
// ou quando o RLS a esconde de quem consulta.

export async function listarAutomacoes(empresaIds: string[]): Promise<Automacao[]> {
  if (empresaIds.length === 0) return [];

  const lista = await naSessao((tx) =>
    tx
      .select({
        id: automacoes.id,
        nome: automacoes.nome,
        descricao: automacoes.descricao,
        status: automacoes.status,
        tipo: automacoes.tipo,
        config: automacoes.config,
        proxima_execucao: automacoes.proxima_execucao,
        empresa: empresas.nome,
      })
      .from(automacoes)
      .leftJoin(empresas, eq(empresas.id, automacoes.empresa_id))
      .where(inArray(automacoes.empresa_id, empresaIds))
      .orderBy(desc(automacoes.criada_em)),
  );

  if (lista.length === 0) return [];

  // Contagem dos últimos 30 dias e a última execução, agregadas no banco:
  // uma linha por automação, em vez de todas as execuções trafegando até o Node.
  const desde = new Date(Date.now() - 30 * UM_DIA).toISOString();
  const recentes = await naSessao((tx) =>
    tx
      .select({
        automacao_id: execucoes.automacao_id,
        total: count(),
        ultima: max(execucoes.iniciada_em),
      })
      .from(execucoes)
      .where(and(inArray(execucoes.empresa_id, empresaIds), gte(execucoes.iniciada_em, desde)))
      .groupBy(execucoes.automacao_id),
  );

  const totais = new Map<string, number>();
  const ultimas = new Map<string, string>();
  for (const linha of recentes) {
    totais.set(linha.automacao_id, Number(linha.total));
    if (linha.ultima) ultimas.set(linha.automacao_id, linha.ultima);
  }

  return lista.map((linha) => {
    const entrada = {
      tipo: linha.tipo,
      config: linha.config,
    } as ConfigAutomacao;

    return {
      id: linha.id,
      nome: linha.nome,
      descricao: linha.descricao,
      status: linha.status,
      gatilho: gatilhoDe(entrada),
      execucoes30d: totais.get(linha.id) ?? 0,
      ultimaExecucao: ultimas.get(linha.id) ?? null,
      proximaExecucao: linha.proxima_execucao,
      empresa: linha.empresa ?? "—",
      ...entrada,
    } as Automacao;
  });
}

export async function listarExecucoes(
  empresaIds: string[],
  limite = 50,
): Promise<Execucao[]> {
  if (empresaIds.length === 0) return [];

  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: execucoes.id,
        resultado: execucoes.resultado,
        origem: execucoes.origem,
        iniciada_em: execucoes.iniciada_em,
        duracao_ms: execucoes.duracao_ms,
        automacao: automacoes.nome,
        empresa: empresas.nome,
      })
      .from(execucoes)
      .leftJoin(automacoes, eq(automacoes.id, execucoes.automacao_id))
      .leftJoin(empresas, eq(empresas.id, execucoes.empresa_id))
      .where(inArray(execucoes.empresa_id, empresaIds))
      .orderBy(desc(execucoes.iniciada_em))
      .limit(limite),
  );

  return linhas.map((linha) => ({
    id: linha.id,
    automacao: linha.automacao ?? "Automação removida",
    resultado: linha.resultado,
    inicio: linha.iniciada_em,
    duracaoMs: linha.duracao_ms,
    origem: linha.origem,
    empresa: linha.empresa ?? "—",
  }));
}

export async function listarLogs(empresaIds: string[], limite = 20): Promise<Log[]> {
  if (empresaIds.length === 0) return [];

  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: logsExecucao.id,
        nivel: logsExecucao.nivel,
        mensagem: logsExecucao.mensagem,
        horario: logsExecucao.horario,
        automacao: automacoes.nome,
      })
      .from(logsExecucao)
      .leftJoin(execucoes, eq(execucoes.id, logsExecucao.execucao_id))
      .leftJoin(automacoes, eq(automacoes.id, execucoes.automacao_id))
      .where(inArray(logsExecucao.empresa_id, empresaIds))
      .orderBy(desc(logsExecucao.horario))
      .limit(limite),
  );

  return linhas.map((linha) => ({
    id: String(linha.id),
    nivel: linha.nivel,
    horario: linha.horario,
    automacao: linha.automacao ?? "—",
    mensagem: linha.mensagem,
  }));
}

/**
 * Validação diária de saldo (banco x Omie), gravada por
 * `scripts/validar_saldo_diario.py` (proos-omie-mcp) — não há sincronização
 * automática ainda, então esta lista só cresce quando alguém sobe um
 * extrato novo e roda o script. `empresaId` é singular (não `empresaIds[]`
 * como as outras consultas): a tela mostra a empresa selecionada, nunca a
 * visão agregada da Admin, porque saldo bancário é dado sensível por
 * empresa.
 */
export async function listarValidacaoSaldoDiario(
  empresaId: string,
  limite = 400,
): Promise<ValidacaoSaldoDia[]> {
  const linhas = await naSessao((tx) =>
    tx
      .select({
        contaId: validacaoSaldoDiario.conta_id,
        contaDescricao: validacaoSaldoDiario.conta_descricao,
        data: validacaoSaldoDiario.data,
        saldoBanco: validacaoSaldoDiario.saldo_banco,
        saldoOmie: validacaoSaldoDiario.saldo_omie,
        diferenca: validacaoSaldoDiario.diferenca,
        movimentoBanco: validacaoSaldoDiario.movimento_banco,
        movimentoOmie: validacaoSaldoDiario.movimento_omie,
        diferencaMovimento: validacaoSaldoDiario.diferenca_movimento,
        fonteExtrato: validacaoSaldoDiario.fonte_extrato,
        atualizadoEm: validacaoSaldoDiario.atualizado_em,
      })
      .from(validacaoSaldoDiario)
      .where(eq(validacaoSaldoDiario.empresa_id, empresaId))
      .orderBy(asc(validacaoSaldoDiario.conta_id), desc(validacaoSaldoDiario.data))
      .limit(limite),
  );

  return linhas;
}

export type Vinculo = {
  id: string;
  nome: string;
  status: Automacao["status"];
  empresaId: string;
  empresa: string;
  ehPlataforma: boolean;
};

/**
 * Automações vindas do n8n e a empresa dona de cada uma, para a tela de
 * vínculos. Sem filtro de empresa de propósito: a tela é da Proos, que
 * enxerga todas — o RLS já garante que mais ninguém alcance isto.
 */
export async function listarVinculos(): Promise<Vinculo[]> {
  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: automacoes.id,
        nome: automacoes.nome,
        status: automacoes.status,
        empresaId: automacoes.empresa_id,
        empresa: empresas.nome,
        ehPlataforma: empresas.eh_plataforma,
      })
      .from(automacoes)
      .leftJoin(empresas, eq(empresas.id, automacoes.empresa_id))
      .where(eq(automacoes.tipo, "n8n"))
      .orderBy(asc(automacoes.nome)),
  );

  return linhas.map((linha) => ({
    ...linha,
    empresa: linha.empresa ?? "—",
    ehPlataforma: linha.ehPlataforma ?? false,
  }));
}

export type Chave = {
  id: string;
  nome: string;
  descricao: string;
  criadoPor: string | null;
  criadoEm: string;
};

/**
 * Credenciais da empresa. Devolve só o metadado — `valor` vive em
 * `acessos_chaves_segredo`, que não tem policy de SELECT e por isso nem
 * aparece aqui.
 */
export async function listarChaves(empresaId: string): Promise<Chave[]> {
  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: acessosChaves.id,
        nome: acessosChaves.nome,
        descricao: acessosChaves.descricao,
        criadoEm: acessosChaves.criado_em,
        autorNome: perfis.nome,
        autorEmail: perfis.email,
      })
      .from(acessosChaves)
      .leftJoin(perfis, eq(perfis.id, acessosChaves.criado_por))
      .where(eq(acessosChaves.empresa_id, empresaId))
      .orderBy(desc(acessosChaves.criado_em)),
  );

  return linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    criadoPor: linha.autorEmail !== null ? linha.autorNome || linha.autorEmail : null,
    criadoEm: linha.criadoEm,
  }));
}

export async function listarUsuarios(empresaId: string): Promise<Usuario[]> {
  // INNER JOIN: vínculo cujo perfil o RLS não mostra fica de fora, como antes.
  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: perfis.id,
        nome: perfis.nome,
        email: perfis.email,
        ultimoAcesso: perfis.ultimo_acesso,
        papel: membros.papel,
        status: membros.status,
      })
      .from(membros)
      .innerJoin(perfis, eq(perfis.id, membros.user_id))
      .where(eq(membros.empresa_id, empresaId)),
  );

  return linhas.map((linha) => ({ ...linha, nome: linha.nome || linha.email }));
}

/**
 * Métricas do dashboard, derivadas das execuções reais dos últimos 30 dias.
 *
 * Enquanto nada tiver rodado, tudo volta zerado — as telas tratam esse caso
 * com estado vazio em vez de gráfico em branco.
 */
export async function metricasDashboard(empresaIds: string[]) {
  const desde = new Date(Date.now() - 30 * UM_DIA);

  // Agregado no banco por dia/hora/resultado (no fuso do servidor, como antes
  // era feito em JS): centenas de linhas viram algumas dezenas.
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = sql`${execucoes.iniciada_em} at time zone ${fuso}`;
  const dia = sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
  const hora = sql<number>`extract(hour from ${local})::int`;

  // `inArray(..., [])` do Drizzle vira um predicado sempre falso — devolve
  // zero linhas, não erro. A série de 30 dias abaixo já preenche zerada nesse
  // caso, então não precisa de um caminho separado para "sem empresa".
  const grupos = await naSessao((tx) =>
    tx
      .select({
        dia,
        hora,
        resultado: execucoes.resultado,
        n: count(),
        somaDuracao: sql<string | null>`sum(${execucoes.duracao_ms})`,
        comDuracao: count(execucoes.duracao_ms),
      })
      .from(execucoes)
      .where(
        and(inArray(execucoes.empresa_id, empresaIds), gte(execucoes.iniciada_em, desde.toISOString())),
      )
      // Por posição (dia, hora, resultado): o fuso vai como parâmetro em cada
      // expressão, e o Postgres não reconhece duas com parâmetros distintos
      // como a mesma — agrupar pelas expressões daria erro 42803.
      .groupBy(sql`1`, sql`2`, sql`3`),
  );

  // Uma casa por dia dos últimos 30, para o gráfico não ficar com buracos.
  const porDia = new Map<string, { sucesso: number; erro: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * UM_DIA);
    porDia.set(chaveDia(d), { sucesso: 0, erro: 0 });
  }

  const porHora = Array.from({ length: 24 }, () => 0);
  let total = 0;
  let sucessos = 0;
  let erros = 0;
  let somaDuracoes = 0;
  let comDuracao = 0;

  for (const grupo of grupos) {
    const n = Number(grupo.n);
    const casa = porDia.get(grupo.dia);
    total += n;

    if (grupo.resultado === "sucesso") {
      sucessos += n;
      if (casa) casa.sucesso += n;
    } else if (grupo.resultado === "erro") {
      erros += n;
      if (casa) casa.erro += n;
    }

    porHora[Number(grupo.hora)] += n;
    somaDuracoes += Number(grupo.somaDuracao ?? 0);
    comDuracao += Number(grupo.comDuracao);
  }

  const serie30d: PontoDisparo[] = [...porDia.entries()].map(
    ([chave, valores]) => ({
      rotulo: chave.slice(8, 10) + "/" + chave.slice(5, 7),
      ...valores,
    }),
  );

  return {
    total,
    sucessos,
    erros,
    duracaoMediaMs: comDuracao > 0 ? Math.round(somaDuracoes / comDuracao) : null,
    serie30d,
    serie14d: serie30d.slice(-14),
    porHora,
  };
}

/** Chave `AAAA-MM-DD` no fuso local, para agrupar execuções por dia. */
function chaveDia(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;
}

/** Automações ativas com execução agendada, da mais próxima para a mais distante. */
export async function proximasExecucoes(empresaIds: string[], limite = 5) {
  if (empresaIds.length === 0) return [];

  const linhas = await naSessao((tx) =>
    tx
      .select({
        id: automacoes.id,
        nome: automacoes.nome,
        tipo: automacoes.tipo,
        config: automacoes.config,
        proxima_execucao: automacoes.proxima_execucao,
      })
      .from(automacoes)
      .where(
        and(
          inArray(automacoes.empresa_id, empresaIds),
          eq(automacoes.status, "ativa"),
          isNotNull(automacoes.proxima_execucao),
        ),
      )
      .orderBy(asc(automacoes.proxima_execucao))
      .limit(limite),
  );

  return linhas.map((linha) => ({
    id: linha.id,
    automacao: linha.nome,
    // O filtro `isNotNull` acima garante; o tipo da coluna não sabe disso.
    quando: linha.proxima_execucao!,
    gatilho: gatilhoDe({
      tipo: linha.tipo,
      config: linha.config,
    } as ConfigAutomacao),
  }));
}
