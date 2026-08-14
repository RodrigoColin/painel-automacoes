/**
 * Consultas do painel.
 *
 * Toda função recebe `empresaId` explicitamente — quem resolve qual empresa é
 * a válida para a pessoa logada é `empresaAtual` no DAL. O RLS filtra de novo
 * no banco, então um esquecimento aqui não vira vazamento entre clientes.
 */

import { criarClienteServidor } from "@/lib/supabase/server";
import { gatilhoDe, type ConfigAutomacao } from "@/lib/automacao-tipos";
import type {
  Automacao,
  Execucao,
  Log,
  PontoDisparo,
  Usuario,
} from "@/lib/tipos";

const UM_DIA = 86_400_000;

/** Linha de `automacoes` como vem do banco, antes de virar `Automacao`. */
type LinhaAutomacao = {
  id: string;
  nome: string;
  descricao: string;
  status: Automacao["status"];
  tipo: ConfigAutomacao["tipo"];
  config: ConfigAutomacao["config"];
  proxima_execucao: string | null;
  perfis: { nome: string } | null;
};

export async function listarAutomacoes(empresaId: string): Promise<Automacao[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("automacoes")
    .select("id, nome, descricao, status, tipo, config, proxima_execucao, perfis:responsavel_id (nome)")
    .eq("empresa_id", empresaId)
    .order("criada_em", { ascending: false });

  if (error) throw error;

  const automacoes = (data ?? []) as unknown as LinhaAutomacao[];
  if (automacoes.length === 0) return [];

  // Contagem de execuções dos últimos 30 dias e a última execução de cada uma.
  const desde = new Date(Date.now() - 30 * UM_DIA).toISOString();
  const { data: execucoes, error: erroExecucoes } = await supabase
    .from("execucoes")
    .select("automacao_id, iniciada_em")
    .eq("empresa_id", empresaId)
    .gte("iniciada_em", desde);

  if (erroExecucoes) throw erroExecucoes;

  const totais = new Map<string, number>();
  const ultimas = new Map<string, string>();
  for (const execucao of execucoes ?? []) {
    const id = execucao.automacao_id as string;
    const inicio = execucao.iniciada_em as string;
    totais.set(id, (totais.get(id) ?? 0) + 1);
    if (!ultimas.has(id) || inicio > ultimas.get(id)!) ultimas.set(id, inicio);
  }

  return automacoes.map((linha) => {
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
      responsavel: linha.perfis?.nome ?? null,
      proximaExecucao: linha.proxima_execucao,
      ...entrada,
    } as Automacao;
  });
}

export async function listarExecucoes(
  empresaId: string,
  limite = 50,
): Promise<Execucao[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("execucoes")
    .select("id, resultado, origem, iniciada_em, duracao_ms, automacoes (nome)")
    .eq("empresa_id", empresaId)
    .order("iniciada_em", { ascending: false })
    .limit(limite);

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id as string,
    automacao:
      (linha.automacoes as unknown as { nome: string } | null)?.nome ??
      "Automação removida",
    resultado: linha.resultado as Execucao["resultado"],
    inicio: linha.iniciada_em as string,
    duracaoMs: linha.duracao_ms as number | null,
    origem: linha.origem as string,
  }));
}

export async function listarLogs(empresaId: string, limite = 20): Promise<Log[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("logs_execucao")
    .select("id, nivel, mensagem, horario, execucoes (automacoes (nome))")
    .eq("empresa_id", empresaId)
    .order("horario", { ascending: false })
    .limit(limite);

  if (error) throw error;

  return (data ?? []).map((linha) => {
    const execucao = linha.execucoes as unknown as {
      automacoes: { nome: string } | null;
    } | null;

    return {
      id: String(linha.id),
      nivel: linha.nivel as Log["nivel"],
      horario: linha.horario as string,
      automacao: execucao?.automacoes?.nome ?? "—",
      mensagem: linha.mensagem as string,
    };
  });
}

export async function listarUsuarios(empresaId: string): Promise<Usuario[]> {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("membros")
    .select("papel, status, perfis (id, nome, email, ultimo_acesso)")
    .eq("empresa_id", empresaId);

  if (error) throw error;

  return (data ?? []).flatMap((linha) => {
    const perfil = linha.perfis as unknown as {
      id: string;
      nome: string;
      email: string;
      ultimo_acesso: string | null;
    } | null;

    if (!perfil) return [];

    return [
      {
        id: perfil.id,
        nome: perfil.nome || perfil.email,
        email: perfil.email,
        papel: linha.papel as Usuario["papel"],
        status: linha.status as Usuario["status"],
        ultimoAcesso: perfil.ultimo_acesso,
      },
    ];
  });
}

/**
 * Métricas do dashboard, derivadas das execuções reais dos últimos 30 dias.
 *
 * Enquanto nada tiver rodado, tudo volta zerado — as telas tratam esse caso
 * com estado vazio em vez de gráfico em branco.
 */
export async function metricasDashboard(empresaId: string) {
  const supabase = await criarClienteServidor();
  const desde = new Date(Date.now() - 30 * UM_DIA);

  const { data, error } = await supabase
    .from("execucoes")
    .select("resultado, iniciada_em, duracao_ms")
    .eq("empresa_id", empresaId)
    .gte("iniciada_em", desde.toISOString());

  if (error) throw error;

  const execucoes = data ?? [];

  // Uma casa por dia dos últimos 30, para o gráfico não ficar com buracos.
  const porDia = new Map<string, { sucesso: number; erro: number }>();
  for (let i = 29; i >= 0; i--) {
    const dia = new Date(Date.now() - i * UM_DIA);
    porDia.set(chaveDia(dia), { sucesso: 0, erro: 0 });
  }

  const porHora = Array.from({ length: 24 }, () => 0);
  let sucessos = 0;
  let erros = 0;
  let somaDuracoes = 0;
  let comDuracao = 0;

  for (const execucao of execucoes) {
    const quando = new Date(execucao.iniciada_em as string);
    const casa = porDia.get(chaveDia(quando));

    if (execucao.resultado === "sucesso") {
      sucessos++;
      if (casa) casa.sucesso++;
    } else if (execucao.resultado === "erro") {
      erros++;
      if (casa) casa.erro++;
    }

    porHora[quando.getHours()]++;

    if (typeof execucao.duracao_ms === "number") {
      somaDuracoes += execucao.duracao_ms;
      comDuracao++;
    }
  }

  const serie30d: PontoDisparo[] = [...porDia.entries()].map(
    ([chave, valores]) => ({
      rotulo: chave.slice(8, 10) + "/" + chave.slice(5, 7),
      ...valores,
    }),
  );

  return {
    total: execucoes.length,
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
export async function proximasExecucoes(empresaId: string, limite = 5) {
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase
    .from("automacoes")
    .select("id, nome, tipo, config, proxima_execucao")
    .eq("empresa_id", empresaId)
    .eq("status", "ativa")
    .not("proxima_execucao", "is", null)
    .order("proxima_execucao", { ascending: true })
    .limit(limite);

  if (error) throw error;

  return (data ?? []).map((linha) => ({
    id: linha.id as string,
    automacao: linha.nome as string,
    quando: linha.proxima_execucao as string,
    gatilho: gatilhoDe({
      tipo: linha.tipo,
      config: linha.config,
    } as ConfigAutomacao),
  }));
}
