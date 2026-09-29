/**
 * Contas correntes do Omie e as marcações da Proos, para o bloco de
 * configuração da tela "Fluxo de caixa".
 *
 * A lista de contas fica no cache do banco (24 h, renovado às 10h e 16h).
 * O fluxo em si não é montado aqui: o container `caixa` (proos-omie-mcp/caixa)
 * lê o Omie às 10h e às 16h e grava o pacote que a tela mostra. A regra de
 * padrão de cada conta abaixo é a mesma de lá (caixa/contas.py) — mudou uma,
 * mude a outra.
 *
 * Regras da Proos: conta garantida é dívida, não caixa — fica fora do caixa
 * próprio e aparece como limite; aplicação só soma no caixa quando marcada com
 * liquidez imediata; conta corrente pode ter limite (cheque especial); o saldo
 * mínimo é definido pela Proos.
 */

import { eq } from "drizzle-orm";
import { chamarOmie, ehBloqueioTemporario, ehListaVazia, type CredenciaisOmie } from "@/lib/omie/cliente";
import { credenciaisDaEmpresa } from "@/lib/omie/resumo";
import { comCache, idadeMs, lerCache, VALIDADE_CACHE_MS } from "@/lib/cache-externo";
import type { Executor } from "@/lib/db";
import { naSessao } from "@/lib/dal";
import { fluxoCaixaConfig } from "@/lib/db/schema";
import type { TipoConta } from "@/lib/fluxo-caixa/tipos";

export type { TipoConta };

/** Marcação de uma conta, feita pela Proos na implantação. */
export type ConfigConta = {
  entra: boolean;
  tipo: TipoConta;
  /** Só para aplicação: soma no caixa próprio. */
  liquidezImediata: boolean;
  /** Cheque especial da conta corrente ou limite da conta garantida. */
  limite: number;
};

/** Contas do Omie com a marcação vigente, para a tela de configuração. */
export type ContaParaConfigurar = ConfigConta & { codigo: number; descricao: string };

type ContaOmie = {
  nCodCC: number;
  descricao?: string;
  tipo?: string;
  tipo_conta_corrente?: string;
  inativo?: string;
  nao_fluxo?: string;
  nao_resumo?: string;
  valor_limite?: number;
};

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

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

async function lerMarcacoes(empresaId: string): Promise<Record<string, Partial<ConfigConta>>> {
  try {
    const [linha] = await naSessao((tx) =>
      tx.select({ contas: fluxoCaixaConfig.contas }).from(fluxoCaixaConfig).where(eq(fluxoCaixaConfig.empresa_id, empresaId)).limit(1),
    );
    return (linha?.contas ?? {}) as Record<string, Partial<ConfigConta>>;
  } catch {
    return {};
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

/**
 * Contas correntes do Omie, do cache (`cache_externo`, 24 h, renovado às 10h e
 * 16h). `banco` = `db` quando não há sessão (cron).
 */
export async function contasOmie(
  empresaId: string,
  { forcar = false, banco }: { forcar?: boolean; banco?: Executor } = {},
): Promise<ContaOmie[]> {
  if (!forcar) {
    const guardado = await lerCache<ContaOmie[]>(empresaId, "omie:contas");
    if (guardado && idadeMs(guardado.em) < VALIDADE_CACHE_MS) return guardado.valor;
  }
  const acesso = await credenciaisDaEmpresa(empresaId, banco);
  if (acesso.estado !== "ok") return [];
  const { valor } = await comCache(empresaId, "omie:contas", () => listarContas(acesso.credenciais), { forcar: true });
  return valor;
}

/** Todas as contas ativas do Omie, inclusive as que ficam fora, para a Proos marcar. */
export async function contasParaConfigurar(empresaId: string): Promise<ContaParaConfigurar[]> {
  const [contas, marcacoes] = await Promise.all([contasOmie(empresaId), lerMarcacoes(empresaId)]);
  return contas
    .filter((conta) => (conta.inativo ?? "N") === "N")
    .map((conta) => {
      const padrao = configPadrao(conta);
      const marcada = marcacoes[String(conta.nCodCC)] ?? {};
      return {
        ...padrao,
        ...marcada,
        // Limite gravado como 0 (campo vazio) cai no que o Omie informa, como no pipeline.
        limite: Number(marcada.limite) || padrao.limite,
        codigo: conta.nCodCC,
        descricao: limparNome(conta.descricao) || String(conta.nCodCC),
      };
    });
}
