"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { codigoErro, db } from "@/lib/db";
import {
  acessosChaves,
  acessosChavesSegredo,
  automacoes,
  empresas as tabelaEmpresas,
  fluxoCaixaConfig,
  integracaoInfisical,
  integracaoN8n,
  integracaoN8nSegredo,
  membros,
  omieSincronizacao,
  perfis,
  recorrenciaConfig,
  telasEmpresa,
  usuarios,
} from "@/lib/db/schema";
import { TELAS, type NivelTela } from "@/lib/telas";
import { SENHA_MINIMA } from "@/lib/auth/constantes";
import { encerrarSessoesDe, gerarHashSenha } from "@/lib/auth/sessao";
import {
  caminhoDaUrlLogo,
  removerArquivos,
  salvarArquivo,
  urlPublicaLogo,
} from "@/lib/armazenamento";
import {
  empresaAtual,
  empresasDoUsuario,
  exigirAdminPlataforma,
  exigirPermissaoDeEscrita,
  naSessao,
  souAdminPlataforma,
  verificarSessao,
} from "@/lib/dal";
import { gravarEmpresaSelecionada, lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { proximaExecucao } from "@/lib/agendamento";
import { descobrirAgora } from "@/lib/n8n-descoberta";
import { testarConexao } from "@/lib/executores/n8n-sincronizacao";
import {
  gravarSegredos,
  removerSegredos,
  testarConexao as testarConexaoInfisical,
  variaveisFaltando as variaveisFaltandoInfisical,
} from "@/lib/infisical/api";
import { garantirPastaCliente, lerConfiguracaoInfisical } from "@/lib/infisical/clientes";
import { testarChavesOmie } from "@/lib/omie/cliente";
import { sincronizarFaturamentoOmie } from "@/lib/omie/sincronizacao";
import { descartarCache } from "@/lib/cache-externo";
import {
  descartarChavesOmie,
  idadeResumoOmie,
  obterResumoOmie,
  INTERVALO_MINIMO_ATUALIZAR_MS,
  SEGREDO_APP_KEY,
  SEGREDO_APP_SECRET,
} from "@/lib/omie/resumo";
import type { ConfigConta, TipoConta } from "@/lib/omie/fluxo-caixa";
import { enfileirarRodadas } from "@/lib/fluxo-caixa/dados";
import { GRUPOS_FLUXO } from "@/lib/fluxo-caixa/grupos";
import type { LinhaReceita } from "@/lib/fluxo-caixa/tipos";
import {
  TAMANHO_MAXIMO_SCRIPT,
  validarCron,
  type ConfigAutomacao,
  type ConfigPythonCron,
} from "@/lib/automacao-tipos";
import { EXTENSAO_POR_TIPO, TAMANHO_MAXIMO_LOGO } from "@/lib/logo-empresa";
import type { StatusAutomacao } from "@/lib/tipos";

export type Resultado = { erro?: string };

/** Sucesso com ressalva: a operação valeu, mas não exatamente como pedido. */
export type ResultadoComAviso = Resultado & { aviso?: string };

/**
 * Grava a linha única (`id = true`) da tabela de segredo do n8n de
 * plataforma.
 *
 * Pela conexão do app, fora do RLS, de propósito: a tabela não tem policy de
 * SELECT (ninguém lê o segredo de volta pela sessão), e sem ela o Postgres
 * não deixa a sessão nem fazer upsert nem atualizar com `WHERE` — o UPDATE
 * passava sem erro e sem mudar linha nenhuma, então trocar a chave pela tela
 * nunca funcionou. Quem chama já conferiu que é admin da Proos.
 */
async function gravarSegredoN8n(apiKey: string): Promise<string | null> {
  const atualizado_em = new Date().toISOString();

  try {
    await db
      .insert(integracaoN8nSegredo)
      .values({ id: true, api_key: apiKey, atualizado_em })
      .onConflictDoUpdate({ target: integracaoN8nSegredo.id, set: { api_key: apiKey, atualizado_em } });
    return null;
  } catch (erro) {
    return mensagemDe(erro);
  }
}

function mensagemDe(erro: unknown) {
  return erro instanceof Error ? erro.message : String(erro);
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
 * Libera ou esconde uma tela de uma empresa cliente para um nível de acesso
 * (interno = equipe Proos, externo = pessoas do cliente). Só admin da
 * plataforma; o RLS não tem policy de escrita, então a checagem daqui é a
 * que vale.
 */
export async function salvarTelaEmpresa(
  empresaId: string,
  tela: string,
  nivel: NivelTela,
  ativo: boolean,
): Promise<Resultado> {
  if (!(await souAdminPlataforma())) return { erro: "Só administradores da Proos configuram telas." };
  if (!TELAS.some((item) => item.chave === tela)) return { erro: "Tela desconhecida." };
  if (nivel !== "interno" && nivel !== "externo") return { erro: "Nível desconhecido." };

  const [empresa] = await db
    .select({ ehPlataforma: tabelaEmpresas.eh_plataforma })
    .from(tabelaEmpresas)
    .where(eq(tabelaEmpresas.id, empresaId))
    .limit(1);
  if (!empresa) return { erro: "Empresa não encontrada." };
  if (empresa.ehPlataforma) return { erro: "A empresa principal não tem telas configuráveis." };

  await db
    .insert(telasEmpresa)
    .values({ empresa_id: empresaId, tela, [nivel]: ativo })
    .onConflictDoUpdate({
      target: [telasEmpresa.empresa_id, telasEmpresa.tela],
      set: { [nivel]: ativo, atualizado_em: sql`now()` },
    });

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

  // Gera o id em vez de ler de volta com RETURNING: a policy de SELECT de
  // `empresas` depende de `eh_admin_plataforma()`, que consulta a própria
  // tabela `empresas` — nessa combinação, o Postgres recusa o RETURNING de
  // colunas reais mesmo a inserção tendo sido aceita. Sem pedir colunas de
  // volta, o INSERT não esbarra nisso.
  const id = crypto.randomUUID();
  try {
    await naSessao((tx) => tx.insert(tabelaEmpresas).values({ id, nome }));
  } catch {
    return { erro: "Não foi possível cadastrar a empresa." };
  }

  // Quem cria entra como admin — sem isso ninguém enxergaria a empresa criada,
  // já que toda leitura passa pelo vínculo em `membros`.
  try {
    await naSessao((tx) =>
      tx.insert(membros).values({ empresa_id: id, user_id: userId, papel: "admin", status: "ativo" }),
    );
  } catch {
    return { erro: "Empresa criada, mas o acesso falhou." };
  }

  // Pasta do cliente no Infisical já nasce junto. Se o Infisical não estiver
  // configurado ou falhar, a empresa fica criada assim mesmo — a pasta pode
  // ser criada depois em Configurações → Clientes.
  const config = await naSessao((tx) => lerConfiguracaoInfisical(tx));
  if (config && variaveisFaltandoInfisical().length === 0) {
    await naSessao((tx) => garantirPastaCliente(tx, config, { id, nome })).catch(() => undefined);
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

  try {
    await naSessao((tx) => tx.update(tabelaEmpresas).set({ nome }).where(eq(tabelaEmpresas.id, dados.empresaId)));
  } catch {
    return { erro: "Não foi possível salvar o nome." };
  }

  revalidatePath("/", "layout");
  return {};
}

/* -------------------------------- Logo ---------------------------------- */

/**
 * Troca a logo da empresa. Cada envio grava um arquivo com nome novo e só
 * então apaga o anterior: se a gravação falhar, a logo que está no ar
 * continua valendo, e o nome novo evita a imagem velha presa no cache do
 * navegador.
 *
 * O arquivo vai para o disco sem passar por policy — a permissão é a checagem
 * de papel logo abaixo, a mesma regra (`pode_escrever`) que o bucket aplicava.
 * Uma URL em `logo_url` de formato desconhecido não é apagada: melhor deixar
 * lixo do que tentar apagar um caminho adivinhado.
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

  try {
    await salvarArquivo("logos-empresa", caminho, arquivo);
  } catch {
    return { erro: "Não foi possível enviar a imagem." };
  }

  try {
    await naSessao((tx) =>
      tx.update(tabelaEmpresas).set({ logo_url: urlPublicaLogo(caminho) }).where(eq(tabelaEmpresas.id, empresaId)),
    );
  } catch {
    await removerArquivos("logos-empresa", [caminho]);
    return { erro: "Não foi possível salvar a logo." };
  }

  const anterior = caminhoDaUrlLogo(empresa.logo_url);
  if (anterior && anterior !== caminho) {
    await removerArquivos("logos-empresa", [anterior]);
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

  try {
    await naSessao((tx) => tx.update(tabelaEmpresas).set({ logo_url: null }).where(eq(tabelaEmpresas.id, empresaId)));
  } catch {
    return { erro: "Não foi possível remover a logo." };
  }

  const caminho = caminhoDaUrlLogo(empresa.logo_url);
  if (caminho) await removerArquivos("logos-empresa", [caminho]);

  revalidatePath("/", "layout");
  return {};
}

/**
 * Cria um acesso ao painel com e-mail e senha, já ativo — só quem é admin da
 * empresa cria, e só como "admin" ou "membro" (o enum tem um terceiro papel,
 * `leitor`, não exposto aqui).
 *
 * Não há convite nem verificação por e-mail: a pessoa entra com as
 * credenciais assim que o admin as informa. A conta (`auth.usuarios`) é
 * gravada pela conexão do app, fora do RLS — a sessão de quem cria não
 * alcança o schema `auth`, de propósito.
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

  const papel: "admin" | "editor" = dados.papel === "admin" ? "admin" : "editor";

  const [perfilExistente] = await db
    .select({ id: perfis.id })
    .from(perfis)
    .where(eq(sql`lower(${perfis.email})`, email))
    .limit(1);

  let userId = perfilExistente?.id ?? null;
  let aviso: string | undefined;

  if (userId) {
    aviso =
      "Já havia uma conta com este e-mail. Ela foi vinculada a esta empresa e a senha informada foi ignorada.";
  } else {
    if (dados.senha.length < SENHA_MINIMA) {
      return { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` };
    }

    const novoId = crypto.randomUUID();
    const senhaHash = await gerarHashSenha(dados.senha);
    try {
      // Conta e perfil juntos: um sem o outro deixaria um login que não
      // aparece em lugar nenhum, ou um perfil sem como entrar.
      await db.transaction(async (tx) => {
        await tx.insert(usuarios).values({ id: novoId, email, senhaHash });
        await tx.insert(perfis).values({ id: novoId, email });
      });
    } catch (erro) {
      return {
        erro:
          codigoErro(erro) === "23505"
            ? "Já existe uma conta com este e-mail."
            : "Não foi possível criar o acesso.",
      };
    }
    userId = novoId;
  }

  // Vínculo gravado pela sessão de quem cria, não pela conexão do app — é o
  // RLS (`membros_admin`) que garante, como segunda barreira, que só um admin
  // desta empresa grava aqui.
  const vinculo = { empresa_id: dados.empresaId, user_id: userId, papel, status: "ativo" as const };
  try {
    await naSessao((tx) =>
      tx
        .insert(membros)
        .values(vinculo)
        .onConflictDoUpdate({
          target: [membros.empresa_id, membros.user_id],
          set: { papel: vinculo.papel, status: vinculo.status },
        }),
    );
  } catch {
    return { erro: "Acesso criado, mas não foi possível vincular à empresa." };
  }

  revalidatePath("/usuarios");
  return { aviso };
}

/**
 * Confere que quem chamou administra a empresa e que o alvo é mesmo membro
 * dela — as duas coisas, sempre. Só a primeira deixaria um admin editar
 * qualquer conta do sistema mandando um `userId` de outra empresa.
 *
 * A checagem do vínculo passa pela conexão do app de propósito: o RLS
 * esconderia a linha e um alvo legítimo pareceria inexistente em consultas
 * feitas pela sessão quando o papel de quem olha não alcança a linha.
 */
async function exigirAdminSobreUsuario(
  empresaId: string,
  userId: string,
): Promise<{ erro: string } | { papelAlvo: string }> {
  await verificarSessao();

  const empresas = await empresasDoUsuario();
  const empresa = empresas.find((item) => item.id === empresaId);
  if (!empresa || empresa.papel !== "admin") {
    return { erro: "Só administradores podem gerenciar os usuários da empresa." };
  }
  if (!userId) return { erro: "Usuário não informado." };

  const [vinculo] = await db
    .select({ papel: membros.papel })
    .from(membros)
    .where(and(eq(membros.empresa_id, empresaId), eq(membros.user_id, userId)))
    .limit(1);

  if (!vinculo) return { erro: "Esta pessoa não tem acesso a esta empresa." };

  return { papelAlvo: vinculo.papel };
}

/** Em quantas empresas a pessoa trabalha. Conta pela conexão do app: o RLS só
 *  mostraria as empresas de quem está perguntando. */
async function quantasEmpresas(userId: string): Promise<number> {
  const [linha] = await db.select({ total: count() }).from(membros).where(eq(membros.user_id, userId));
  return linha?.total ?? 0;
}

/**
 * Altera os dados de acesso de outra pessoa: o nome exibido e, opcionalmente,
 * a senha. Só admin da empresa, e só sobre quem é membro dela.
 *
 * A senha só pode ser trocada quando a pessoa trabalha **somente** nesta
 * empresa — é a mesma regra que `criarAcessoUsuario` já aplica ao ignorar a
 * senha de um e-mail que já tinha conta: o admin de uma empresa não redefine
 * a credencial de quem também entra em outra.
 *
 * Escreve pela conexão do app porque as duas operações estão fora do alcance
 * da sessão: `perfis` só aceita UPDATE da própria linha (`perfis_proprio`) e
 * a senha vive no schema `auth`, que a sessão não enxerga. Trocar a senha
 * derruba as sessões abertas da pessoa — quem estava logado com a senha
 * antiga precisa entrar de novo.
 */
export async function atualizarUsuario(dados: {
  empresaId: string;
  userId: string;
  nome: string;
  novaSenha?: string;
}): Promise<ResultadoComAviso> {
  const permissao = await exigirAdminSobreUsuario(dados.empresaId, dados.userId);
  if ("erro" in permissao) return { erro: permissao.erro };

  const nome = dados.nome.trim();
  if (!nome) return { erro: "Informe o nome da pessoa." };

  const senha = dados.novaSenha?.trim() ?? "";
  let aviso: string | undefined;

  if (senha) {
    if (senha.length < SENHA_MINIMA) {
      return { erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` };
    }
    if ((await quantasEmpresas(dados.userId)) > 1) {
      return {
        erro:
          "Esta pessoa também tem acesso a outra empresa; a senha dela não pode ser trocada por aqui.",
      };
    }

    try {
      await db
        .update(usuarios)
        .set({ senhaHash: await gerarHashSenha(senha), atualizadoEm: new Date().toISOString() })
        .where(eq(usuarios.id, dados.userId));
      await encerrarSessoesDe(dados.userId);
    } catch {
      return { erro: "Não foi possível alterar a senha." };
    }

    aviso = "Senha alterada. Repasse a nova credencial à pessoa — ela não aparece mais aqui.";
  }

  try {
    await db.update(perfis).set({ nome }).where(eq(perfis.id, dados.userId));
  } catch {
    return { erro: "Não foi possível salvar o nome." };
  }

  revalidatePath("/usuarios");
  return { aviso };
}

/**
 * Tira o acesso da pessoa a esta empresa.
 *
 * Some o vínculo, não a conta — a menos que esta fosse a última empresa dela,
 * caso em que a conta também é apagada: um login que não enxerga empresa
 * nenhuma só serviria para ocupar espaço. Apagar a conta leva junto perfil e
 * sessões (cascata), então a pessoa sai na hora.
 *
 * Duas travas: ninguém se exclui (seria sair pela porta e jogar a chave
 * fora) e o último admin da empresa fica, senão ninguém mais administraria
 * usuários lá.
 */
export async function excluirUsuario(dados: {
  empresaId: string;
  userId: string;
}): Promise<ResultadoComAviso> {
  const { userId: eu } = await verificarSessao();
  if (eu === dados.userId) return { erro: "Você não pode excluir o próprio acesso." };

  const permissao = await exigirAdminSobreUsuario(dados.empresaId, dados.userId);
  if ("erro" in permissao) return { erro: permissao.erro };

  if (permissao.papelAlvo === "admin") {
    const [admins] = await db
      .select({ total: count() })
      .from(membros)
      .where(
        and(
          eq(membros.empresa_id, dados.empresaId),
          eq(membros.papel, "admin"),
          eq(membros.status, "ativo"),
        ),
      );

    if ((admins?.total ?? 0) <= 1) {
      return { erro: "Esta empresa ficaria sem administrador. Promova outra pessoa antes." };
    }
  }

  // Exclusão do vínculo pela sessão: o RLS (`membros_admin`) é a segunda
  // barreira, como em `criarAcessoUsuario`.
  try {
    await naSessao((tx) =>
      tx
        .delete(membros)
        .where(and(eq(membros.empresa_id, dados.empresaId), eq(membros.user_id, dados.userId))),
    );
  } catch {
    return { erro: "Não foi possível remover o acesso." };
  }

  let aviso: string | undefined;
  if ((await quantasEmpresas(dados.userId)) === 0) {
    try {
      await db.delete(usuarios).where(eq(usuarios.id, dados.userId));
    } catch {
      aviso = "Acesso removido, mas não foi possível apagar a conta.";
    }
  } else {
    aviso = "Acesso removido desta empresa. A pessoa continua com acesso a outra empresa.";
  }

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

  try {
    await naSessao((tx) =>
      tx
        .insert(integracaoN8n)
        .values({ id: true, instancia_url: url })
        .onConflictDoUpdate({ target: integracaoN8n.id, set: { instancia_url: url } }),
    );
  } catch {
    return { erro: "Não foi possível salvar a URL da instância." };
  }

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
 * onde o app cria uma pasta por cliente. Antes de gravar, confere que as
 * credenciais do ambiente enxergam esse projeto e ambiente.
 */
export async function salvarConfiguracaoInfisical(dados: {
  projetoId: string;
  ambiente: string;
  pastaRaiz: string;
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

  const valores = {
    projeto_id: projetoId,
    ambiente,
    pasta_raiz: pastaRaiz,
  };
  try {
    await naSessao((tx) =>
      tx
        .insert(integracaoInfisical)
        .values({ id: true, ...valores })
        .onConflictDoUpdate({ target: integracaoInfisical.id, set: valores }),
    );
  } catch {
    return { erro: "Não foi possível salvar a configuração." };
  }

  descartarChavesOmie();
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

  const config = await naSessao((tx) => lerConfiguracaoInfisical(tx));
  if (!config) return { erro: "Configure o Infisical antes de criar pastas." };

  try {
    await naSessao((tx) => garantirPastaCliente(tx, config, empresa));
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

  const config = await naSessao((tx) => lerConfiguracaoInfisical(tx));
  if (!config || variaveisFaltandoInfisical().length > 0) {
    return { erro: "O Infisical ainda não está configurado." };
  }

  const teste = await testarChavesOmie({ appKey, appSecret });
  if (teste) return { erro: teste };

  try {
    const local = await naSessao((tx) => garantirPastaCliente(tx, config, empresa));
    await gravarSegredos(local, { [SEGREDO_APP_KEY]: appKey, [SEGREDO_APP_SECRET]: appSecret });
  } catch (erro) {
    return {
      erro: `As chaves são válidas, mas não foi possível gravá-las no Infisical: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    };
  }

  descartarChavesOmie(empresa.id);
  await descartarCache(empresa.id);
  revalidatePath("/omie");
  revalidatePath("/configuracoes");
  return {};
}

/**
 * Remove as chaves do Omie do cliente no Infisical. Irreversível — a integração
 * para de funcionar até cadastrar chaves novas. Só admin da plataforma.
 */
export async function excluirChavesOmie(empresaId: string): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Proos podem excluir as chaves do Omie." };
  }

  const empresa = (await empresasDoUsuario()).find((e) => e.id === empresaId);
  if (!empresa || empresa.eh_plataforma) return { erro: "Empresa cliente não encontrada." };

  const config = await naSessao((tx) => lerConfiguracaoInfisical(tx));
  if (!config || variaveisFaltandoInfisical().length > 0) {
    return { erro: "O Infisical ainda não está configurado." };
  }

  try {
    const local = await naSessao((tx) => garantirPastaCliente(tx, config, empresa));
    await removerSegredos(local, [SEGREDO_APP_KEY, SEGREDO_APP_SECRET]);
  } catch (erro) {
    return {
      erro: `Não foi possível excluir as chaves no Infisical: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    };
  }

  descartarChavesOmie(empresa.id);
  await descartarCache(empresa.id);
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
  // Nome vira parte do caminho em disco: só caracteres seguros.
  const nomeArquivo = arquivo.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const caminho = `${automacaoId}/${nomeArquivo}`;

  // A permissão já foi conferida acima (`exigirAdminPlataforma`, a mesma regra
  // de `automacoes_escrita`); o arquivo em si não passa por policy.
  try {
    await salvarArquivo("automacao-scripts", caminho, arquivo);
  } catch {
    return { erro: "Não foi possível enviar o arquivo." };
  }

  const config: ConfigPythonCron = {
    cron,
    arquivo: { caminho, nome: arquivo.name, tamanhoBytes: arquivo.size },
    timeoutSegundos,
    tentativas,
  };

  const proxima = proximaExecucao({ tipo: "python-cron", config });

  try {
    await naSessao((tx) =>
      tx.insert(automacoes).values({
        id: automacaoId,
        empresa_id: empresa.id,
        nome,
        descricao,
        status: "ativa",
        tipo: "python-cron",
        config: config as unknown as Record<string, unknown>,
        proxima_execucao: proxima?.toISOString() ?? null,
      }),
    );
  } catch {
    await removerArquivos("automacao-scripts", [caminho]);
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

  const idade = await idadeResumoOmie(empresa.id);
  if (idade !== null && idade < INTERVALO_MINIMO_ATUALIZAR_MS) {
    return { esperarSegundos: Math.ceil((INTERVALO_MINIMO_ATUALIZAR_MS - idade) / 1000) };
  }

  const estado = await obterResumoOmie(empresa.id, { forcar: true });
  revalidatePath("/omie");
  return estado.estado === "erro" ? { erro: estado.mensagem } : {};
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

  const [estado] = await naSessao((tx) =>
    tx
      .select({ concluida_em: omieSincronizacao.concluida_em })
      .from(omieSincronizacao)
      .where(eq(omieSincronizacao.empresa_id, empresa.id)),
  );
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

  let excluidas: { tipo: string; config: Record<string, unknown> }[];
  try {
    excluidas = await naSessao((tx) =>
      tx
        .delete(automacoes)
        .where(and(eq(automacoes.id, automacaoId), inArray(automacoes.empresa_id, idsPermitidos)))
        .returning({ tipo: automacoes.tipo, config: automacoes.config }),
    );
  } catch {
    return { erro: "Não foi possível excluir a automação." };
  }

  // O script some junto. Falha aqui não desfaz a exclusão: sobra só um
  // arquivo órfão no disco, sem nada apontando para ele.
  const caminhos = excluidas
    .filter((linha) => linha.tipo === "python-cron")
    .map((linha) => (linha.config as unknown as Partial<ConfigPythonCron>).arquivo?.caminho)
    .filter((caminho): caminho is string => Boolean(caminho));
  if (caminhos.length > 0) {
    await removerArquivos("automacao-scripts", caminhos).catch(() => undefined);
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

  const alvo = and(eq(automacoes.id, automacaoId), inArray(automacoes.empresa_id, idsPermitidos));

  // Ativar coloca na agenda; pausar tira. Sem isto uma automação pausada
  // continuaria vencida e o dispatcher a redisparia ao ser reativada.
  const [atual] = await naSessao((tx) =>
    tx.select({ tipo: automacoes.tipo, config: automacoes.config }).from(automacoes).where(alvo),
  );

  const proxima =
    status === "ativa" && atual
      ? proximaExecucao({
          tipo: atual.tipo,
          config: atual.config,
        } as unknown as ConfigAutomacao)
      : null;

  try {
    await naSessao((tx) =>
      tx
        .update(automacoes)
        .set({
          status,
          proxima_execucao: proxima?.toISOString() ?? null,
          atualizada_em: new Date().toISOString(),
        })
        .where(alvo),
    );
  } catch {
    return { erro: "Não foi possível alterar o status." };
  }

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

  try {
    await naSessao((tx) =>
      tx.execute(sql`select public.vincular_automacao(${dados.automacaoId}, ${dados.empresaId})`),
    );
  } catch {
    return { erro: "Não foi possível vincular a automação." };
  }

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
 * quem cadastrou o lê de volta pela sessão. Para trocar uma chave, exclui-se e
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

  // Metadado e valor na mesma transação: sem valor a chave não serve para
  // nada, e ficaria na lista aparentando estar configurada.
  try {
    await naSessao(async (tx) => {
      const [chave] = await tx
        .insert(acessosChaves)
        .values({
          empresa_id: empresa.id,
          nome,
          descricao: dados.descricao.trim(),
          criado_por: userId,
        })
        .returning({ id: acessosChaves.id });

      await tx
        .insert(acessosChavesSegredo)
        .values({ chave_id: chave.id, empresa_id: empresa.id, valor });
    });
  } catch (erro) {
    // 23505 = unique_violation: o índice por (empresa, lower(nome)).
    if (codigoErro(erro) === "23505") {
      return { erro: "Já existe uma chave com esse nome nesta empresa." };
    }
    return { erro: "Não foi possível cadastrar a chave." };
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

  try {
    await naSessao((tx) =>
      tx
        .delete(acessosChaves)
        .where(and(eq(acessosChaves.id, chaveId), inArray(acessosChaves.empresa_id, idsPermitidos))),
    );
  } catch {
    return { erro: "Não foi possível excluir a chave." };
  }

  revalidatePath("/acessos");
  return {};
}


/* ----------------------------- Fluxo de caixa ----------------------------- */

/**
 * Põe o fluxo de caixa da empresa em uso na fila do container `caixa`. A
 * rodada leva alguns minutos; a tela acompanha pelo status da execução. Se já
 * houver uma na fila ou rodando, não enfileira outra.
 */
export async function atualizarFluxoCaixa(): Promise<Resultado & { jaNaFila?: boolean }> {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  if (!empresa || empresa.eh_plataforma) return { erro: "Selecione uma empresa cliente." };

  try {
    const inseridas = await enfileirarRodadas([empresa.id], "manual");
    revalidatePath("/fluxo-caixa");
    return inseridas === 0 ? { jaNaFila: true } : {};
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }
}

const TIPOS_DE_CONTA: TipoConta[] = ["corrente", "aplicacao", "garantida"];

/**
 * Grava as marcações da Proos para o fluxo de caixa da empresa: saldo mínimo;
 * por conta, se entra, o tipo, a liquidez e o limite; o ajuste de categoria
 * para grupo e as linhas de receita. Só admin da plataforma — o cliente vê o
 * resultado, não decide o que é caixa. Como contas e limites mudam o cálculo,
 * já enfileira uma rodada nova.
 */
export async function salvarConfigFluxoCaixa(dados: {
  empresaId: string;
  saldoMinimo: number | null;
  contas: Record<string, ConfigConta>;
  categoriasGrupo: Record<string, string>;
  linhasReceita: LinhaReceita[];
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Proos podem configurar o fluxo de caixa." };
  }

  const empresa = (await empresasDoUsuario()).find((e) => e.id === dados.empresaId);
  if (!empresa || empresa.eh_plataforma) return { erro: "Empresa cliente não encontrada." };

  if (dados.saldoMinimo !== null && !(Number.isFinite(dados.saldoMinimo) && dados.saldoMinimo >= 0)) {
    return { erro: "Informe um saldo mínimo válido, ou deixe em branco." };
  }

  const contas: Record<string, ConfigConta> = {};
  for (const [codigo, conta] of Object.entries(dados.contas)) {
    if (!/^\d+$/.test(codigo) || !TIPOS_DE_CONTA.includes(conta.tipo)) {
      return { erro: "Marcação de conta inválida." };
    }
    contas[codigo] = {
      entra: Boolean(conta.entra),
      tipo: conta.tipo,
      liquidezImediata: Boolean(conta.liquidezImediata),
      limite: Number.isFinite(conta.limite) && conta.limite > 0 ? conta.limite : 0,
    };
  }

  const gruposValidos = new Set<string>(GRUPOS_FLUXO.map((g) => g.id));
  const categoriasGrupo: Record<string, string> = {};
  for (const [categoria, grupo] of Object.entries(dados.categoriasGrupo)) {
    const nome = categoria.trim();
    if (!nome || !gruposValidos.has(grupo)) return { erro: `Grupo inválido para "${categoria}".` };
    categoriasGrupo[nome] = grupo;
  }

  const linhasReceita: LinhaReceita[] = [];
  for (const linha of dados.linhasReceita) {
    const nome = linha.nome.trim();
    const termos = linha.termos.map((t) => t.trim()).filter(Boolean);
    if (!nome && termos.length === 0) continue;
    if (!nome || termos.length === 0) {
      return { erro: "Cada linha de receita precisa de um nome e de pelo menos um termo." };
    }
    linhasReceita.push({ nome, termos });
  }

  const valores = {
    saldo_minimo: dados.saldoMinimo,
    contas,
    categorias_grupo: categoriasGrupo,
    linhas_receita: linhasReceita,
    atualizado_em: new Date().toISOString(),
  };
  try {
    await db
      .insert(fluxoCaixaConfig)
      .values({ empresa_id: empresa.id, ...valores })
      .onConflictDoUpdate({ target: fluxoCaixaConfig.empresa_id, set: valores });
    await enfileirarRodadas([empresa.id], "manual");
  } catch (erro) {
    return { erro: mensagemDe(erro) };
  }

  revalidatePath("/fluxo-caixa");
  return {};
}

/**
 * Grava quais categorias contam como receita recorrente para a empresa — o que
 * o heurístico de nome ("Recorrente") não acerta em cliente novo (ex.: Startlaw).
 * Lista vazia volta ao heurístico. Só admin da plataforma: o cliente vê o
 * resultado, não decide o que é recorrente.
 */
export async function salvarConfigRecorrencia(dados: {
  empresaId: string;
  categoriaCodigos: string[];
}): Promise<Resultado> {
  if (!(await souAdminPlataforma())) {
    return { erro: "Só administradores da Proos podem configurar a recorrência." };
  }

  const empresa = (await empresasDoUsuario()).find((e) => e.id === dados.empresaId);
  if (!empresa || empresa.eh_plataforma) return { erro: "Empresa cliente não encontrada." };

  if (!Array.isArray(dados.categoriaCodigos) || dados.categoriaCodigos.some((c) => typeof c !== "string")) {
    return { erro: "Seleção de categorias inválida." };
  }
  const codigos = [...new Set(dados.categoriaCodigos)];

  try {
    await db
      .insert(recorrenciaConfig)
      .values({ empresa_id: empresa.id, categoria_codigos: codigos, atualizado_em: new Date().toISOString() })
      .onConflictDoUpdate({
        target: recorrenciaConfig.empresa_id,
        set: { categoria_codigos: codigos, atualizado_em: new Date().toISOString() },
      });
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  }

  revalidatePath("/omie");
  return {};
}
