/**
 * Tabelas do banco, para as consultas tipadas do Drizzle.
 *
 * Espelha `db/migrations` — a fonte de verdade da estrutura (policies,
 * funções e índices) continua sendo o SQL; aqui ficam só colunas e relações,
 * que é o que o app consulta. Mudou uma migração, mude aqui também.
 *
 * Datas voltam como string ISO, e números (`numeric`, `bigint`) como
 * `number`: é o formato que o Supabase devolvia, e boa parte das telas compara
 * datas como texto ou soma valores direto.
 */

import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `timestamptz` como string ISO 8601 (`2026-09-22T13:00:00.000Z`).
 *
 * O modo `string` nativo do Drizzle devolve o texto cru do Postgres
 * (`2026-09-22 13:00:00+00`), que não ordena igual ao ISO nem é aceito por
 * todo `Date.parse`.
 */
const timestamptz = customType<{ data: string; driverData: string }>({
  dataType: () => "timestamp with time zone",
  fromDriver: (valor) => new Date(valor).toISOString(),
  toDriver: (valor) => valor,
});

/* --------------------------------- Enums --------------------------------- */

export const statusAutomacao = pgEnum("status_automacao", ["ativa", "pausada", "rascunho"]);
export const tipoAutomacao = pgEnum("tipo_automacao", ["python-cron", "n8n", "upload"]);
export const resultadoExecucao = pgEnum("resultado_execucao", ["sucesso", "erro", "em_andamento"]);
export const nivelLog = pgEnum("nivel_log", ["info", "aviso", "erro"]);
export const papelMembro = pgEnum("papel_membro", ["admin", "editor", "leitor"]);
export const statusMembro = pgEnum("status_membro", ["ativo", "convidado", "inativo"]);

/* ------------------------------ Autenticação ----------------------------- */

const auth = pgSchema("auth");

export const usuarios = auth.table("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  senhaHash: text("senha_hash").notNull(),
  criadoEm: timestamptz("criado_em").notNull().default(sql`now()`),
  atualizadoEm: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const sessoes = auth.table("sessoes", {
  tokenHash: text("token_hash").primaryKey(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  criadaEm: timestamptz("criada_em").notNull().default(sql`now()`),
  expiraEm: timestamptz("expira_em").notNull(),
});

/* -------------------------------- Tabelas -------------------------------- */

export const empresas = pgTable("empresas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  cnpj: text("cnpj"),
  email: text("email"),
  eh_plataforma: boolean("eh_plataforma").notNull().default(false),
  logo_url: text("logo_url"),
  criada_em: timestamptz("criada_em").notNull().default(sql`now()`),
});

export const perfis = pgTable("perfis", {
  id: uuid("id").primaryKey(),
  nome: text("nome").notNull().default(""),
  email: text("email").notNull(),
  ultimo_acesso: timestamptz("ultimo_acesso"),
});

export const membros = pgTable(
  "membros",
  {
    empresa_id: uuid("empresa_id").notNull(),
    user_id: uuid("user_id").notNull(),
    papel: papelMembro("papel").notNull().default("leitor"),
    status: statusMembro("status").notNull().default("convidado"),
    criado_em: timestamptz("criado_em").notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.user_id] })],
);

export const automacoes = pgTable("automacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresa_id: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  descricao: text("descricao").notNull().default(""),
  status: statusAutomacao("status").notNull().default("rascunho"),
  tipo: tipoAutomacao("tipo").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  proxima_execucao: timestamptz("proxima_execucao"),
  sincronizado_ate: timestamptz("sincronizado_ate"),
  criada_em: timestamptz("criada_em").notNull().default(sql`now()`),
  atualizada_em: timestamptz("atualizada_em").notNull().default(sql`now()`),
});

export const execucoes = pgTable("execucoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  automacao_id: uuid("automacao_id").notNull(),
  empresa_id: uuid("empresa_id").notNull(),
  resultado: resultadoExecucao("resultado").notNull().default("em_andamento"),
  origem: text("origem").notNull().default("agendador"),
  iniciada_em: timestamptz("iniciada_em").notNull().default(sql`now()`),
  finalizada_em: timestamptz("finalizada_em"),
  duracao_ms: integer("duracao_ms"),
  log_path: text("log_path"),
  externo_id: text("externo_id"),
  arquivo_path: text("arquivo_path"),
  arquivo_nome: text("arquivo_nome"),
});

export const logsExecucao = pgTable("logs_execucao", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  execucao_id: uuid("execucao_id").notNull(),
  empresa_id: uuid("empresa_id").notNull(),
  nivel: nivelLog("nivel").notNull().default("info"),
  mensagem: text("mensagem").notNull(),
  horario: timestamptz("horario").notNull().default(sql`now()`),
});

export const integracaoN8n = pgTable("integracao_n8n_plataforma", {
  id: boolean("id").primaryKey().default(true),
  instancia_url: text("instancia_url").notNull(),
  criada_em: timestamptz("criada_em").notNull().default(sql`now()`),
});

export const integracaoN8nSegredo = pgTable("integracao_n8n_plataforma_segredo", {
  id: boolean("id").primaryKey().default(true),
  api_key: text("api_key").notNull(),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const integracaoInfisical = pgTable("integracao_infisical_plataforma", {
  id: boolean("id").primaryKey().default(true),
  projeto_id: text("projeto_id").notNull(),
  ambiente: text("ambiente").notNull().default("prod"),
  pasta_raiz: text("pasta_raiz").notNull().default("/clientes"),
  criada_em: timestamptz("criada_em").notNull().default(sql`now()`),
});

export const infisicalCaminhosClientes = pgTable("infisical_caminhos_clientes", {
  empresa_id: uuid("empresa_id").primaryKey(),
  caminho: text("caminho").notNull(),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const arquivos = pgTable("arquivos", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresa_id: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  caminho: text("caminho").notNull(),
  tamanho_bytes: bigint("tamanho_bytes", { mode: "number" }).notNull(),
  tipo_mime: text("tipo_mime"),
  enviado_por: uuid("enviado_por"),
  enviado_em: timestamptz("enviado_em").notNull().default(sql`now()`),
});

export const acessosChaves = pgTable("acessos_chaves", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresa_id: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  descricao: text("descricao").notNull().default(""),
  criado_por: uuid("criado_por"),
  criado_em: timestamptz("criado_em").notNull().default(sql`now()`),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const acessosChavesSegredo = pgTable("acessos_chaves_segredo", {
  chave_id: uuid("chave_id").primaryKey(),
  empresa_id: uuid("empresa_id").notNull(),
  valor: text("valor").notNull(),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

/* ---------------------------------- Omie --------------------------------- */

export const omieFaturamentoMensal = pgTable(
  "omie_faturamento_mensal",
  {
    empresa_id: uuid("empresa_id").notNull(),
    competencia: date("competencia", { mode: "string" }).notNull(),
    cliente_codigo: bigint("cliente_codigo", { mode: "number" }).notNull(),
    categoria_codigo: text("categoria_codigo").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2, mode: "number" }).notNull(),
    quantidade_os: integer("quantidade_os").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.competencia, t.cliente_codigo, t.categoria_codigo] })],
);

export const omieClientes = pgTable(
  "omie_clientes",
  {
    empresa_id: uuid("empresa_id").notNull(),
    codigo: bigint("codigo", { mode: "number" }).notNull(),
    nome: text("nome").notNull(),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.codigo] })],
);

export const omieCategorias = pgTable(
  "omie_categorias",
  {
    empresa_id: uuid("empresa_id").notNull(),
    codigo: text("codigo").notNull(),
    descricao: text("descricao").notNull(),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.codigo] })],
);

export const omieSincronizacao = pgTable("omie_sincronizacao", {
  empresa_id: uuid("empresa_id").primaryKey(),
  iniciada_em: timestamptz("iniciada_em"),
  concluida_em: timestamptz("concluida_em"),
  primeira_competencia: date("primeira_competencia", { mode: "string" }),
  erro: text("erro"),
});

export const omieContratos = pgTable(
  "omie_contratos",
  {
    empresa_id: uuid("empresa_id").notNull(),
    codigo: bigint("codigo", { mode: "number" }).notNull(),
    cliente_codigo: bigint("cliente_codigo", { mode: "number" }).notNull(),
    situacao: text("situacao").notNull(),
    categorias: text("categorias").array().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.codigo] })],
);

/* ------------------------------ Fluxo de caixa ---------------------------- */

export const fluxoCaixaConfig = pgTable("fluxo_caixa_config", {
  empresa_id: uuid("empresa_id").primaryKey(),
  saldo_minimo: numeric("saldo_minimo", { precision: 14, scale: 2, mode: "number" }),
  contas: jsonb("contas").$type<Record<string, unknown>>().notNull().default({}),
  categorias_grupo: jsonb("categorias_grupo").$type<Record<string, string>>().notNull().default({}),
  linhas_receita: jsonb("linhas_receita")
    .$type<{ nome: string; termos: string[] }[]>()
    .notNull()
    .default([]),
  historico_fixo: jsonb("historico_fixo").$type<{ mes: string; ent: number; sai: number; acum: number }[]>(),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const cacheExterno = pgTable(
  "cache_externo",
  {
    empresa_id: uuid("empresa_id").notNull(),
    chave: text("chave").notNull(),
    valor: jsonb("valor").$type<unknown>().notNull(),
    atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.chave] })],
);

/** Pacote diário gravado pelo container `caixa`; só `extrato`, `extra` e `checagem` alimentam a tela. */
export const caixaPacoteDiario = pgTable(
  "caixa_pacote_diario",
  {
    empresa_id: uuid("empresa_id").notNull(),
    data: date("data", { mode: "string" }).notNull(),
    manifesto: jsonb("manifesto").$type<Record<string, unknown>>().notNull(),
    extrato: jsonb("extrato").$type<unknown>(),
    extra: jsonb("extra").$type<unknown>(),
    checagem: jsonb("checagem").$type<unknown>(),
    atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.data] })],
);

export const caixaExecucao = pgTable("caixa_execucao", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  empresa_id: uuid("empresa_id").notNull(),
  origem: text("origem").$type<"agendado" | "manual">().notNull(),
  status: text("status").$type<"na_fila" | "em_andamento" | "sucesso" | "erro">().notNull().default("na_fila"),
  etapa: text("etapa"),
  criada_em: timestamptz("criada_em").notNull().default(sql`now()`),
  iniciada_em: timestamptz("iniciada_em"),
  concluida_em: timestamptz("concluida_em"),
  avisos: jsonb("avisos").$type<string[]>().notNull().default([]),
  erro: text("erro"),
  log: text("log"),
});

// Categorias que contam como receita recorrente para a empresa. Sem linha (ou
// lista vazia) → vale o heurístico de nome ("Recorrente") em faturamento.ts.
export const recorrenciaConfig = pgTable("recorrencia_config", {
  empresa_id: uuid("empresa_id").primaryKey(),
  categoria_codigos: text("categoria_codigos").array().notNull().default([]),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

/* ------------------------------ Telas por usuário ------------------------- */

// Uma linha = tela desligada para a pessoa naquela empresa; sem linha, liberada.
export const telasBloqueadas = pgTable(
  "telas_bloqueadas",
  {
    empresa_id: uuid("empresa_id").notNull(),
    user_id: uuid("user_id").notNull(),
    tela: text("tela").notNull(),
    atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.user_id, t.tela] })],
);

/* ------------------------------ Planos de ação ---------------------------- */

export const planosConfig = pgTable("planos_config", {
  empresa_id: uuid("empresa_id").primaryKey(),
  auto_inadimplencia: boolean("auto_inadimplencia").notNull().default(true),
  atraso_minimo_dias: integer("atraso_minimo_dias").notNull().default(7),
  valor_minimo: numeric("valor_minimo", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  sincronizado_pacote_em: timestamptz("sincronizado_pacote_em"),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const planosCards = pgTable("planos_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresa_id: uuid("empresa_id").notNull(),
  titulo: text("titulo").notNull(),
  descricao: text("descricao").notNull().default(""),
  etapa: text("etapa").notNull().default("a_tratar"),
  origem: text("origem").notNull().default("manual"),
  cliente_nome: text("cliente_nome"),
  dados: jsonb("dados").$type<Record<string, unknown>>().notNull().default({}),
  responsavel_id: uuid("responsavel_id"),
  prazo: date("prazo", { mode: "string" }),
  regularizado_em: timestamptz("regularizado_em"),
  concluido_em: timestamptz("concluido_em"),
  criado_por: uuid("criado_por"),
  criado_em: timestamptz("criado_em").notNull().default(sql`now()`),
  atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
});

export const planosTarefas = pgTable("planos_tarefas", {
  id: uuid("id").primaryKey().defaultRandom(),
  card_id: uuid("card_id").notNull(),
  empresa_id: uuid("empresa_id").notNull(),
  titulo: text("titulo").notNull(),
  responsavel_id: uuid("responsavel_id"),
  prazo: date("prazo", { mode: "string" }),
  concluida_em: timestamptz("concluida_em"),
  concluida_por: uuid("concluida_por"),
  criado_em: timestamptz("criado_em").notNull().default(sql`now()`),
});

export const planosEventos = pgTable("planos_eventos", {
  id: uuid("id").primaryKey().defaultRandom(),
  card_id: uuid("card_id").notNull(),
  empresa_id: uuid("empresa_id").notNull(),
  tipo: text("tipo").notNull(),
  autor_id: uuid("autor_id"),
  texto: text("texto").notNull().default(""),
  criado_em: timestamptz("criado_em").notNull().default(sql`now()`),
});

export const validacaoSaldoDiario = pgTable(
  "validacao_saldo_diario",
  {
    empresa_id: uuid("empresa_id").notNull(),
    conta_id: text("conta_id").notNull(),
    conta_descricao: text("conta_descricao"),
    data: date("data", { mode: "string" }).notNull(),
    saldo_banco: numeric("saldo_banco", { precision: 14, scale: 2, mode: "number" }),
    saldo_omie: numeric("saldo_omie", { precision: 14, scale: 2, mode: "number" }),
    diferenca: numeric("diferenca", { precision: 14, scale: 2, mode: "number" }),
    movimento_banco: numeric("movimento_banco", { precision: 14, scale: 2, mode: "number" }),
    movimento_omie: numeric("movimento_omie", { precision: 14, scale: 2, mode: "number" }),
    diferenca_movimento: numeric("diferenca_movimento", { precision: 14, scale: 2, mode: "number" }),
    fonte_extrato: text("fonte_extrato"),
    atualizado_em: timestamptz("atualizado_em").notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.empresa_id, t.conta_id, t.data] })],
);

/* -------------------------------- Relações ------------------------------- */

// Só as que as consultas usam com `with`, no lugar dos "embeds" do PostgREST
// (`membros.select("papel, empresas (...)")`).

export const relacoesMembros = relations(membros, ({ one }) => ({
  empresa: one(empresas, { fields: [membros.empresa_id], references: [empresas.id] }),
  perfil: one(perfis, { fields: [membros.user_id], references: [perfis.id] }),
}));

export const relacoesAutomacoes = relations(automacoes, ({ one }) => ({
  empresa: one(empresas, { fields: [automacoes.empresa_id], references: [empresas.id] }),
}));

export const relacoesExecucoes = relations(execucoes, ({ one }) => ({
  automacao: one(automacoes, { fields: [execucoes.automacao_id], references: [automacoes.id] }),
  empresa: one(empresas, { fields: [execucoes.empresa_id], references: [empresas.id] }),
}));

export const relacoesLogs = relations(logsExecucao, ({ one }) => ({
  execucao: one(execucoes, { fields: [logsExecucao.execucao_id], references: [execucoes.id] }),
}));

export const relacoesAcessosChaves = relations(acessosChaves, ({ one }) => ({
  autor: one(perfis, { fields: [acessosChaves.criado_por], references: [perfis.id] }),
}));
