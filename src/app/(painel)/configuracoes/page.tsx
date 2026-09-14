import type { Metadata } from "next";
import { Field, FormSection, Input } from "@/components/form";
import { Badge, Dot, PageHeader } from "@/components/ui";
import { FormIntegracaoN8n } from "@/components/form-integracao-n8n";
import { FormIntegracaoInfisical } from "@/components/form-integracao-infisical";
import { FormCaminhosClientes } from "@/components/form-caminhos-clientes";
import { FormNomeEmpresa } from "@/components/form-nome-empresa";
import { FormLogoEmpresa } from "@/components/form-logo-empresa";
import { LogoInfisical, LogoN8n } from "@/components/logos-servicos";
import { empresaAtual, empresasDoUsuario, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { criarClienteServidor } from "@/lib/supabase/server";
import { siteUrlInfisical, variaveisFaltando } from "@/lib/infisical/api";
import { lerConfiguracaoInfisical } from "@/lib/infisical/clientes";

export const metadata: Metadata = { title: "Configurações · Painel" };

/**
 * Todo controle desta tela persiste. A única exceção é Notificações, que é um
 * lugar reservado sem controle nenhum — a regra aqui é não exibir campo que
 * aceita edição e descarta o valor.
 *
 * n8n e Infisical são conexões únicas, compartilhadas por todos os clientes
 * (uma conta de n8n, um projeto Infisical, geridos pela Proos). Empresas
 * clientes não têm nada para configurar aqui: a conexão e o isolamento de
 * segredos são geridos pela Proos, não pela própria empresa — por isso as
 * seções aparecem só com a Proos selecionada no seletor de empresa, e não
 * enquanto se olha um cliente.
 */
export default async function ConfiguracoesPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const ehAdminPlataforma = await souAdminPlataforma();
  const supabase = await criarClienteServidor();

  // Duas condições, não uma: ser admin de plataforma é sobre a *pessoa*, e
  // sozinho isso faria a conexão da Proos aparecer dentro das configurações de
  // um cliente assim que o seletor trocasse para a Scopo. A conexão é da
  // Proos, então só aparece quando a empresa selecionada é a própria Proos.
  const configurarConexoes = ehAdminPlataforma && Boolean(empresa?.eh_plataforma);

  // Para admin da Admin, estas consultas trazem a conexão de verdade — a
  // policy só libera SELECT para quem administra a plataforma. Para
  // qualquer outra empresa o RLS devolve vazio, então nem tentamos.
  const { data: integracaoN8n } = configurarConexoes
    ? await supabase.from("integracao_n8n_plataforma").select("instancia_url").eq("id", true).maybeSingle()
    : { data: null };

  const configInfisical = configurarConexoes ? await lerConfiguracaoInfisical(supabase) : null;
  const faltandoInfisical = variaveisFaltando();
  const infisicalConectado = Boolean(configInfisical) && faltandoInfisical.length === 0;

  // Lista de clientes (empresas que não são a Admin) com o caminho atual,
  // só carregada para quem vai editar.
  let clientes: { id: string; nome: string; caminho: string }[] = [];
  if (configurarConexoes) {
    const todas = await empresasDoUsuario();
    const { data: caminhos } = await supabase.from("infisical_caminhos_clientes").select("empresa_id, caminho");
    const porEmpresa = new Map((caminhos ?? []).map((c) => [c.empresa_id, c.caminho]));
    clientes = todas
      .filter((e) => !e.eh_plataforma)
      .map((e) => ({ id: e.id, nome: e.nome, caminho: porEmpresa.get(e.id) ?? "" }));
  }

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Preferências gerais do painel e do motor de execução."
        actions={
          <>
            <Button variant="ghost">Descartar</Button>
            <Button variant="primary">Salvar alterações</Button>
          </>
        }
      />

      <FormSection
        title="Geral"
        description="Informações básicas do ambiente."
      >
        {empresa ? (
          <FormNomeEmpresa empresaId={empresa.id} nomeAtual={empresa.nome} />
        ) : (
          <Field layout="inline" label="Nome do ambiente" hint="Aparece no topo da barra lateral.">
            <Input disabled placeholder="Nenhuma empresa selecionada" />
          </Field>
        )}

        {empresa ? (
          <FormLogoEmpresa
            empresaId={empresa.id}
            nomeEmpresa={empresa.nome}
            logoAtual={empresa.logo_url}
          />
        ) : null}
      </FormSection>

      {configurarConexoes ? (
        <>
          <FormSection
            title="Integrações"
            description="Conexão com o n8n, compartilhada por todos os clientes."
          >
            <CabecalhoIntegracao
              sigla="n8n"
              nome="n8n"
              descricao="Dispara e acompanha workflows da instância compartilhada."
              conectado={Boolean(integracaoN8n)}
            />

            <FormIntegracaoN8n
              urlAtual={integracaoN8n?.instancia_url ?? ""}
              conectado={Boolean(integracaoN8n)}
            />
          </FormSection>

          <FormSection
            title="Credenciais"
            description='Projeto Infisical compartilhado por todos os clientes. As credenciais vêm das variáveis de ambiente; o isolamento entre clientes vem da pasta de cada um, em "Clientes".'
          >
            <CabecalhoIntegracao
              logo={<LogoInfisical className="size-9" />}
              nome="Infisical"
              descricao="Cofre de segredos lido no momento da execução, com versionamento e auditoria."
              conectado={infisicalConectado}
            />

            <FormIntegracaoInfisical
              configAtual={configInfisical}
              siteUrl={siteUrlInfisical()}
              variaveisFaltando={faltandoInfisical}
            />
          </FormSection>

          <FormSection
            title="Clientes"
            description="Pasta de cada empresa no projeto Infisical, criada pelo app — evita que uma empresa enxergue os segredos de outra."
          >
            <FormCaminhosClientes clientes={clientes} habilitado={infisicalConectado} />
          </FormSection>
        </>
      ) : null}

      {/* Placeholder: a seção fica para reservar o lugar, sem controles que
          não gravam nada. Os campos anteriores eram só interface. */}
      <FormSection
        title="Notificações"
        description="Como a equipe é avisada sobre o resultado das execuções."
      >
        <p className="text-sm text-fg-muted">
          Ainda não disponível.
        </p>
      </FormSection>
    </>
  );
}

/** Linha de identificação de um serviço externo, com o estado da conexão. */
function CabecalhoIntegracao({
  sigla,
  nome,
  descricao,
  conectado,
}: {
  sigla: string;
  nome: string;
  descricao: string;
  conectado: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-surface-muted text-[10px] font-bold">
          {sigla}
        </div>
        <div>
          <p className="text-sm font-medium">{nome}</p>
          <p className="text-sm text-fg-muted">{descricao}</p>
        </div>
      </div>
      <Badge tone={conectado ? "success" : "warning"}>
        <Dot level="current" />
        {conectado ? "Conectado" : "Não conectado"}
      </Badge>
    </div>
  );
}
