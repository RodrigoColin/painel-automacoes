"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";
import {
  empresaAtual,
  empresasDoUsuario,
  exigirPermissaoDeEscrita,
  verificarSessao,
} from "@/lib/dal";
import { gravarEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { proximaExecucao } from "@/lib/agendamento";
import { testarConexao } from "@/lib/executores/n8n-sincronizacao";
import { testarConexao as testarConexaoInfisical } from "@/lib/executores/infisical";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import type { Json } from "@/lib/supabase/tipos-banco";
import type { ConfigAutomacao } from "@/lib/automacao-tipos";
import type { StatusAutomacao } from "@/lib/tipos";

export type Resultado = { erro?: string };

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
 * Conecta a empresa a uma instância n8n.
 *
 * A URL fica em `integracoes_n8n` (legível pelos membros) e a chave em
 * `integracoes_n8n_segredos`, que não tem policy nenhuma — só o sincronizador
 * a enxerga. A chave nunca volta para a interface depois de salva.
 */
export async function salvarIntegracaoN8n(dados: {
  instanciaUrl: string;
  apiKey: string;
}): Promise<Resultado> {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };
  if (empresa.papel !== "admin") {
    return { erro: "Só administradores podem alterar integrações." };
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
    .from("integracoes_n8n")
    .upsert({ empresa_id: empresa.id, instancia_url: url }, { onConflict: "empresa_id" });

  if (erroUrl) return { erro: "Não foi possível salvar a URL da instância." };

  const { error: erroChave } = await supabase
    .from("integracoes_n8n_segredos")
    .upsert(
      {
        empresa_id: empresa.id,
        api_key: dados.apiKey.trim(),
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "empresa_id" },
    );

  if (erroChave) return { erro: "URL salva, mas a chave de API falhou." };

  revalidatePath("/configuracoes");
  return {};
}

/**
 * Conecta a empresa a um projeto do Infisical.
 *
 * URL, Client ID, projeto, ambiente e caminho ficam em `integracoes_infisical`
 * (legível pelos membros); o Client Secret fica em
 * `integracoes_infisical_segredos`, sem policy — só o executor, com a secret
 * key do Supabase, o enxerga. O Client Secret nunca volta para a interface
 * depois de salvo.
 */
export async function salvarIntegracaoInfisical(dados: {
  siteUrl: string;
  clientId: string;
  clientSecret: string;
  projetoId: string;
  ambiente: string;
  caminhoBase: string;
}): Promise<Resultado> {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };
  if (empresa.papel !== "admin") {
    return { erro: "Só administradores podem alterar integrações." };
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
  const caminhoBase = dados.caminhoBase.trim() || "/";

  // Confirma que a credencial funciona — e que enxerga o projeto/ambiente
  // informados — antes de guardá-la.
  const teste = await testarConexaoInfisical(
    siteUrl,
    clientId,
    dados.clientSecret.trim(),
    projetoId,
    ambiente,
    caminhoBase,
  );
  if (!teste.sucesso) {
    return { erro: teste.logs.at(-1)?.mensagem ?? "Não foi possível conectar ao Infisical." };
  }

  const supabase = await criarClienteServidor();

  const { error: erroConexao } = await supabase.from("integracoes_infisical").upsert(
    {
      empresa_id: empresa.id,
      site_url: siteUrl,
      client_id: clientId,
      projeto_id: projetoId,
      ambiente,
      caminho_base: caminhoBase,
    },
    { onConflict: "empresa_id" },
  );

  if (erroConexao) return { erro: "Não foi possível salvar a conexão." };

  const { error: erroSegredo } = await supabase.from("integracoes_infisical_segredos").upsert(
    {
      empresa_id: empresa.id,
      client_secret: dados.clientSecret.trim(),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "empresa_id" },
  );

  if (erroSegredo) return { erro: "Conexão salva, mas o Client Secret falhou." };

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
