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
import { FormNomeEmpresa } from "@/components/form-nome-empresa";
import { empresaAtual, empresasDoUsuario, souAdminPlataforma } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Configurações · Painel" };

/**
 * Atenção: esta tela ainda não persiste tudo — os controles fora de
 * Nome do ambiente/Integrações/Credenciais/Clientes são de interface. Os
 * campos que refletem a empresa vêm do banco e, no caso do nome, também
 * gravam; o resto continua com valor padrão até existir uma tabela de
 * preferências.
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

  const { data: integracaoInfisical } = configurarConexoes
    ? await supabase
        .from("integracao_infisical_plataforma")
        .select("site_url, client_id, projeto_id, ambiente, injetar_segredos, mascarar_valores")
        .eq("id", true)
        .maybeSingle()
    : { data: null };

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
        <Field layout="inline" label="Fuso horário" hint="Usado para agendamentos e histórico.">
          <Select options={["America/Sao_Paulo", "UTC", "America/New_York"]} />
        </Field>
        <Field layout="inline" label="Idioma">
          <Select options={["Português (Brasil)", "English (US)", "Español"]} />
        </Field>
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
            description='Projeto Infisical compartilhado por todos os clientes. O isolamento entre eles vem do caminho definido em "Clientes", abaixo.'
          >
            <CabecalhoIntegracao
              sigla="IF"
              nome="Infisical"
              descricao="Cofre de segredos lido no momento da execução, com versionamento e auditoria."
              conectado={Boolean(integracaoInfisical)}
            />

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
          </FormSection>

          <FormSection
            title="Clientes"
            description='Pasta de cada empresa dentro do projeto Infisical compartilhado — evita que a automação de uma empresa enxergue o segredo de outra.'
          >
            <FormCaminhosClientes clientes={clientes} />
          </FormSection>
        </>
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
