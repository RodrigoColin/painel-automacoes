"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";
import {
  empresaAtual,
  empresasDoUsuario,
  exigirPermissaoDeEscrita,
  souAdminPlataforma,
  verificarSessao,
} from "@/lib/dal";
import { gravarEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { proximaExecucao } from "@/lib/agendamento";
import { testarConexao } from "@/lib/executores/n8n-sincronizacao";
import { testarConexao as testarConexaoInfisical } from "@/lib/executores/infisical";
import type { Json } from "@/lib/supabase/tipos-banco";
import type { ConfigAutomacao } from "@/lib/automacao-tipos";
import type { StatusAutomacao } from "@/lib/tipos";

export type Resultado = { erro?: string };

/**
 * Grava a linha única (`id = true`) da tabela de segredo do n8n de
 * plataforma.
 *
 * Essa tabela não tem policy de SELECT de propósito — nem admin de
 * plataforma lê o segredo de volta pela API, só o executor com a secret key
 * do Supabase. Isso quebra `.upsert()`: um `INSERT ... ON CONFLICT DO
 * UPDATE` precisa checar se já existe conflito, e essa checagem passa pela
 * policy de SELECT que não existe, então o Postgres nega o comando inteiro
 * mesmo com policy de INSERT/UPDATE liberando. INSERT simples e UPDATE
 * simples não têm esse problema — só a forma combinada do upsert.
 */
async function gravarSegredoN8n(apiKey: string): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const atualizado_em = new Date().toISOString();

  const { error: erroInsercao } = await supabase
    .from("integracao_n8n_plataforma_segredo")
    .insert({ id: true, api_key: apiKey, atualizado_em });
  if (!erroInsercao) return null;

  // 23505 = unique_violation — a linha (id = true) já existe, então o
  // caminho certo é atualizar em vez de inserir.
  if (erroInsercao.code !== "23505") return erroInsercao.message;

  const { error: erroAtualizacao } = await supabase
    .from("integracao_n8n_plataforma_segredo")
    .update({ api_key: apiKey, atualizado_em })
    .eq("id", true);

  return erroAtualizacao ? erroAtualizacao.message : null;
}

/** Mesma lógica de `gravarSegredoN8n`, para o Client Secret do Infisical. */
async function gravarSegredoInfisical(clientSecret: string): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const atualizado_em = new Date().toISOString();

  const { error: erroInsercao } = await supabase
    .from("integracao_infisical_plataforma_segredo")
    .insert({ id: true, client_secret: clientSecret, atualizado_em });
  if (!erroInsercao) return null;

  if (erroInsercao.code !== "23505") return erroInsercao.message;

  const { error: erroAtualizacao } = await supabase
    .from("integracao_infisical_plataforma_segredo")
    .update({ client_secret: clientSecret, atualizado_em })
    .eq("id", true);

  return erroAtualizacao ? erroAtualizacao.message : null;
}

/** Troca a empresa em uso, recusando id que não pertença ao usuário. */
export async function selecionarEmpresa(empresaId: string): Promise<Resultado> {
  const empresas = await empresasDoUsuario();
  if (!empresas.some((empresa) => empresa.id === empresaId)) {
    return { erro: "Empresa indisponível." };
  }

  await gravarEmpresaSelecionada(empresaId);
  revalidatePath("/", "layout");
  return {};
}

export async function cadastrarEmpresa(dados: {
  nome: string;
  cnpj?: string;
  email?: string;
}): Promise<Resultado> {
  const { userId } = await verificarSessao();
  const nome = dados.nome.trim();
  if (!nome) return { erro: "Informe o nome da empresa." };

  const supabase = await criarClienteServidor();

  const { data: empresa, error } = await supabase
    .from("empresas")
    .insert({
      nome,
      cnpj: dados.cnpj?.trim() || null,
      email: dados.email?.trim() || null,
    })
    .select("id")
    .single();

  if (error || !empresa) return { erro: "Não foi possível cadastrar a empresa." };

  // Quem cria entra como admin — sem isso ninguém enxergaria a empresa criada,
  // já que toda leitura passa pelo vínculo em `membros`.
  const { error: erroMembro } = await supabase.from("membros").insert({
    empresa_id: empresa.id,
    user_id: userId,
    papel: "admin",
    status: "ativo",
  });

  if (erroMembro) return { erro: "Empresa criada, mas o acesso falhou." };

  await gravarEmpresaSelecionada(empresa.id);
  revalidatePath("/", "layout");
  return {};
}

/**
 * Conecta a plataforma (a Admin) à conta de n8n compartilhada por todos os
 * clientes.
 *
 * Diferente do desenho anterior, essa conexão não é por empresa: é uma só,
 * e só quem administra a Admin pode alterá-la — um admin da Scopo ou da
 * Oystr derrubaria a integração de todo mundo se pudesse mexer aqui. A URL
 * fica em `integracao_n8n_plataforma`; a chave em
 * `integracao_n8n_plataforma_segredo`, sem policy nenhuma — só o
 * sincronizador a enxerga, e ela nunca volta para a interface depois de
 * salva.
 */
export async function salvarIntegracaoN8n(dados: {
  instanciaUrl: string;
  apiKey: string;
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Admin podem alterar essa integração." };
  }

  const url = dados.instanciaUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/\S+$/.test(url)) {
    return { erro: "Informe uma URL válida, começando com http:// ou https://." };
  }
  if (!dados.apiKey.trim()) return { erro: "Informe a chave de API do n8n." };

  // Confirma que a credencial funciona antes de guardá-la — salvar uma chave
  // inválida só adiaria a descoberta do erro para a primeira sincronização.
  const teste = await testarConexao(url, dados.apiKey.trim());
  if (!teste.sucesso) {
    return { erro: teste.logs.at(-1)?.mensagem ?? "Não foi possível conectar ao n8n." };
  }

  const supabase = await criarClienteServidor();

  const { error: erroUrl } = await supabase
    .from("integracao_n8n_plataforma")
    .upsert({ id: true, instancia_url: url }, { onConflict: "id" });

  if (erroUrl) return { erro: "Não foi possível salvar a URL da instância." };

  const erroChave = await gravarSegredoN8n(dados.apiKey.trim());

  if (erroChave) return { erro: "URL salva, mas a chave de API falhou." };

  revalidatePath("/configuracoes");
  return {};
}

/**
 * Conecta a plataforma ao projeto do Infisical compartilhado por todos os
 * clientes — mesma restrição de acesso da integração com o n8n: só admin da
 * Admin.
 *
 * O isolamento entre clientes não vem daqui: vem do caminho de cada empresa
 * dentro do projeto, definido em `infisical_caminhos_clientes` por
 * `salvarCaminhoInfisicalCliente`. Aqui só se conecta ao projeto em si.
 */
export async function salvarIntegracaoInfisical(dados: {
  siteUrl: string;
  clientId: string;
  clientSecret: string;
  projetoId: string;
  ambiente: string;
  injetarSegredos: boolean;
  mascararValores: boolean;
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Admin podem alterar essa integração." };
  }

  const siteUrl = dados.siteUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/\S+$/.test(siteUrl)) {
    return { erro: "Informe uma URL válida, começando com http:// ou https://." };
  }
  const clientId = dados.clientId.trim();
  if (!clientId) return { erro: "Informe o Client ID da Machine Identity." };
  if (!dados.clientSecret.trim()) return { erro: "Informe o Client Secret." };
  const projetoId = dados.projetoId.trim();
  if (!projetoId) return { erro: "Informe o ID do projeto." };
  const ambiente = dados.ambiente.trim() || "prod";

  // Confirma que a credencial funciona e enxerga o projeto/ambiente
  // informados antes de guardá-la. Testa na raiz — o caminho de cada cliente
  // só existe depois que a Admin o configurar.
  const teste = await testarConexaoInfisical(
    siteUrl,
    clientId,
    dados.clientSecret.trim(),
    projetoId,
    ambiente,
    "/",
  );
  if (!teste.sucesso) {
    return { erro: teste.logs.at(-1)?.mensagem ?? "Não foi possível conectar ao Infisical." };
  }

  const supabase = await criarClienteServidor();

  const { error: erroConexao } = await supabase.from("integracao_infisical_plataforma").upsert(
    {
      id: true,
      site_url: siteUrl,
      client_id: clientId,
      projeto_id: projetoId,
      ambiente,
      injetar_segredos: dados.injetarSegredos,
      mascarar_valores: dados.mascararValores,
    },
    { onConflict: "id" },
  );

  if (erroConexao) return { erro: "Não foi possível salvar a conexão." };

  const erroSegredo = await gravarSegredoInfisical(dados.clientSecret.trim());

  if (erroSegredo) return { erro: "Conexão salva, mas o Client Secret falhou." };

  revalidatePath("/configuracoes");
  return {};
}

/**
 * Define em qual pasta do projeto Infisical compartilhado os segredos de uma
 * empresa cliente vivem — é o que isola a Scopo da Oystr dentro do mesmo
 * projeto. Só admin da Admin define; a própria empresa só lê o resultado.
 */
export async function salvarCaminhoInfisicalCliente(dados: {
  empresaId: string;
  caminho: string;
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Admin podem definir o caminho de um cliente." };
  }

  const caminho = dados.caminho.trim();
  if (!caminho.startsWith("/")) {
    return { erro: "O caminho precisa começar com \"/\"." };
  }

  const supabase = await criarClienteServidor();

  const { error } = await supabase.from("infisical_caminhos_clientes").upsert(
    { empresa_id: dados.empresaId, caminho, atualizado_em: new Date().toISOString() },
    { onConflict: "empresa_id" },
  );

  if (error) return { erro: "Não foi possível salvar o caminho." };

  revalidatePath("/configuracoes");
  return {};
}

export async function criarAutomacao(dados: {
  nome: string;
  descricao: string;
  status: StatusAutomacao;
} & ConfigAutomacao): Promise<Resultado> {
  const { userId } = await verificarSessao();
  const empresa = await empresaAtual(undefined);
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };

  await exigirPermissaoDeEscrita(empresa.id);

  const supabase = await criarClienteServidor();

  // As variáveis de ambiente são segredo do cliente: saem da config e vão para
  // a tabela que nenhuma policy expõe.
  let config: Json = { ...dados.config };
  let segredos: Json | null = null;

  if (dados.tipo === "python-cron") {
    const { variaveis, ...resto } = dados.config;
    config = resto;
    if (variaveis.trim()) segredos = { variaveis };
  }

  // Só automação ativa entra na agenda — rascunho não deve disparar.
  const proxima =
    dados.status === "ativa"
      ? proximaExecucao({ tipo: dados.tipo, config: dados.config } as ConfigAutomacao)
      : null;

  const { data: automacao, error } = await supabase
    .from("automacoes")
    .insert({
      empresa_id: empresa.id,
      nome: dados.nome.trim(),
      descricao: dados.descricao.trim(),
      status: dados.status,
      tipo: dados.tipo,
      config,
      responsavel_id: userId,
      proxima_execucao: proxima?.toISOString() ?? null,
    })
    .select("id")
    .single();

  if (error || !automacao) {
    return { erro: "Não foi possível criar a automação." };
  }

  if (segredos) {
    const { error: erroSegredo } = await supabase
      .from("automacao_segredos")
      .insert({
        automacao_id: automacao.id,
        empresa_id: empresa.id,
        valores: segredos,
      });

    if (erroSegredo) return { erro: "Automação criada, mas as variáveis falharam." };
  }

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  return {};
}

export async function excluirAutomacao(automacaoId: string): Promise<Resultado> {
  const empresa = await empresaAtual(undefined);
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };

  await exigirPermissaoDeEscrita(empresa.id);

  const supabase = await criarClienteServidor();
  // O `eq` na empresa é redundante com o RLS, e é essa a intenção: se a policy
  // mudar por engano, a consulta ainda não alcança dados de outro cliente.
  const { error } = await supabase
    .from("automacoes")
    .delete()
    .eq("id", automacaoId)
    .eq("empresa_id", empresa.id);

  if (error) return { erro: "Não foi possível excluir a automação." };

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  return {};
}

export async function alterarStatusAutomacao(
  automacaoId: string,
  status: StatusAutomacao,
): Promise<Resultado> {
  const empresa = await empresaAtual(undefined);
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };

  await exigirPermissaoDeEscrita(empresa.id);

  const supabase = await criarClienteServidor();

  // Ativar coloca na agenda; pausar tira. Sem isto uma automação pausada
  // continuaria vencida e o dispatcher a redisparia ao ser reativada.
  const { data: atual } = await supabase
    .from("automacoes")
    .select("tipo, config")
    .eq("id", automacaoId)
    .eq("empresa_id", empresa.id)
    .single();

  const proxima =
    status === "ativa" && atual
      ? proximaExecucao({
          tipo: atual.tipo,
          config: atual.config,
        } as unknown as ConfigAutomacao)
      : null;

  const { error } = await supabase
    .from("automacoes")
    .update({
      status,
      proxima_execucao: proxima?.toISOString() ?? null,
      atualizada_em: new Date().toISOString(),
    })
    .eq("id", automacaoId)
    .eq("empresa_id", empresa.id);

  if (error) return { erro: "Não foi possível alterar o status." };

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  return {};
}
