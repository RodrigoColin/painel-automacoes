"use server";

/**
 * Conciliação Bancária: sobe um extrato OFX e roda o processamento local
 * (Python, proos-omie-mcp) em duas camadas —
 *
 * 1. `executarConciliacaoSimples` — só confirma que o extrato foi lido
 *    (linhas, período, movimento) e, se a empresa tiver um cliente Omie
 *    vinculado, mostra qual é. Sempre funciona, mesmo sem título nenhum.
 * 2. `executarConciliacaoCompleta` — roda o motor de verdade (título a
 *    título, automático/revisão/exceção). Só funciona se a empresa tiver
 *    cliente vinculado E esse cliente já tiver um titulos.json exportado
 *    (scripts/exportar_base_sombra.py) — sem isso, devolve um erro
 *    explicando o que falta, nunca um resultado parcial/enganoso.
 *
 * As duas SEMPRE leitura — nunca gravam nada no Omie. `--gravar` continua
 * exclusivo de scripts/conciliar.py, rodado manualmente pelo operador.
 *
 * SÓ FUNCIONA RODANDO O PORTAL PROOS LOCALMENTE ("next dev"), na mesma
 * máquina que tem o repo proos-omie-mcp com o venv já criado — chama o
 * Python via subprocess no disco local. Decisão explícita do usuário
 * (2026-09-22): o n8n é hospedado fora e não alcança esse Python local, e
 * montar um túnel/hospedar o motor em algum lugar público fica pra depois
 * — por ora, é só isso.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exigirPermissaoDeEscrita, verificarSessao } from "@/lib/dal";
import { EXTENSOES_OFX_ACEITAS, TAMANHO_MAXIMO_OFX } from "@/lib/conciliacao-bancaria";

const execFileAsync = promisify(execFile);

export type ResumoExtrato = {
  linhas: number;
  periodoInicio: string;
  periodoFim: string;
  movimentoLiquido: string;
  bancoDetectado: string | null;
  clienteSlug: string | null;
  clienteNome: string | null;
};

export type ResultadoConciliacaoSimples = { erro?: string; resumo?: ResumoExtrato };

type CandidatoDescartado = {
  tituloId: string;
  parceiro: string;
  valor: string;
  vencimento: string;
  score: number;
};

export type ResultadoLinha = {
  linhaId: string;
  data: string;
  valor: string;
  descricao: string;
  desfecho: string;
  faixa: string;
  score: number;
  tituloId: string | null;
  tituloParceiro: string | null;
  tituloValor: string | null;
  tituloVencimento: string | null;
  diferenca: string | null;
  categoria: string | null;
  tipoExcecao: string | null;
  motivo: string;
  // candidatos avaliados e rejeitados pelo motor — o material de que a
  // busca de "ambiguidade" precisa pra oferecer escolha em vez de só o
  // vencedor (ver ModalDecisaoLinha).
  descartados: CandidatoDescartado[];
};

export type TituloResumo = {
  id: string;
  tipo: "CP" | "CR";
  parceiroNome: string;
  valor: string;
  vencimento: string;
  numeroDocumento: string | null;
};

export type ResumoConciliacaoCompleta = {
  clienteSlug: string;
  clienteNome: string;
  contaOmie: string;
  contaOmieResolvidaAutomaticamente: boolean;
  titulosArquivo: string;
  titulosAtualizados: boolean;
  // quantas regras aprendidas com decisões anteriores o motor já carregou
  // nesta rodada — feedback de que o loop de aprendizado fechou de verdade
  // (ver scripts/decidir_linha_conciliacao.py), não só um número no JSON.
  regrasCarregadas: number;
  titulosCarregados: TituloResumo[];
  total: number;
  automatico: number;
  revisao: number;
  excecao: number;
  porDesfecho: Record<string, number>;
  porExcecao: Record<string, number>;
  linhas: ResultadoLinha[];
};

export type ResultadoConciliacaoCompleta = { erro?: string; resumo?: ResumoConciliacaoCompleta };

// Caminho do repo proos-omie-mcp e do python do venv dele — configuráveis
// por variável de ambiente porque são específicos da máquina de quem roda
// o painel localmente; o padrão assume o layout desta sessão (as duas
// pastas lado a lado, dentro de "Portal Proos").
const DIR_PROOS_OMIE_MCP =
  process.env.PROOS_OMIE_MCP_DIR ?? path.resolve(process.cwd(), "..", "proos-omie-mcp");
const PYTHON_PROOS_OMIE_MCP =
  process.env.PROOS_OMIE_MCP_PYTHON ??
  path.join(DIR_PROOS_OMIE_MCP, ".venv", "Scripts", "python.exe");

type ResultadoScript = { erro?: string; bruto?: Record<string, unknown> };

/**
 * Roda um script do proos-omie-mcp e devolve o JSON bruto da última linha
 * do stdout (sucesso ou `{"erro": "..."}`) — o mecanismo genérico por trás
 * de toda ação deste módulo. `entradaStdin`, quando informado, é escrito no
 * stdin do processo e fechado em seguida (contrato usado por
 * `decidirLinhaConciliacao`, que não tem arquivo nenhum pra subir).
 */
async function executarPython(
  nomeScript: string,
  argsExtras: string[],
  opcoes: { timeoutMs?: number; entradaStdin?: string } = {},
): Promise<ResultadoScript> {
  try {
    const promessa = execFileAsync(
      PYTHON_PROOS_OMIE_MCP,
      [nomeScript, ...argsExtras],
      {
        cwd: DIR_PROOS_OMIE_MCP,
        timeout: opcoes.timeoutMs ?? 30_000,
        // Sem isso, o venv python falha ao iniciar com STATUS_DLL_INIT_FAILED
        // (0xC0000142) — achado real: o runtime de Server Actions do
        // Next.js/Turbopack não repassa o ambiente completo por padrão
        // (faltando SystemRoot/PATH etc. que o launcher do venv precisa pra
        // achar as DLLs do Python base), 2026-09-22.
        env: process.env,
      },
    );
    // `execFile` promisificado expõe o ChildProcess na própria promise (API
    // documentada do node:util) — é a única forma de escrever no stdin
    // antes do processo terminar, já que `execFileAsync` só resolve no fim.
    if (opcoes.entradaStdin !== undefined) {
      const filho = (promessa as unknown as { child: import("node:child_process").ChildProcess }).child;
      filho.stdin?.end(opcoes.entradaStdin, "utf-8");
    }

    let stdout: string;
    try {
      ({ stdout } = await promessa);
    } catch (erroExec) {
      // O script sai com exit code != 0 tanto pra erro de infra (python não
      // encontrado) quanto pra erro esperado (que ele já reporta como
      // {"erro": "..."} no stdout) — o Node trata os dois igual (rejeita a
      // promise), mas só o segundo tem uma mensagem legível pro operador.
      // `stdout`/`stderr` vêm anexados no próprio erro do Node.
      const comSaida = erroExec as { stdout?: string; stderr?: string };
      const ultimaLinha = comSaida.stdout?.trim().split("\n").pop();
      if (ultimaLinha) {
        try {
          const bruto = JSON.parse(ultimaLinha) as Record<string, unknown>;
          if (typeof bruto.erro === "string") return { erro: bruto.erro };
        } catch {
          // não era o JSON esperado — cai no erro genérico abaixo
        }
      }
      throw erroExec;
    }

    const ultimaLinha = stdout.trim().split("\n").pop() ?? "{}";
    const bruto = JSON.parse(ultimaLinha) as Record<string, unknown>;
    if (typeof bruto.erro === "string") return { erro: bruto.erro };
    return { bruto };
  } catch (erro) {
    const comSaida = erro as { message?: string; stderr?: string };
    return {
      erro:
        `Não foi possível rodar o processamento local — o Portal Proos precisa ` +
        `estar rodando na mesma máquina que tem o proos-omie-mcp (com o venv ` +
        `pronto em .venv). Detalhe: ${comSaida.stderr?.trim() || comSaida.message || String(erro)}`,
    };
  }
}

/**
 * Escreve o arquivo enviado num temp dir e roda um script contra ele — wrapper
 * de `executarPython` pras duas ações que sobem um extrato. Sempre limpa o
 * temp dir, mesmo em erro.
 */
async function rodarScriptPython(
  nomeScript: string,
  argsExtras: string[],
  arquivo: File,
  timeoutMs = 30_000,
): Promise<ResultadoScript> {
  const dirTemp = await mkdtemp(path.join(tmpdir(), "extrato-"));
  // Sem caracteres do nome original que possam confundir o shell/subprocesso.
  const nomeSeguro = arquivo.name.replace(/[^\w.\-]/g, "_");
  const caminhoArquivo = path.join(dirTemp, nomeSeguro);

  try {
    await writeFile(caminhoArquivo, Buffer.from(await arquivo.arrayBuffer()));
    return await executarPython(
      nomeScript,
      ["--arquivo", caminhoArquivo, ...argsExtras],
      { timeoutMs },
    );
  } finally {
    await rm(dirTemp, { recursive: true, force: true }).catch(() => {});
  }
}

function validarArquivo(dados: FormData): { erro?: string; arquivo?: File } {
  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha um arquivo de extrato (.ofx)." };
  }
  if (!EXTENSOES_OFX_ACEITAS.some((ext) => arquivo.name.toLowerCase().endsWith(ext))) {
    return { erro: "Use um arquivo .ofx." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_OFX) {
    return { erro: "O arquivo passa do limite de 10 MB." };
  }
  return { arquivo };
}

export async function executarConciliacaoSimples(
  dados: FormData,
): Promise<ResultadoConciliacaoSimples> {
  const empresaId = String(dados.get("empresaId") ?? "");

  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão para executar a conciliação desta empresa." };
  }

  const validado = validarArquivo(dados);
  if (validado.erro || !validado.arquivo) return { erro: validado.erro };

  const { erro, bruto } = await rodarScriptPython(
    "scripts/processar_extrato_simples.py",
    ["--empresa-id", empresaId],
    validado.arquivo,
  );
  if (erro || !bruto) return { erro };

  return {
    resumo: {
      linhas: bruto.linhas as number,
      periodoInicio: bruto.periodo_inicio as string,
      periodoFim: bruto.periodo_fim as string,
      movimentoLiquido: bruto.movimento_liquido as string,
      bancoDetectado: bruto.banco_detectado as string | null,
      clienteSlug: bruto.cliente_slug as string | null,
      clienteNome: bruto.cliente_nome as string | null,
    },
  };
}

export async function executarConciliacaoCompleta(
  dados: FormData,
): Promise<ResultadoConciliacaoCompleta> {
  const empresaId = String(dados.get("empresaId") ?? "");

  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão para executar a conciliação desta empresa." };
  }

  const validado = validarArquivo(dados);
  if (validado.erro || !validado.arquivo) return { erro: validado.erro };

  // Opcional: sem isso, o script tenta resolver sozinho pelo ACCTID do
  // extrato (ver conciliar_extrato_painel.py) — só pede o nCodCC na mão
  // quando essa resolução automática falha (extrato sem ACCTID, ou 2+
  // contas candidatas no Omie).
  const contaOmie = String(dados.get("contaOmie") ?? "").trim();
  const atualizarTitulos = dados.get("atualizarTitulos") === "true";

  const { erro, bruto } = await rodarScriptPython(
    "scripts/conciliar_extrato_painel.py",
    [
      "--empresa-id", empresaId,
      ...(contaOmie ? ["--conta-omie", contaOmie] : []),
      ...(atualizarTitulos ? ["--atualizar-titulos"] : []),
    ],
    validado.arquivo,
    // Com --atualizar-titulos, busca ao vivo na Omie (varias chamadas
    // paginadas) — achado real: um rate limit da Omie sozinho já esperou
    // 60s antes de tentar de novo. 30s (padrão) mataria a chamada no meio.
    atualizarTitulos ? 180_000 : 30_000,
  );
  if (erro || !bruto) return { erro };

  const porDesfecho: Record<string, number> = {};
  const porExcecao: Record<string, number> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (typeof valor !== "number") continue;
    if (chave.startsWith("desfecho_")) porDesfecho[chave.slice("desfecho_".length)] = valor;
    if (chave.startsWith("excecao_")) porExcecao[chave.slice("excecao_".length)] = valor;
  }

  const linhasBrutas = Array.isArray(bruto.resultados) ? bruto.resultados : [];
  const linhas: ResultadoLinha[] = linhasBrutas.map((l) => {
    const r = l as Record<string, unknown>;
    return {
      linhaId: r.linha_id as string,
      data: r.data as string,
      valor: r.valor as string,
      descricao: r.descricao as string,
      desfecho: r.desfecho as string,
      faixa: r.faixa as string,
      score: (r.score as number) ?? 0,
      tituloId: r.titulo_id as string | null,
      tituloParceiro: r.titulo_parceiro as string | null,
      tituloValor: r.titulo_valor as string | null,
      tituloVencimento: r.titulo_vencimento as string | null,
      diferenca: r.diferenca as string | null,
      categoria: r.categoria as string | null,
      tipoExcecao: r.tipo_excecao as string | null,
      motivo: (r.motivo as string) ?? "",
      descartados: (Array.isArray(r.descartados) ? r.descartados : []).map((d) => {
        const c = d as Record<string, unknown>;
        return {
          tituloId: c.titulo_id as string,
          parceiro: c.parceiro as string,
          valor: c.valor as string,
          vencimento: c.vencimento as string,
          score: (c.score as number) ?? 0,
        };
      }),
    };
  });

  const titulosCarregados: TituloResumo[] = (
    Array.isArray(bruto.titulos_carregados) ? bruto.titulos_carregados : []
  ).map((t) => {
    const item = t as Record<string, unknown>;
    return {
      id: item.id as string,
      tipo: item.tipo as "CP" | "CR",
      parceiroNome: item.parceiro_nome as string,
      valor: item.valor as string,
      vencimento: item.vencimento as string,
      numeroDocumento: item.numero_documento as string | null,
    };
  });

  return {
    resumo: {
      clienteSlug: bruto.cliente_slug as string,
      clienteNome: bruto.cliente_nome as string,
      contaOmie: bruto.conta_omie as string,
      contaOmieResolvidaAutomaticamente: bruto.conta_omie_resolvida_automaticamente === true,
      titulosArquivo: bruto.titulos_arquivo as string,
      titulosAtualizados: bruto.titulos_atualizados === true,
      regrasCarregadas: (bruto.regras_carregadas as number) ?? 0,
      titulosCarregados,
      total: (bruto.total as number) ?? 0,
      automatico: (bruto.faixa_automatico as number) ?? 0,
      revisao: (bruto.faixa_revisao as number) ?? 0,
      excecao: (bruto.faixa_excecao as number) ?? 0,
      porDesfecho,
      porExcecao,
      linhas,
    },
  };
}

export type PayloadDecisaoLinha = {
  linha: { linhaId: string; contaId: string; data: string; valor: string; descricao: string };
  sugestaoMotor: {
    desfecho: string;
    faixa: string;
    score: number;
    tituloId: string | null;
    tipoExcecao: string | null;
  } | null;
  decisao: {
    desfecho: "titulo" | "lanc_direto" | "transferencia";
    tituloId?: string | null;
    categoria?: string | null;
    parceiroId?: string | null;
    contaDestinoId?: string | null;
    observacao?: string | null;
  };
};

export type ResultadoDecisaoLinha = {
  erro?: string;
  aprendeu?: boolean;
  regra?: { padrao: string; desfecho: string; confirmacoes: number } | null;
};

/**
 * Registra a decisão do operador sobre uma linha da fila — chamada uma vez
 * por decisão (um clique = uma chamada), nunca em lote. Fecha o loop de
 * aprendizado: a decisão vira (ou reforça) uma regra do cliente em
 * `sombra/{slug}/regras.json`, que a PRÓXIMA rodada de
 * `executarConciliacaoCompleta` já carrega sozinha — ver `regrasCarregadas`
 * no resumo. NUNCA escreve no Omie (ver aviso do módulo).
 */
export async function decidirLinhaConciliacao(
  empresaId: string,
  payload: PayloadDecisaoLinha,
): Promise<ResultadoDecisaoLinha> {
  try {
    await exigirPermissaoDeEscrita(empresaId);
  } catch {
    return { erro: "Sem permissão para decidir linhas desta empresa." };
  }

  const { email } = await verificarSessao();

  const entradaStdin = JSON.stringify({
    linha: {
      linha_id: payload.linha.linhaId,
      conta_id: payload.linha.contaId,
      data: payload.linha.data,
      valor: payload.linha.valor,
      descricao: payload.linha.descricao,
    },
    sugestao_motor: payload.sugestaoMotor
      ? {
          desfecho: payload.sugestaoMotor.desfecho,
          faixa: payload.sugestaoMotor.faixa,
          score: payload.sugestaoMotor.score,
          titulo_id: payload.sugestaoMotor.tituloId,
          tipo_excecao: payload.sugestaoMotor.tipoExcecao,
        }
      : null,
    decisao: {
      desfecho: payload.decisao.desfecho,
      titulo_id: payload.decisao.tituloId ?? null,
      categoria: payload.decisao.categoria ?? null,
      parceiro_id: payload.decisao.parceiroId ?? null,
      conta_destino_id: payload.decisao.contaDestinoId ?? null,
      observacao: payload.decisao.observacao ?? null,
    },
  });

  const { erro, bruto } = await executarPython(
    "scripts/decidir_linha_conciliacao.py",
    ["--empresa-id", empresaId, "--quem", email],
    { entradaStdin, timeoutMs: 15_000 },
  );
  if (erro || !bruto) return { erro };

  return {
    aprendeu: bruto.aprendeu === true,
    regra: (bruto.regra as ResultadoDecisaoLinha["regra"]) ?? null,
  };
}
