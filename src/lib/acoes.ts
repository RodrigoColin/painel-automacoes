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
import { descobrirAgora } from "@/lib/n8n-descoberta";
import { testarConexao } from "@/lib/executores/n8n-sincronizacao";
import {
  gravarSegredos,
  testarConexao as testarConexaoInfisical,
  variaveisFaltando as variaveisFaltandoInfisical,
} from "@/lib/infisical/api";
import { garantirPastaCliente, lerConfiguracaoInfisical } from "@/lib/infisical/clientes";
import { testarChavesOmie } from "@/lib/omie/cliente";
import { sincronizarFaturamentoOmie } from "@/lib/omie/sincronizacao";
import {
  descartarResumoOmie,
  idadeResumoOmie,
  INTERVALO_MINIMO_ATUALIZAR_MS,
  SEGREDO_APP_KEY,
  SEGREDO_APP_SECRET,
} from "@/lib/omie/resumo";
import type { Json } from "@/lib/supabase/tipos-banco";
import {
  BUCKET_SCRIPTS,
  TAMANHO_MAXIMO_SCRIPT,
  validarCron,
  type ConfigAutomacao,
  type ConfigPythonCron,
} from "@/lib/automacao-tipos";
import {
  BUCKET_LOGOS,
  EXTENSAO_POR_TIPO,
  TAMANHO_MAXIMO_LOGO,
} from "@/lib/logo-empresa";
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

  // Pasta do cliente no Infisical já nasce junto. Se o Infisical não estiver
  // configurado ou falhar, a empresa fica criada assim mesmo — a pasta pode
  // ser criada depois em Configurações → Clientes.
  const config = await lerConfiguracaoInfisical(supabase);
  if (config && variaveisFaltandoInfisical().length === 0) {
    await garantirPastaCliente(supabase, config, { id, nome }).catch(() => undefined);
  }

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

/* -------------------------------- Logo ---------------------------------- */

/**
 * Devolve o caminho no bucket a partir da URL pública guardada em
 * `empresas.logo_url` — é o que permite apagar a imagem antiga. Uma URL de
 * outro formato (ou de outro bucket) devolve `null` e o arquivo fica; melhor
 * deixar lixo do que tentar apagar um caminho adivinhado.
 */
function caminhoDaLogo(url: string | null): string | null {
  if (!url) return null;
  const marca = `/storage/v1/object/public/${BUCKET_LOGOS}/`;
  const corte = url.indexOf(marca);
  return corte === -1 ? null : decodeURIComponent(url.slice(corte + marca.length));
}

/**
 * Troca a logo da empresa. Cada envio grava um arquivo com nome novo e só
 * então apaga o anterior: se a gravação falhar, a logo que está no ar
 * continua valendo, e o nome novo evita a imagem velha presa no cache da CDN.
 */
export async function atualizarLogoEmpresa(dados: FormData): Promise<Resultado> {
  await verificarSessao();

  const empresaId = String(dados.get("empresaId") ?? "");
  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === empresaId);
  if (!empresa || empresa.papel === "leitor") {
    return { erro: "Sem permissão para alterar a logo desta empresa." };
  }

  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Escolha uma imagem." };
  }
  const extensao = EXTENSAO_POR_TIPO[arquivo.type];
  if (!extensao) return { erro: "Use uma imagem PNG, JPG, WEBP ou SVG." };
  if (arquivo.size > TAMANHO_MAXIMO_LOGO) {
    return { erro: "A imagem passa do limite de 512 KB." };
  }

  const caminho = `${empresaId}/${crypto.randomUUID()}.${extensao}`;
  const supabase = await criarClienteServidor();

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_LOGOS)
    .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });

  if (erroUpload) return { erro: "Não foi possível enviar a imagem." };

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET_LOGOS).getPublicUrl(caminho);

  const { error } = await supabase
    .from("empresas")
    .update({ logo_url: publicUrl })
    .eq("id", empresaId);

  if (error) {
    await supabase.storage.from(BUCKET_LOGOS).remove([caminho]);
    return { erro: "Não foi possível salvar a logo." };
  }

  const anterior = caminhoDaLogo(empresa.logo_url);
  if (anterior && anterior !== caminho) {
    await supabase.storage.from(BUCKET_LOGOS).remove([anterior]);
  }

  revalidatePath("/", "layout");
  return {};
}

/** Volta a empresa a exibir as iniciais do nome. */
export async function removerLogoEmpresa(empresaId: string): Promise<Resultado> {
  await verificarSessao();

  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === empresaId);
  if (!empresa || empresa.papel === "leitor") {
    return { erro: "Sem permissão para alterar a logo desta empresa." };
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase
    .from("empresas")
    .update({ logo_url: null })
    .eq("id", empresaId);

  if (error) return { erro: "Não foi possível remover a logo." };

  const caminho = caminhoDaLogo(empresa.logo_url);
  if (caminho) await supabase.storage.from(BUCKET_LOGOS).remove([caminho]);

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
 * Configura o uso do Infisical pela plataforma — só admin da Proos.
 *
 * As credenciais não passam por aqui: vêm das variáveis de ambiente
 * (`lib/infisical/api.ts`). A tela só escolhe projeto, ambiente, a pasta raiz
 * onde o app cria uma pasta por cliente e as preferências de execução. Antes
 * de gravar, confere que as credenciais do ambiente enxergam esse projeto e
 * ambiente.
 */
export async function salvarConfiguracaoInfisical(dados: {
  projetoId: string;
  ambiente: string;
  pastaRaiz: string;
  injetarSegredos: boolean;
  mascararValores: boolean;
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Proos podem alterar essa integração." };
  }

  const faltando = variaveisFaltandoInfisical();
  if (faltando.length > 0) {
    return { erro: `Configure antes as variáveis de ambiente: ${faltando.join(", ")}.` };
  }

  const projetoId = dados.projetoId.trim();
  if (!projetoId) return { erro: "Informe o ID do projeto." };
  const ambiente = dados.ambiente.trim() || "prod";
  const pastaRaiz = `/${dados.pastaRaiz.trim().replace(/^\/+|\/+$/g, "")}`;
  if (!/^\/[A-Za-z0-9_/-]*$/.test(pastaRaiz) || pastaRaiz.includes("//")) {
    return { erro: "A pasta raiz aceita só letras, números, - e _, separados por /." };
  }

  try {
    await testarConexaoInfisical(projetoId, ambiente);
  } catch (erro) {
    return { erro: `O Infisical recusou a conexão: ${erro instanceof Error ? erro.message : String(erro)}` };
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("integracao_infisical_plataforma").upsert(
    {
      id: true,
      projeto_id: projetoId,
      ambiente,
      pasta_raiz: pastaRaiz,
      injetar_segredos: dados.injetarSegredos,
      mascarar_valores: dados.mascararValores,
    },
    { onConflict: "id" },
  );

  if (error) return { erro: "Não foi possível salvar a configuração." };

  revalidatePath("/configuracoes");
  revalidatePath("/omie");
  return {};
}

/**
 * Cria no Infisical a pasta de uma empresa cliente e grava o caminho — só
 * admin da Proos. Chamar de novo numa empresa que já tem pasta só confere que
 * ela continua existindo.
 */
export async function criarPastaInfisicalCliente(empresaId: string): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Proos podem criar pastas de clientes." };
  }

  const empresa = (await empresasDoUsuario()).find((e) => e.id === empresaId);
  if (!empresa || empresa.eh_plataforma) return { erro: "Empresa cliente não encontrada." };

  const supabase = await criarClienteServidor();
  const config = await lerConfiguracaoInfisical(supabase);
  if (!config) return { erro: "Configure o Infisical antes de criar pastas." };

  try {
    await garantirPastaCliente(supabase, config, empresa);
  } catch (erro) {
    return { erro: `Não foi possível criar a pasta: ${erro instanceof Error ? erro.message : String(erro)}` };
  }

  revalidatePath("/configuracoes");
  revalidatePath("/omie");
  return {};
}

/**
 * Grava as chaves do Omie de uma empresa cliente no Infisical, na pasta dela
 * (criada na hora, se ainda não existir) — só admin da Proos.
 *
 * Testa as chaves no Omie antes de gravar: chave colada errada é o erro mais
 * provável, e descobrir isso só ao abrir o resumo seria tarde demais.
 */
export async function salvarChavesOmie(dados: {
  empresaId: string;
  appKey: string;
  appSecret: string;
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Proos podem cadastrar as chaves do Omie." };
  }

  const empresa = (await empresasDoUsuario()).find((e) => e.id === dados.empresaId);
  if (!empresa || empresa.eh_plataforma) return { erro: "Empresa cliente não encontrada." };

  const appKey = dados.appKey.trim();
  const appSecret = dados.appSecret.trim();
  if (!appKey || !appSecret) return { erro: "Informe a App Key e o App Secret." };

  const supabase = await criarClienteServidor();
  const config = await lerConfiguracaoInfisical(supabase);
  if (!config || variaveisFaltandoInfisical().length > 0) {
    return { erro: "O Infisical ainda não está configurado." };
  }

  const teste = await testarChavesOmie({ appKey, appSecret });
  if (teste) return { erro: teste };

  try {
    const local = await garantirPastaCliente(supabase, config, empresa);
    await gravarSegredos(local, { [SEGREDO_APP_KEY]: appKey, [SEGREDO_APP_SECRET]: appSecret });
  } catch (erro) {
    return {
      erro: `As chaves são válidas, mas não foi possível gravá-las no Infisical: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    };
  }

  descartarResumoOmie(empresa.id);
  revalidatePath("/omie");
  revalidatePath("/configuracoes");
  return {};
}

export async function criarAutomacao(dados: FormData): Promise<Resultado> {
  await verificarSessao();

  // A empresa vem do seletor, não de `empresaAtual(undefined)` — este último
  // cai na primeira empresa da lista, que para o admin da Proos é sempre a
  // própria Proos. A automação precisa nascer na empresa que está na tela,
  // que é como a Proos cria automação para um cliente.
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa) return { erro: "Nenhuma empresa selecionada." };

  await exigirAdminPlataforma();

  // O formulário já valida tudo isto, mas a action é um endpoint público:
  // não dá para confiar no que o navegador mandou.
  const nome = String(dados.get("nome") ?? "").trim();
  const descricao = String(dados.get("descricao") ?? "").trim() || "Sem descrição.";
  const cron = String(dados.get("cron") ?? "").trim();
  const timeoutSegundos = Number(dados.get("timeoutSegundos"));
  const tentativas = Number(dados.get("tentativas"));
  const arquivo = dados.get("arquivo");

  if (!nome) return { erro: "Informe o nome da automação." };
  const erroCron = validarCron(cron);
  if (erroCron) return { erro: erroCron };
  if (!Number.isInteger(timeoutSegundos) || timeoutSegundos < 1) {
    return { erro: "O tempo limite precisa ser de pelo menos 1 segundo." };
  }
  if (!Number.isInteger(tentativas) || tentativas < 0) {
    return { erro: "Número de tentativas inválido." };
  }
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: "Envie o arquivo Python que será executado." };
  }
  if (!arquivo.name.toLowerCase().endsWith(".py")) {
    return { erro: "O arquivo precisa ter extensão .py." };
  }
  if (arquivo.size > TAMANHO_MAXIMO_SCRIPT) {
    return { erro: "O arquivo passa do limite de 1 MB." };
  }

  const automacaoId = crypto.randomUUID();
  // Nome vira parte da chave no Storage: só caracteres seguros.
  const nomeArquivo = arquivo.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const caminho = `${automacaoId}/${nomeArquivo}`;

  // Cliente da sessão: as policies do bucket só deixam admin da Proos gravar,
  // a mesma regra de `automacoes_escrita`.
  const supabase = await criarClienteServidor();
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_SCRIPTS)
    .upload(caminho, arquivo, { contentType: "text/x-python", upsert: false });

  if (erroUpload) return { erro: "Não foi possível enviar o arquivo." };

  const config: ConfigPythonCron = {
    cron,
    arquivo: { caminho, nome: arquivo.name, tamanhoBytes: arquivo.size },
    timeoutSegundos,
    tentativas,
  };

  const proxima = proximaExecucao({ tipo: "python-cron", config });

  const { error } = await supabase.from("automacoes").insert({
    id: automacaoId,
    empresa_id: empresa.id,
    nome,
    descricao,
    status: "ativa",
    tipo: "python-cron",
    config: config as unknown as Json,
    proxima_execucao: proxima?.toISOString() ?? null,
  });

  if (error) {
    await supabase.storage.from(BUCKET_SCRIPTS).remove([caminho]);
    return { erro: "Não foi possível criar a automação." };
  }

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  return {};
}

/**
 * Força uma consulta nova ao Omie para a empresa selecionada, descartando o
 * resumo guardado. Qualquer pessoa da empresa pode — é só leitura.
 *
 * Se a última consulta foi há menos de um minuto, não descarta nada e devolve
 * quanto falta: repetir a chamada tão cedo faria o Omie recusá-la.
 */
export async function atualizarResumoOmie(): Promise<Resultado & { esperarSegundos?: number }> {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa || empresa.eh_plataforma) return { erro: "Selecione uma empresa cliente." };

  const idade = idadeResumoOmie(empresa.id);
  if (idade !== null && idade < INTERVALO_MINIMO_ATUALIZAR_MS) {
    return { esperarSegundos: Math.ceil((INTERVALO_MINIMO_ATUALIZAR_MS - idade) / 1000) };
  }

  descartarResumoOmie(empresa.id);
  revalidatePath("/omie");
  return {};
}

/**
 * Sincroniza o faturamento do Omie da empresa selecionada: mês corrente e
 * anterior (ou os 13 meses, na primeira vez). Qualquer pessoa da empresa
 * pode — só lê do Omie; a gravação é do servidor.
 *
 * Mesmo intervalo mínimo do resumo financeiro, contado do fim da última
 * sincronização, para cliques seguidos não repetirem as mesmas chamadas.
 */
export async function atualizarFaturamentoOmie(): Promise<Resultado & { esperarSegundos?: number }> {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa || empresa.eh_plataforma) return { erro: "Selecione uma empresa cliente." };

  const supabase = await criarClienteServidor();
  const { data: estado } = await supabase
    .from("omie_sincronizacao")
    .select("concluida_em")
    .eq("empresa_id", empresa.id)
    .maybeSingle();
  const idade = estado?.concluida_em ? Date.now() - Date.parse(estado.concluida_em) : null;
  if (idade !== null && idade < INTERVALO_MINIMO_ATUALIZAR_MS) {
    return { esperarSegundos: Math.ceil((INTERVALO_MINIMO_ATUALIZAR_MS - idade) / 1000) };
  }

  const resultado = await sincronizarFaturamentoOmie(empresa.id);
  revalidatePath("/omie");

  switch (resultado.estado) {
    case "ok":
      return {};
    case "em-andamento":
      return { erro: "Já existe uma sincronização em andamento. Tente de novo em alguns minutos." };
    case "sem-chaves":
      return { erro: "As chaves do Omie deste cliente não estão configuradas." };
    case "erro":
      return { erro: resultado.mensagem };
  }
}

export async function excluirAutomacao(automacaoId: string): Promise<Resultado> {
  await exigirAdminPlataforma();

  // Escopo é o conjunto de empresas alcançáveis, não uma só: a Proos
  // administra automação de qualquer cliente, e a listagem agregada mostra
  // todas juntas. O filtro segue redundante com o RLS de propósito — se a
  // policy mudar por engano, a consulta ainda não alcança outro tenant.
  const idsPermitidos = (await empresasDoUsuario()).map((e) => e.id);

  const supabase = await criarClienteServidor();
  const { data: excluidas, error } = await supabase
    .from("automacoes")
    .delete()
    .eq("id", automacaoId)
    .in("empresa_id", idsPermitidos)
    .select("tipo, config");

  if (error) return { erro: "Não foi possível excluir a automação." };

  // O script some junto. Falha aqui não desfaz a exclusão: sobra só um
  // objeto órfão num bucket privado, sem nada apontando para ele.
  const caminhos = (excluidas ?? [])
    .filter((linha) => linha.tipo === "python-cron")
    .map((linha) => (linha.config as unknown as Partial<ConfigPythonCron>).arquivo?.caminho)
    .filter((caminho): caminho is string => Boolean(caminho));
  if (caminhos.length > 0) {
    await supabase.storage.from(BUCKET_SCRIPTS).remove(caminhos);
  }

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
 * Busca no n8n agora, sem esperar a rodada do cron.
 *
 * Só descobre automações; o histórico de execuções continua a cargo da
 * sincronização de cinco em cinco minutos. Quem acabou de criar um workflow
 * quer vê-lo na lista para vincular — não quer esperar as execuções.
 */
export async function atualizarAutomacoesDoN8n(): Promise<ResultadoComAviso> {
  await exigirAdminPlataforma();

  const resultado = await descobrirAgora();
  if ("erro" in resultado) return { erro: resultado.erro };

  revalidatePath("/automacoes/vinculos");
  revalidatePath("/automacoes");

  const partes: string[] = [];
  if (resultado.novas > 0) partes.push(`${resultado.novas} nova(s)`);
  if (resultado.renomeados > 0) partes.push(`${resultado.renomeados} renomeada(s)`);

  return {
    aviso:
      partes.length > 0
        ? `Atualizado: ${partes.join(", ")}.`
        : "Nenhuma novidade no n8n.",
  };
}

/**
 * Reatribui uma automação a outra empresa.
 *
 * O histórico vai junto: execuções, logs e segredos mudam de dono na mesma
 * transação, dentro de `public.vincular_automacao`. Ficar pela metade deixaria
 * a automação numa empresa e o histórico em outra, e o RLS esconderia partes
 * do registro dos dois lados.
 */
export async function vincularAutomacao(dados: {
  automacaoId: string;
  empresaId: string;
}): Promise<Resultado> {
  await exigirAdminPlataforma();

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("vincular_automacao", {
    automacao: dados.automacaoId,
    empresa: dados.empresaId,
  });

  if (error) return { erro: "Não foi possível vincular a automação." };

  // O vínculo muda o que cada empresa enxerga em praticamente toda tela.
  revalidatePath("/automacoes/vinculos");
  revalidatePath("/automacoes");
  revalidatePath("/historico");
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
