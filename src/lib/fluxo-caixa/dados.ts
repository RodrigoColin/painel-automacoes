/**
 * Leitura do fluxo de caixa gravado pelo container `caixa` e fila das rodadas.
 *
 * A tela não consulta o Omie: lê o pacote mais recente de
 * `caixa_pacote_diario` (atualizado às 10h e às 16h, ou pelo botão). As
 * leituras passam pela sessão, com o RLS valendo; só `enfileirarRodadas` usa
 * a conexão do app, porque o cron não tem sessão.
 */

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  caixaExecucao,
  caixaPacoteDiario,
  fluxoCaixaConfig,
  omieCategorias,
  recorrenciaConfig,
} from "@/lib/db/schema";
import { naSessao } from "@/lib/dal";
import type {
  Checagem,
  ExecucaoCaixa,
  Extra,
  Extrato,
  LinhaReceita,
  PacoteFluxoCaixa,
} from "@/lib/fluxo-caixa/tipos";

export async function obterPacoteFluxoCaixa(empresaId: string): Promise<PacoteFluxoCaixa | null> {
  const [linha] = await naSessao((tx) =>
    tx
      .select({
        data: caixaPacoteDiario.data,
        atualizado_em: caixaPacoteDiario.atualizado_em,
        extrato: caixaPacoteDiario.extrato,
        extra: caixaPacoteDiario.extra,
        checagem: caixaPacoteDiario.checagem,
      })
      .from(caixaPacoteDiario)
      .where(eq(caixaPacoteDiario.empresa_id, empresaId))
      .orderBy(desc(caixaPacoteDiario.data))
      .limit(1),
  );
  if (!linha?.extrato || !linha.extra) return null;
  return {
    data: linha.data,
    atualizadoEm: linha.atualizado_em,
    extrato: linha.extrato as Extrato,
    extra: linha.extra as Extra,
    checagem: (linha.checagem as Checagem | null) ?? null,
  };
}

export async function ultimasExecucoes(empresaId: string, quantas = 5): Promise<ExecucaoCaixa[]> {
  const linhas = await naSessao((tx) =>
    tx
      .select()
      .from(caixaExecucao)
      .where(eq(caixaExecucao.empresa_id, empresaId))
      .orderBy(desc(caixaExecucao.id))
      .limit(quantas),
  );
  return linhas.map((l) => ({
    id: l.id,
    origem: l.origem,
    status: l.status,
    etapa: l.etapa,
    criadaEm: l.criada_em,
    iniciadaEm: l.iniciada_em,
    concluidaEm: l.concluida_em,
    avisos: l.avisos ?? [],
    erro: l.erro,
  }));
}

export type ConfigVisual = {
  saldoMinimo: number | null;
  categoriasGrupo: Record<string, string>;
  linhasReceita: LinhaReceita[];
};

export async function configVisual(empresaId: string): Promise<ConfigVisual> {
  const [[linha], [rec], categorias] = await naSessao((tx) =>
    Promise.all([
      tx
        .select({
          saldo_minimo: fluxoCaixaConfig.saldo_minimo,
          categorias_grupo: fluxoCaixaConfig.categorias_grupo,
          linhas_receita: fluxoCaixaConfig.linhas_receita,
        })
        .from(fluxoCaixaConfig)
        .where(eq(fluxoCaixaConfig.empresa_id, empresaId))
        .limit(1),
      // Mesma fonte de "o que é recorrente" da tela de Gestão de Receitas
      // (recorrencia_config, por código). Aqui vira grupo "rec" (Receita
      // recorrente) por nome, para o fluxo de caixa agrupar igual.
      tx
        .select({ categoria_codigos: recorrenciaConfig.categoria_codigos })
        .from(recorrenciaConfig)
        .where(eq(recorrenciaConfig.empresa_id, empresaId))
        .limit(1),
      tx
        .select({ codigo: omieCategorias.codigo, descricao: omieCategorias.descricao })
        .from(omieCategorias)
        .where(eq(omieCategorias.empresa_id, empresaId)),
    ]),
  );

  // Categorias marcadas como recorrentes → grupo "Receita recorrente", mapeadas
  // por nome (o fluxo de caixa agrupa por nome). O ajuste manual por empresa
  // (categorias_grupo) tem precedência; depois vale a marcação de recorrência;
  // e, por último, a regex de nome em grupos.ts.
  const codigosRecorrentes = new Set(rec?.categoria_codigos ?? []);
  const recorrentesPorNome: Record<string, string> = {};
  if (codigosRecorrentes.size > 0) {
    for (const c of categorias) {
      if (codigosRecorrentes.has(c.codigo)) recorrentesPorNome[c.descricao] = "rec";
    }
  }

  return {
    saldoMinimo: linha?.saldo_minimo ?? null,
    categoriasGrupo: { ...recorrentesPorNome, ...(linha?.categorias_grupo ?? {}) },
    linhasReceita: linha?.linhas_receita ?? [],
  };
}

/**
 * Põe uma rodada na fila para cada empresa, pulando quem já tem uma na fila ou
 * rodando. Devolve quantas entraram. Quem chama já conferiu a autorização.
 */
export async function enfileirarRodadas(
  empresaIds: string[],
  origem: "agendado" | "manual",
): Promise<number> {
  if (empresaIds.length === 0) return 0;
  const inseridas = await db.execute<{ id: number }>(sql`
    insert into public.caixa_execucao (empresa_id, origem)
    select alvo.id, ${origem}
    from unnest(array[${sql.join(
      empresaIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]) as alvo(id)
    where not exists (
      select 1 from public.caixa_execucao e
      where e.empresa_id = alvo.id and e.status in ('na_fila', 'em_andamento')
    )
    returning id
  `);
  return inseridas.length;
}
