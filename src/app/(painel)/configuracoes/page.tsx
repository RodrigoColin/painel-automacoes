import type { Metadata } from "next";
import {
  Field,
  FormSection,
  Input,
  Select,
  SwitchField,
} from "@/components/form";
import { Badge, Button, Dot, PageHeader } from "@/components/ui";
import { empresaAtual } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";

export const metadata: Metadata = { title: "Configurações · Painel" };

/**
 * Atenção: esta tela ainda não persiste nada — os controles são de interface.
 * Os campos abaixo que refletem a empresa vêm do banco; o resto continua com
 * valor padrão até existir uma tabela de preferências.
 */
export default async function ConfiguracoesPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());

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
        description="Conexões com serviços externos usados pelas automações."
      >
        <CabecalhoIntegracao
          sigla="n8n"
          nome="n8n"
          descricao="Dispara e acompanha workflows da instância auto-hospedada."
        />

        <Field
          layout="inline"
          label="URL da instância"
          hint="Endereço do editor, sem barra no final."
        >
          <Input placeholder="https://n8n.suaempresa.com" />
        </Field>

        <Field
          layout="inline"
          label="Chave de API"
          hint="Gerada no n8n em Settings → n8n API. Com o Infisical conectado, pode ser referenciada como um segredo."
        >
          <Input type="password" placeholder="••••••••••••" />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">
            A conexão vale apenas para a empresa selecionada no painel.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary">Testar conexão</Button>
            <Button variant="primary">Conectar</Button>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Credenciais"
        description="Chaves, tokens e segredos usados pelas automações — geridos no Infisical, nunca guardados no painel."
      >
        <CabecalhoIntegracao
          sigla="IF"
          nome="Infisical"
          descricao="Cofre de segredos lido no momento da execução, com versionamento e auditoria."
        />

        <Field
          layout="inline"
          label="URL da instância"
          hint="Infisical Cloud ou instância auto-hospedada, sem barra no final."
        >
          <Input placeholder="https://app.infisical.com" />
        </Field>

        <Field
          layout="inline"
          label="Client ID"
          hint="Machine Identity com permissão de leitura no projeto."
        >
          <Input placeholder="00000000-0000-0000-0000-000000000000" />
        </Field>

        <Field
          layout="inline"
          label="Client Secret"
          hint="Guardado criptografado; não volta a ser exibido depois de salvo."
        >
          <Input type="password" placeholder="••••••••••••" />
        </Field>

        <Field
          layout="inline"
          label="ID do projeto"
          hint="Encontrado no Infisical em Project Settings → Project ID."
        >
          <Input placeholder="7c1f0a2e-…" />
        </Field>

        <Field
          layout="inline"
          label="Ambiente"
          hint="Slug do ambiente lido pelas automações."
        >
          <Select
            options={[
              { valor: "prod", rotulo: "Produção (prod)" },
              { valor: "staging", rotulo: "Homologação (staging)" },
              { valor: "dev", rotulo: "Desenvolvimento (dev)" },
            ]}
          />
        </Field>

        <Field
          layout="inline"
          label="Caminho base"
          hint="Pasta de onde os segredos são lidos."
        >
          <Input defaultValue="/automacoes" />
        </Field>

        <SwitchField
          label="Injetar segredos nas execuções"
          hint="Entrega os segredos como variáveis de ambiente no cron Python e como credenciais nos workflows do n8n."
          defaultChecked
        />
        <SwitchField
          label="Mascarar valores no histórico"
          hint="Substitui qualquer valor de segredo por ••• nos logs e no payload registrado."
          defaultChecked
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">
            Os segredos são buscados a cada execução — revogar no Infisical
            interrompe o acesso na hora.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary">Testar conexão</Button>
            <Button variant="primary">Conectar</Button>
          </div>
        </div>
      </FormSection>

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
  conectado = false,
}: {
  sigla: string;
  nome: string;
  descricao: string;
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
      <Badge tone={conectado ? "success" : "warning"}>
        <Dot level="current" />
        {conectado ? "Conectado" : "Não conectado"}
      </Badge>
    </div>
  );
}
