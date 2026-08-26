import type { Metadata } from "next";
import {
  Field,
  FormSection,
  Input,
  Select,
  SwitchField,
} from "@/components/form";
import { Badge, Button, Dot, PageHeader } from "@/components/ui";
import { FormIntegracaoN8n } from "@/components/form-integracao-n8n";
import { FormIntegracaoInfisical } from "@/components/form-integracao-infisical";
import { FormCaminhosClientes } from "@/components/form-caminhos-clientes";
import { empresaAtual, empresasDoUsuario, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Configurações · Painel" };

/**
 * Atenção: esta tela ainda não persiste tudo — os controles fora de
 * Integrações/Credenciais/Clientes são de interface. Os campos que refletem
 * a empresa vêm do banco; o resto continua com valor padrão até existir uma
 * tabela de preferências.
 *
 * n8n e Infisical são conexões únicas, compartilhadas por todos os clientes
 * (uma conta de n8n, um projeto Infisical, geridos pela Broad) — só quem
 * administra a Broad enxerga os formulários de conexão. Uma empresa cliente
 * vê status e, no caso do Infisical, o caminho onde os próprios segredos
 * ficam guardados.
 */
export default async function ConfiguracoesPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const ehPlataforma = await souAdminPlataforma();
  const supabase = await criarClienteServidor();

  // Para admin da Broad, estas consultas trazem a conexão de verdade — a
  // policy só libera SELECT para quem administra a plataforma. Para
  // qualquer outra empresa o RLS devolve vazio, então nem tentamos.
  const { data: integracaoN8n } = ehPlataforma
    ? await supabase.from("integracao_n8n_plataforma").select("instancia_url").eq("id", true).maybeSingle()
    : { data: null };

  const { data: integracaoInfisical } = ehPlataforma
    ? await supabase
        .from("integracao_infisical_plataforma")
        .select("site_url, client_id, projeto_id, ambiente, injetar_segredos, mascarar_valores")
        .eq("id", true)
        .maybeSingle()
    : { data: null };

  // A própria empresa sempre pode ler o próprio caminho de segredos.
  const { data: caminhoProprio } = empresa
    ? await supabase
        .from("infisical_caminhos_clientes")
        .select("caminho")
        .eq("empresa_id", empresa.id)
        .maybeSingle()
    : { data: null };

  // Lista de clientes (empresas que não são a Broad) com o caminho atual,
  // só carregada para quem vai editar.
  let clientes: { id: string; nome: string; caminho: string }[] = [];
  if (ehPlataforma) {
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
        <Field layout="inline" label="Nome do ambiente" hint="Aparece no topo da barra lateral.">
          <Input defaultValue={empresa?.nome ?? ""} />
        </Field>
        <Field layout="inline" label="Fuso horário" hint="Usado para agendamentos e histórico.">
          <Select options={["America/Sao_Paulo", "UTC", "America/New_York"]} />
        </Field>
        <Field layout="inline" label="Idioma">
          <Select options={["Português (Brasil)", "English (US)", "Español"]} />
        </Field>
      </FormSection>

      <FormSection
        title="Integrações"
        description={
          ehPlataforma
            ? "Conexão com o n8n, compartilhada por todos os clientes."
            : "Conexão com o n8n — uma conta só, gerida pela Broad para todos os clientes."
        }
      >
        <CabecalhoIntegracao
          sigla="n8n"
          nome="n8n"
          descricao="Dispara e acompanha workflows da instância compartilhada."
          conectado={ehPlataforma ? Boolean(integracaoN8n) : undefined}
        />

        {ehPlataforma ? (
          <FormIntegracaoN8n
            urlAtual={integracaoN8n?.instancia_url ?? ""}
            conectado={Boolean(integracaoN8n)}
          />
        ) : (
          <p className="text-sm text-fg-muted">
            Gerido pela Broad. As automações desta empresa usam a conexão
            compartilhada — não há nada para configurar aqui.
          </p>
        )}
      </FormSection>

      <FormSection
        title="Credenciais"
        description={
          ehPlataforma
            ? "Projeto Infisical compartilhado por todos os clientes. O isolamento entre eles vem do caminho definido em \"Clientes\", abaixo."
            : "Cofre de segredos — um projeto só, gerido pela Broad. Os segredos desta empresa ficam isolados numa pasta própria."
        }
      >
        <CabecalhoIntegracao
          sigla="IF"
          nome="Infisical"
          descricao="Cofre de segredos lido no momento da execução, com versionamento e auditoria."
          conectado={ehPlataforma ? Boolean(integracaoInfisical) : undefined}
        />

        {ehPlataforma ? (
          <FormIntegracaoInfisical
            integracaoAtual={{
              siteUrl: integracaoInfisical?.site_url ?? "",
              clientId: integracaoInfisical?.client_id ?? "",
              projetoId: integracaoInfisical?.projeto_id ?? "",
              ambiente: integracaoInfisical?.ambiente ?? "",
              injetarSegredos: integracaoInfisical?.injetar_segredos ?? true,
              mascararValores: integracaoInfisical?.mascarar_valores ?? true,
            }}
            conectado={Boolean(integracaoInfisical)}
          />
        ) : (
          <Field
            layout="inline"
            label="Caminho dos seus segredos"
            hint='Nas variáveis de ambiente Python, use {{infisical.NOME}} para referenciar um segredo desta pasta.'
          >
            <Input
              readOnly
              value={caminhoProprio?.caminho ?? "Ainda não configurado pela Broad"}
              className="font-mono text-xs"
            />
          </Field>
        )}
      </FormSection>

      {ehPlataforma ? (
        <FormSection
          title="Clientes"
          description='Pasta de cada empresa dentro do projeto Infisical compartilhado — evita que a automação de uma empresa enxergue o segredo de outra.'
        >
          <FormCaminhosClientes clientes={clientes} />
        </FormSection>
      ) : null}

      <FormSection
        title="Execução"
        description="Comportamento padrão aplicado a novas automações."
      >
        <Field layout="inline" label="Tentativas em caso de erro">
          <Select options={["Nenhuma", "1 tentativa", "3 tentativas", "5 tentativas"]} />
        </Field>
        <Field layout="inline" label="Tempo limite por execução" hint="Em segundos.">
          <Input defaultValue="300" inputMode="numeric" />
        </Field>
        <SwitchField
          label="Pausar automação após falhas consecutivas"
          hint="Evita execuções repetidas quando algo quebra na integração."
          defaultChecked
        />
        <SwitchField
          label="Registrar payload completo no histórico"
          hint="Aumenta o volume de armazenamento consumido."
        />
      </FormSection>

      <FormSection
        title="Notificações"
        description="Como a equipe é avisada sobre o resultado das execuções."
      >
        <Field layout="inline" label="E-mail para alertas">
          <Input defaultValue={empresa?.email ?? ""} type="email" />
        </Field>
        <SwitchField label="Notificar em caso de erro" defaultChecked />
        <SwitchField label="Resumo diário de execuções" defaultChecked />
        <SwitchField label="Notificar quando uma automação for pausada" />
      </FormSection>

      <FormSection
        title="Zona de risco"
        description="Ações destrutivas. Requerem confirmação adicional."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Limpar histórico de execuções</p>
            <p className="text-sm text-fg-muted">
              Remove permanentemente todos os registros anteriores.
            </p>
          </div>
          <Button variant="secondary">Limpar histórico</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Desativar todas as automações</p>
            <p className="text-sm text-fg-muted">
              Interrompe imediatamente qualquer execução agendada.
            </p>
          </div>
          <Button variant="secondary">Desativar tudo</Button>
        </div>
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
  /** `undefined` quando quem vê a tela não tem como saber (não é admin da Broad). */
  conectado?: boolean;
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
      {conectado === undefined ? (
        <Badge tone="neutral">
          <Dot level="muted" />
          Gerido pela Broad
        </Badge>
      ) : (
        <Badge tone={conectado ? "success" : "warning"}>
          <Dot level="current" />
          {conectado ? "Conectado" : "Não conectado"}
        </Badge>
      )}
    </div>
  );
}
