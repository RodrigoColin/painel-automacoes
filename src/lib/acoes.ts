"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";
import { clienteAdmin } from "@/lib/supabase/admin";
import {
  empresaAtual,
  empresasDoUsuario,
  exigirAdminPlataforma,
  exigirPermissaoDeEscrita,
  souAdminPlataforma,
  verificarSessao,
} from "@/lib/dal";
import { gravarEmpresaSelecionada, lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { proximaExecucao } from "@/lib/agendamento";
import { testarConexao } from "@/lib/executores/n8n-sincronizacao";
import { testarConexao as testarConexaoInfisical } from "@/lib/executores/infisical";
import type { Json } from "@/lib/supabase/tipos-banco";
import type { ConfigAutomacao } from "@/lib/automacao-tipos";
import type { StatusAutomacao } from "@/lib/tipos";

export type Resultado = { erro?: string };

/** Sucesso com ressalva: a operação valeu, mas não exatamente como pedido. */
export type ResultadoComAviso = Resultado & { aviso?: string };

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

/**
 * Só admin da plataforma cadastra empresa nova — vira uma empresa cliente da
 * Admin. Uma empresa cliente não pode criar outra: sem isso a hierarquia
 * (uma Admin, N clientes) vira uma lista plana de empresas soltas. O RLS
 * (`empresas_insercao`) recusa o INSERT de qualquer forma; a checagem aqui só
 * dá uma mensagem melhor do que o erro genérico do banco.
 */
export async function cadastrarEmpresa(dados: { nome: string }): Promise<Resultado> {
  const { userId } = await verificarSessao();
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Admin podem cadastrar novas empresas." };
  }

  const nome = dados.nome.trim();
  if (!nome) return { erro: "Informe o nome da empresa." };

  const supabase = await criarClienteServidor();

  // Gera o id em vez de ler de volta com `.select().single()`: a policy de
  // SELECT de `empresas` depende de `eh_admin_plataforma()`, que consulta a
  // própria tabela `empresas` — nessa combinação, o Postgres recusa o
  // RETURNING de colunas reais mesmo a inserção tendo sido aceita (a mesma
  // leitura funciona perfeitamente logo em seguida, fora do RETURNING). Sem
  // pedir colunas de volta, o INSERT não esbarra nisso.
  const id = crypto.randomUUID();
  const { error } = await supabase.from("empresas").insert({ id, nome });

  if (error) return { erro: "Não foi possível cadastrar a empresa." };

  // Quem cria entra como admin — sem isso ninguém enxergaria a empresa criada,
  // já que toda leitura passa pelo vínculo em `membros`.
  const { error: erroMembro } = await supabase.from("membros").insert({
    empresa_id: id,
    user_id: userId,
    papel: "admin",
    status: "ativo",
  });

  if (erroMembro) return { erro: "Empresa criada, mas o acesso falhou." };

  await gravarEmpresaSelecionada(id);
  revalidatePath("/", "layout");
  return {};
}

/**
 * Renomeia a empresa em uso — o nome que aparece na barra lateral e no
 * seletor. Qualquer empresa pode renomear a si mesma, não só a Proos: quem
 * administra decide o nome do próprio ambiente. RLS (`empresas_escrita`)
 * já exige `eh_admin`; a checagem aqui só dá uma mensagem melhor.
 */
export async function atualizarNomeEmpresa(dados: {
  empresaId: string;
  nome: string;
}): Promise<Resultado> {
  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === dados.empresaId);
  if (!empresa || empresa.papel !== "admin") {
    return { erro: "Só administradores podem renomear a empresa." };
  }

  const nome = dados.nome.trim();
  if (!nome) return { erro: "Informe o nome da empresa." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("empresas")
    .update({ nome })
    .eq("id", dados.empresaId);

  if (error) return { erro: "Não foi possível salvar o nome." };

  revalidatePath("/", "layout");
  return {};
}

/** Piso local. O projeto no Supabase pode exigir mais; o erro dele é repassado. */
const SENHA_MINIMA = 8;

/**
 * Cria um acesso ao painel com e-mail e senha, já ativo — só quem é admin da
 * empresa cria, e só como "admin" ou "membro" (o enum tem um terceiro papel,
 * `leitor`, não exposto aqui).
 *
 * Não há convite nem verificação por e-mail: `email_confirm: true` marca o
 * endereço como confirmado no ato, então a pessoa entra com as credenciais
 * assim que o admin as informa. Usa `clienteAdmin` (secret key) porque criar
 * usuário é operação da Auth Admin API, que não existe pela chave anon.
 *
 * Quando o e-mail já tem conta, a senha digitada é ignorada de propósito:
 * sem isso, o admin de uma empresa poderia redefinir a senha de alguém que
 * também trabalha em outra. Nesse caso só cria o vínculo, e avisa.
 */
export async function criarAcessoUsuario(dados: {
  empresaId: string;
  email: string;
  senha: string;
  papel: "admin" | "membro";
}): Promise<ResultadoComAviso> {
  await verificarSessao();

  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === dados.empresaId);
  if (!empresa || empresa.papel !== "admin") {
    return { erro: "Só administradores podem criar acessos para a empresa." };
  }

  const email = dados.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { erro: "Informe um e-mail válido." };

  const papel = dados.papel === "admin" ? "admin" : "editor";
  const admin = clienteAdmin();

  const { data: perfilExistente } = await admin
    .from("perfis")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let userId = perfilExistente?.id ?? null;
  let aviso: string | undefined;

  if (userId) {
    aviso =
      "Já havia uma conta com este e-mail. Ela foi vinculada a esta empresa e a senha informada foi ignorada.";
  } else {
    if (dados.senha.length < SENHA_MINIMA) {
      return { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` };
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: dados.senha,
      email_confirm: true,
    });

    if (error || !data.user) {
      // Repassa o texto do Supabase: ele diz qual regra falhou (senha fraca,
      // e-mail já registrado no Auth), o que uma mensagem genérica esconderia.
      return { erro: error?.message ?? "Não foi possível criar o acesso." };
    }
    userId = data.user.id;
  }

  // Vínculo gravado pela sessão de quem cria, não pelo cliente admin — é o RLS
  // (`membros_admin`) que garante, como segunda barreira, que só um admin
  // desta empresa grava aqui.
  const supabase = await criarClienteServidor();
  const { error: erroMembro } = await supabase.from("membros").upsert(
    { empresa_id: dados.empresaId, user_id: userId, papel, status: "ativo" },
    { onConflict: "empresa_id,user_id" },
  );

  if (erroMembro) return { erro: "Acesso criado, mas não foi possível vincular à empresa." };

  revalidatePath("/usuarios");
  return { aviso };
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

  // A empresa vem do seletor, não de `empresaAtual(undefined)` — este último
  // cai na primeira empresa da lista, que para o admin da Proos é sempre a
  // própria Proos. A automação precisa nascer na empresa que está na tela,
  // que é como a Proos cria automação para um cliente.
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };

  await exigirAdminPlataforma();

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
  await exigirAdminPlataforma();

  // Escopo é o conjunto de empresas alcançáveis, não uma só: a Proos
  // administra automação de qualquer cliente, e a listagem agregada mostra
  // todas juntas. O filtro segue redundante com o RLS de propósito — se a
  // policy mudar por engano, a consulta ainda não alcança outro tenant.
  const idsPermitidos = (await empresasDoUsuario()).map((e) => e.id);

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("automacoes")
    .delete()
    .eq("id", automacaoId)
    .in("empresa_id", idsPermitidos);

  if (error) return { erro: "Não foi possível excluir a automação." };

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  return {};
}

export async function alterarStatusAutomacao(
  automacaoId: string,
  status: StatusAutomacao,
): Promise<Resultado> {
  await exigirAdminPlataforma();

  // Ver `excluirAutomacao`: o alvo pode ser a automação de qualquer cliente.
  const idsPermitidos = (await empresasDoUsuario()).map((e) => e.id);

  const supabase = await criarClienteServidor();

  // Ativar coloca na agenda; pausar tira. Sem isto uma automação pausada
  // continuaria vencida e o dispatcher a redisparia ao ser reativada.
  const { data: atual } = await supabase
    .from("automacoes")
    .select("tipo, config")
    .eq("id", automacaoId)
    .in("empresa_id", idsPermitidos)
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
    .in("empresa_id", idsPermitidos);

  if (error) return { erro: "Não foi possível alterar o status." };

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  return {};
}

/**
 * Cadastra uma credencial da empresa selecionada.
 *
 * O valor vai para `acessos_chaves_segredo`, que não tem policy de SELECT: nem
 * quem cadastrou o lê de volta pela API. Para trocar uma chave, exclui-se e
 * cadastra-se de novo — não há edição de valor de propósito.
 */
export async function criarChave(dados: {
  nome: string;
  descricao: string;
  valor: string;
}): Promise<Resultado> {
  const { userId } = await verificarSessao();

  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };

  await exigirPermissaoDeEscrita(empresa.id);

  const nome = dados.nome.trim();
  // Espaço em volta de chave colada é acidente de cópia, não parte do segredo.
  const valor = dados.valor.trim();
  if (!nome) return { erro: "Informe o nome da chave." };
  if (!valor) return { erro: "Informe o valor da chave." };

  const supabase = await criarClienteServidor();

  const { data: chave, error } = await supabase
    .from("acessos_chaves")
    .insert({
      empresa_id: empresa.id,
      nome,
      descricao: dados.descricao.trim(),
      criado_por: userId,
    })
    .select("id")
    .single();

  if (error || !chave) {
    // 23505 = unique_violation: o índice por (empresa, lower(nome)).
    if (error?.code === "23505") {
      return { erro: "Já existe uma chave com esse nome nesta empresa." };
    }
    return { erro: "Não foi possível cadastrar a chave." };
  }

  const { error: erroValor } = await supabase
    .from("acessos_chaves_segredo")
    .insert({ chave_id: chave.id, empresa_id: empresa.id, valor });

  if (erroValor) {
    // Sem valor a chave não serve para nada, e ficaria na lista aparentando
    // estar configurada. Desfaz em vez de deixar o registro órfão.
    await supabase.from("acessos_chaves").delete().eq("id", chave.id);
    return { erro: "Não foi possível guardar o valor da chave." };
  }

  revalidatePath("/acessos");
  return {};
}

export async function excluirChave(chaveId: string): Promise<Resultado> {
  await verificarSessao();

  // Só empresas onde a pessoa escreve — o filtro é redundante com o RLS de
  // propósito, para a consulta não alcançar outro tenant se a policy mudar.
  const idsPermitidos = (await empresasDoUsuario())
    .filter((e) => e.papel !== "leitor")
    .map((e) => e.id);

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("acessos_chaves")
    .delete()
    .eq("id", chaveId)
    .in("empresa_id", idsPermitidos);

  if (error) return { erro: "Não foi possível excluir a chave." };

  revalidatePath("/acessos");
  return {};
}
