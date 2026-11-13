"use server";

/**
 * Excedentes OYSTR: o analista sobe a planilha mensal, o worker (container
 * de conciliação, proos-omie-mcp/caixa/excedentes_worker.py) monta o PLANO
 * sem escrever nada no Omie, o analista resolve exceções e aprova — só
 * então as OSs são criadas, na etapa Faturar (50), nunca faturadas.
 *
 * Idempotência: cCodIntOS "EXC-AAAAMM-<contrato>" (sem contrato, CNPJ só
 * dígitos) — reenviar a planilha não duplica OS (vira "já existe").
 * Competência: sempre o mês corrente no upload (decisão Rodrigo 2026-11-12).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { exigirPermissaoDeEscrita, verificarSessao } from "@/lib/dal";

const TAMANHO_MAXIMO_XLSX = 10 * 1024 * 1024;

function competenciaAtual(): string {
  // AAAAMM no fuso de São Paulo (o servidor roda em TZ America/Sao_Paulo,
  // mas não dependemos disso).
  const agora = new Date().toLocaleDateString("sv", { timeZone: "America/Sao_Paulo" });
  return agora.slice(0, 7).replace("-", "");
}

/* --------------------------------- upload -------------------------------- */

export type ResultadoEnfileirarExcedentes = { erro?: string; loteId?: number };

export async function enfileirarExcedentes(
  dados: FormData,
): Promise<ResultadoEnfileirarExcedentes> {
  const empresaId = String(dados.get("empresaId") ?? "");
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão para processar excedentes desta empresa." };
  }

  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha a planilha de excedentes (.xlsx)." };
  }
  if (!arquivo.name.toLowerCase().endsWith(".xlsx")) {
    return { erro: "Use um arquivo .xlsx." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_XLSX) {
    return { erro: "O arquivo passa do limite de 10 MB." };
  }

  const { email } = await verificarSessao();
  const b64 = Buffer.from(await arquivo.arrayBuffer()).toString("base64");

  const inseridas = await db.execute<{ id: number }>(sql`
    insert into public.excedentes_lote
      (empresa_id, competencia, planilha_nome, planilha_b64, enviado_por)
    values (${empresaId}::uuid, ${competenciaAtual()}, ${arquivo.name}, ${b64}, ${email})
    returning id
  `);
  return { loteId: Number(inseridas[0]?.id) };
}

/* --------------------------------- status -------------------------------- */

export type LinhaExcedente = {
  id: number;
  linhaPlanilha: number;
  cliente: string | null;
  cnpj: string | null;
  descricao: string | null;
  codRecorrente: string | null;
  valorTotal: string;
  numeroContrato: string | null;
  nCodCtr: number | null;
  descExcedente: string | null;
  nCodServ: number | null;
  categoria: string | null;
  vencFinal: string | null;
  regraVenc: string | null;
  emailEnvio: string | null;
  status: string;
  avisos: string[];
  excecaoMotivo: string | null;
  codigoIntOs: string | null;
  numeroOs: string | null;
  criacaoStatus: string | null;
  criacaoErro: string | null;
  formaFaturamento: string;          // "os" | "contrato"
  nDiaFat: number | null;
  contratoAcao: string | null;       // "atualizar" | "incluir"
  contratoValorAtual: string | null;
};

export type StatusLote = {
  status:
    | "nenhum"
    | "na_fila"
    | "planejando"
    | "aguardando_aprovacao"
    | "aprovado"
    | "criando"
    | "concluido"
    | "erro";
  loteId?: number;
  competencia?: string;
  etapa?: string | null;
  erro?: string;
  enviadoPor?: string;
  aprovadoPor?: string | null;
  planilhaNome?: string | null;
  resumo?: Record<string, unknown> | null;
  linhas?: LinhaExcedente[];
};

export async function consultarExcedentes(
  empresaId: string,
  loteId?: number,
): Promise<StatusLote> {
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { status: "erro", erro: "Sem permissão para ver os excedentes desta empresa." };
  }

  const filtroId = loteId ? sql`and id = ${loteId}` : sql``;
  const lotes = await db.execute<{
    id: number;
    competencia: string;
    status: StatusLote["status"];
    etapa: string | null;
    erro: string | null;
    enviado_por: string;
    aprovado_por: string | null;
    planilha_nome: string | null;
    resumo: Record<string, unknown> | null;
  }>(sql`
    select id, competencia, status, etapa, erro, enviado_por, aprovado_por,
           planilha_nome, resumo
    from public.excedentes_lote
    where empresa_id = ${empresaId}::uuid ${filtroId}
    order by id desc
    limit 1
  `);
  const lote = lotes[0];
  if (!lote) return { status: "nenhum" };

  const base: StatusLote = {
    status: lote.status,
    loteId: Number(lote.id),
    competencia: lote.competencia,
    etapa: lote.etapa,
    erro: lote.erro ?? undefined,
    enviadoPor: lote.enviado_por,
    aprovadoPor: lote.aprovado_por,
    planilhaNome: lote.planilha_nome,
    resumo: lote.resumo,
  };
  if (!["aguardando_aprovacao", "aprovado", "criando", "concluido", "erro"].includes(lote.status)) {
    return base;
  }

  const linhas = await db.execute<{
    id: number;
    linha_planilha: number;
    cliente: string | null;
    cnpj: string | null;
    descricao: string | null;
    cod_recorrente: string | null;
    valor_total: string;
    numero_contrato: string | null;
    n_cod_ctr: number | null;
    desc_excedente: string | null;
    n_cod_serv: number | null;
    categoria: string | null;
    venc_final: string | null;
    regra_venc: string | null;
    email_envio: string | null;
    status: string;
    avisos: string[] | null;
    excecao_motivo: string | null;
    c_cod_int_os: string | null;
    numero_os: string | null;
    criacao_status: string | null;
    criacao_erro: string | null;
    forma_faturamento: string;
    n_dia_fat: number | null;
    contrato_acao: string | null;
    contrato_valor_atual: string | null;
  }>(sql`
    select id, linha_planilha, cliente, cnpj, descricao, cod_recorrente,
           valor_total::text, numero_contrato, n_cod_ctr, desc_excedente,
           n_cod_serv, categoria, venc_final::text, regra_venc, email_envio,
           status, avisos, excecao_motivo, c_cod_int_os, numero_os,
           criacao_status, criacao_erro,
           forma_faturamento, n_dia_fat, contrato_acao, contrato_valor_atual::text
    from public.excedentes_linha
    where lote_id = ${lote.id}
    order by linha_planilha
  `);

  base.linhas = linhas.map((l) => ({
    id: Number(l.id),
    linhaPlanilha: l.linha_planilha,
    cliente: l.cliente,
    cnpj: l.cnpj,
    descricao: l.descricao,
    codRecorrente: l.cod_recorrente,
    valorTotal: l.valor_total,
    numeroContrato: l.numero_contrato,
    nCodCtr: l.n_cod_ctr == null ? null : Number(l.n_cod_ctr),
    descExcedente: l.desc_excedente,
    nCodServ: l.n_cod_serv == null ? null : Number(l.n_cod_serv),
    categoria: l.categoria,
    vencFinal: l.venc_final,
    regraVenc: l.regra_venc,
    emailEnvio: l.email_envio,
    status: l.status,
    avisos: l.avisos ?? [],
    excecaoMotivo: l.excecao_motivo,
    codigoIntOs: l.c_cod_int_os,
    numeroOs: l.numero_os,
    criacaoStatus: l.criacao_status,
    criacaoErro: l.criacao_erro,
    formaFaturamento: l.forma_faturamento,
    nDiaFat: l.n_dia_fat == null ? null : Number(l.n_dia_fat),
    contratoAcao: l.contrato_acao,
    contratoValorAtual: l.contrato_valor_atual,
  }));
  return base;
}

/* -------------------------------- exceções ------------------------------- */

export type ResultadoSimples = { erro?: string; ok?: boolean };

/**
 * Resolve uma exceção. Três decisões possíveis do analista:
 *  - escolherServico: define o serviço excedente da linha (e opcionalmente
 *    grava/atualiza o De/Para para os próximos meses);
 *  - criarSemContrato: confirma criar a OS sem vínculo de contrato
 *    (cCodIntOS vira EXC-AAAAMM-<cnpj só dígitos>; vencimento hoje+3 dias
 *    úteis e e-mail do cadastro do cliente, aplicados na criação);
 *  - ignorar: a linha fica fora da criação, só no relatório.
 */
export async function resolverExcecao(
  empresaId: string,
  linhaId: number,
  decisao:
    | { tipo: "ignorar" }
    | { tipo: "criar_sem_contrato" }
    | {
        tipo: "escolher_servico";
        nCodServ: number;
        codExcedente?: string;
        descricao?: string;
        categoria?: string;
        gravarDePara?: boolean;
        criarSemContrato?: boolean;
      },
): Promise<ResultadoSimples> {
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão." };
  }
  const { email } = await verificarSessao();

  const linhas = await db.execute<{
    id: number;
    lote_id: number;
    status: string;
    cnpj: string | null;
    cod_recorrente: string | null;
    descricao: string | null;
    n_cod_cli: number | null;
    n_cod_ctr: number | null;
    n_cod_serv: number | null;
    competencia: string;
    lote_status: string;
  }>(sql`
    select l.id, l.lote_id, l.status, l.cnpj, l.cod_recorrente, l.descricao,
           l.n_cod_cli, l.n_cod_ctr, l.n_cod_serv,
           lote.competencia, lote.status as lote_status
    from public.excedentes_linha l
    join public.excedentes_lote lote on lote.id = l.lote_id
    where l.id = ${linhaId} and l.empresa_id = ${empresaId}::uuid
  `);
  const linha = linhas[0];
  if (!linha) return { erro: "Linha não encontrada." };
  if (linha.lote_status !== "aguardando_aprovacao") {
    return { erro: "O lote não está mais aguardando aprovação." };
  }
  if (!["excecao", "resolvida", "ignorada"].includes(linha.status)) {
    return { erro: "Esta linha não é uma exceção." };
  }

  if (decisao.tipo === "ignorar") {
    await db.execute(sql`
      update public.excedentes_linha
      set status = 'ignorada', resolucao = ${JSON.stringify({ tipo: "ignorar" })}::jsonb,
          resolvida_por = ${email}, resolvida_em = now()
      where id = ${linhaId}
    `);
    return { ok: true };
  }

  const cnpjDigitos = (linha.cnpj ?? "").replace(/\D/g, "");

  if (decisao.tipo === "criar_sem_contrato") {
    if (!linha.n_cod_cli) {
      return { erro: "Cliente não identificado no Omie — não dá para criar a OS." };
    }
    if (!linha.n_cod_serv) {
      return { erro: "Escolha antes o serviço excedente desta linha." };
    }
    await db.execute(sql`
      update public.excedentes_linha
      set status = 'resolvida',
          numero_contrato = null, n_cod_ctr = null,
          c_cod_int_os = ${"EXC-" + linha.competencia + "-" + cnpjDigitos},
          resolucao = ${JSON.stringify({ tipo: "criar_sem_contrato" })}::jsonb,
          resolvida_por = ${email}, resolvida_em = now()
      where id = ${linhaId}
    `);
    return { ok: true };
  }

  // escolher_servico
  if (!decisao.nCodServ) return { erro: "Informe o serviço excedente (nCodServ)." };
  const semContrato = decisao.criarSemContrato === true;
  if (semContrato && !linha.n_cod_cli) {
    return { erro: "Cliente não identificado no Omie — não dá para criar a OS." };
  }
  if (!semContrato && !linha.n_cod_ctr) {
    return {
      erro:
        "Esta linha não tem contrato identificado — escolha também " +
        "“criar sem contrato” ou deixe-a como exceção.",
    };
  }
  const codigo = semContrato
    ? "EXC-" + linha.competencia + "-" + cnpjDigitos
    : null; // com contrato, o cCodIntOS já foi definido no plano

  await db.execute(sql`
    update public.excedentes_linha
    set status = 'resolvida',
        n_cod_serv = ${decisao.nCodServ},
        cod_excedente = coalesce(${decisao.codExcedente ?? null}, cod_excedente),
        desc_excedente = coalesce(${decisao.descricao ?? null}, desc_excedente),
        categoria = coalesce(${decisao.categoria ?? null}, categoria),
        numero_contrato = case when ${semContrato} then null else numero_contrato end,
        n_cod_ctr = case when ${semContrato} then null else n_cod_ctr end,
        c_cod_int_os = coalesce(${codigo}, c_cod_int_os),
        resolucao = ${JSON.stringify({ ...decisao })}::jsonb,
        resolvida_por = ${email}, resolvida_em = now()
    where id = ${linhaId}
  `);

  if (decisao.gravarDePara && linha.cod_recorrente) {
    await salvarDeParaInterno(empresaId, email, {
      codRecorrente: linha.cod_recorrente,
      descricaoRecorrente: linha.descricao ?? undefined,
      codExcedente: decisao.codExcedente,
      descricaoExcedente: decisao.descricao,
      nCodServExcedente: decisao.nCodServ,
      categoriaExcedente: decisao.categoria,
      status: "confirmado",
      origem: "resolvido na fila de exceções",
    });
  }
  return { ok: true };
}

/* -------------------------------- aprovação ------------------------------ */

export async function aprovarCriacao(
  empresaId: string,
  loteId: number,
): Promise<ResultadoSimples> {
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão para aprovar a criação de OSs." };
  }
  const { email } = await verificarSessao();

  const atualizadas = await db.execute<{ id: number }>(sql`
    update public.excedentes_lote
    set status = 'aprovado', aprovado_por = ${email}, aprovado_em = now()
    where id = ${loteId} and empresa_id = ${empresaId}::uuid
      and status = 'aguardando_aprovacao'
    returning id
  `);
  if (atualizadas.length === 0) {
    return { erro: "O lote precisa estar aguardando aprovação." };
  }
  return { ok: true };
}

/* --------------------------------- De/Para ------------------------------- */

export type DeParaItem = {
  id: number;
  codRecorrente: string;
  descricaoRecorrente: string | null;
  codExcedente: string | null;
  descricaoExcedente: string | null;
  nCodServExcedente: number | null;
  categoriaExcedente: string | null;
  origem: string | null;
  status: string;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
};

export async function listarDePara(empresaId: string): Promise<{
  erro?: string;
  itens?: DeParaItem[];
}> {
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão." };
  }
  const itens = await db.execute<{
    id: number;
    cod_recorrente: string;
    descricao_recorrente: string | null;
    cod_excedente: string | null;
    descricao_excedente: string | null;
    n_cod_serv_excedente: number | null;
    categoria_excedente: string | null;
    origem: string | null;
    status: string;
    atualizado_por: string | null;
    atualizado_em: string | null;
  }>(sql`
    select id, cod_recorrente, descricao_recorrente, cod_excedente,
           descricao_excedente, n_cod_serv_excedente, categoria_excedente,
           origem, status, atualizado_por, atualizado_em::text
    from public.excedentes_de_para
    where empresa_id = ${empresaId}::uuid
    order by cod_recorrente
  `);
  return {
    itens: itens.map((i) => ({
      id: Number(i.id),
      codRecorrente: i.cod_recorrente,
      descricaoRecorrente: i.descricao_recorrente,
      codExcedente: i.cod_excedente,
      descricaoExcedente: i.descricao_excedente,
      nCodServExcedente:
        i.n_cod_serv_excedente == null ? null : Number(i.n_cod_serv_excedente),
      categoriaExcedente: i.categoria_excedente,
      origem: i.origem,
      status: i.status,
      atualizadoPor: i.atualizado_por,
      atualizadoEm: i.atualizado_em,
    })),
  };
}

type DeParaEntrada = {
  codRecorrente: string;
  descricaoRecorrente?: string;
  codExcedente?: string;
  descricaoExcedente?: string;
  nCodServExcedente?: number;
  categoriaExcedente?: string;
  status?: string;
  origem?: string;
};

async function salvarDeParaInterno(
  empresaId: string,
  email: string,
  entrada: DeParaEntrada,
): Promise<void> {
  const anteriores = await db.execute<Record<string, unknown>>(sql`
    select id, cod_recorrente, descricao_recorrente, cod_excedente,
           descricao_excedente, n_cod_serv_excedente, categoria_excedente, status
    from public.excedentes_de_para
    where empresa_id = ${empresaId}::uuid and cod_recorrente = ${entrada.codRecorrente}
  `);
  const antes = anteriores[0] ?? null;

  const salvas = await db.execute<{ id: number }>(sql`
    insert into public.excedentes_de_para
      (empresa_id, cod_recorrente, descricao_recorrente, cod_excedente,
       descricao_excedente, n_cod_serv_excedente, categoria_excedente,
       origem, status, atualizado_por, atualizado_em)
    values
      (${empresaId}::uuid, ${entrada.codRecorrente},
       ${entrada.descricaoRecorrente ?? null}, ${entrada.codExcedente ?? null},
       ${entrada.descricaoExcedente ?? null}, ${entrada.nCodServExcedente ?? null},
       ${entrada.categoriaExcedente ?? null}, ${entrada.origem ?? null},
       ${entrada.status ?? "confirmado"}, ${email}, now())
    on conflict (empresa_id, cod_recorrente) do update set
      descricao_recorrente = coalesce(excluded.descricao_recorrente, excedentes_de_para.descricao_recorrente),
      cod_excedente = excluded.cod_excedente,
      descricao_excedente = excluded.descricao_excedente,
      n_cod_serv_excedente = excluded.n_cod_serv_excedente,
      categoria_excedente = excluded.categoria_excedente,
      origem = coalesce(excluded.origem, excedentes_de_para.origem),
      status = excluded.status,
      atualizado_por = excluded.atualizado_por,
      atualizado_em = now()
    returning id
  `);

  await db.execute(sql`
    insert into public.excedentes_de_para_hist
      (de_para_id, empresa_id, alterado_por, antes, depois)
    values (${salvas[0].id}, ${empresaId}::uuid, ${email},
            ${antes ? JSON.stringify(antes) : null}::jsonb,
            ${JSON.stringify(entrada)}::jsonb)
  `);
}

export async function salvarDePara(
  empresaId: string,
  entrada: DeParaEntrada,
): Promise<ResultadoSimples> {
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão para editar o De/Para." };
  }
  if (!entrada.codRecorrente?.trim()) {
    return { erro: "Informe o código do serviço recorrente." };
  }
  const { email } = await verificarSessao();
  await salvarDeParaInterno(empresaId, email, {
    ...entrada,
    codRecorrente: entrada.codRecorrente.trim(),
  });
  return { ok: true };
}
