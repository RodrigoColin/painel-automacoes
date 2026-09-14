"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { alterarStatusAutomacao, excluirAutomacao } from "@/lib/acoes";
import {
  formatarDataHora,
  rotuloStatus,
  type Automacao,
  type StatusAutomacao,
} from "@/lib/tipos";
import { rotuloTipo, type TipoAutomacao } from "@/lib/automacao-tipos";
import { nivelDot, toneStatusAutomacao } from "@/lib/status-cores";
import { IconLixeira, IconPlus } from "@/components/icons";
import { Toggle } from "@/components/toggle";
import { LogoN8n } from "@/components/logos-servicos";
import { Modal } from "@/components/modal";
import { Select } from "@/components/form";
import {
  Badge,
  Button,
  Dot,
  EmptyHint,
  StatCard,
  Table,
  Td,
  Th,
  classesBotao,
  classesBotaoLixeira,
} from "@/components/ui";

type FiltroStatus = "todos" | StatusAutomacao;
type FiltroTipo = "todos" | TipoAutomacao;

export function ListaAutomacoes({
  automacoes,
  mostrarEmpresa = false,
  podeGerenciar = false,
}: {
  automacoes: Automacao[];
  /** Só a Admin vê automações de mais de uma empresa ao mesmo tempo. */
  mostrarEmpresa?: boolean;
  /**
   * Só admin da Proos cria, pausa ou exclui. Para empresa cliente a tela é de
   * acompanhamento: o toggle continua visível, mostrando o estado, mas inerte.
   * Esconder o controle não seria proteção — quem segura é a policy
   * `automacoes_escrita` e o `exigirAdminPlataforma` nas ações.
   */
  podeGerenciar?: boolean;
}) {
  const [, iniciarTransicao] = useTransition();

  const [status, setStatus] = useState<FiltroStatus>("todos");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [empresaFiltro, setEmpresaFiltro] = useState("todas");

  const empresasDisponiveis = mostrarEmpresa
    ? [...new Set(automacoes.map((a) => a.empresa))].sort((a, b) => a.localeCompare(b))
    : [];

  const filtradas = automacoes.filter((a) => {
    if (status !== "todos" && a.status !== status) return false;
    if (tipo !== "todos" && a.tipo !== tipo) return false;
    if (empresaFiltro !== "todas" && a.empresa !== empresaFiltro) return false;
    return true;
  });

  const temFiltro = status !== "todos" || tipo !== "todos" || empresaFiltro !== "todas";
  const ativas = automacoes.filter((a) => a.status === "ativa").length;
  const pausadas = automacoes.filter((a) => a.status === "pausada").length;
  const rascunhos = automacoes.filter((a) => a.status === "rascunho").length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total"
          value={String(automacoes.length)}
          hint="Automações cadastradas"
        />
        <StatCard label="Ativas" value={String(ativas)} hint="Em execução automática" />
        <StatCard
          label="Pausadas"
          value={String(pausadas)}
          hint="Configuradas, sem disparar"
        />
        <StatCard
          label="Rascunhos"
          value={String(rascunhos)}
          hint="Ainda não publicadas"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* O Select ocupa 100% do contêiner, então a largura vem do wrapper. */}
        <div className="w-40">
          <Select
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => setStatus(e.target.value as FiltroStatus)}
            options={[
              { valor: "todos", rotulo: "Todos os status" },
              { valor: "ativa", rotulo: "Ativas" },
              { valor: "pausada", rotulo: "Pausadas" },
              { valor: "rascunho", rotulo: "Rascunhos" },
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            aria-label="Filtrar por tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as FiltroTipo)}
            options={[
              { valor: "todos", rotulo: "Todos os tipos" },
              { valor: "python-cron", rotulo: "Python · cron" },
              { valor: "n8n", rotulo: "n8n" },
            ]}
          />
        </div>
        {mostrarEmpresa ? (
          <div className="w-44">
            <Select
              aria-label="Filtrar por empresa"
              value={empresaFiltro}
              onChange={(e) => setEmpresaFiltro(e.target.value)}
              options={[
                { valor: "todas", rotulo: "Todas as empresas" },
                ...empresasDisponiveis.map((nome) => ({ valor: nome, rotulo: nome })),
              ]}
            />
          </div>
        ) : null}
        {temFiltro ? (
          <Button
            variant="ghost"
            onClick={() => {
              setStatus("todos");
              setTipo("todos");
              setEmpresaFiltro("todas");
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {filtradas.length === 0 ? (
        <EmptyHint>
          {temFiltro
            ? "Nenhuma automação corresponde aos filtros aplicados."
            : "Nenhuma automação cadastrada ainda."}
        </EmptyHint>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-14">Ativa</Th>
              <Th>Automação</Th>
              {mostrarEmpresa ? <Th>Empresa</Th> : null}
              <Th>Status</Th>
              <Th>Tipo</Th>
              <Th>Última execução</Th>
              {podeGerenciar ? <Th className="w-16 text-right">Ações</Th> : null}
            </tr>
          </thead>
          <tbody>
            {filtradas.map((automacao) => (
              <tr key={automacao.id} className="hover:bg-surface-muted/50">
                <Td>
                  <Toggle
                    label={`Ativar ${automacao.nome}`}
                    checked={automacao.status === "ativa"}
                    onChange={(ligado) =>
                      iniciarTransicao(() => {
                        void alterarStatusAutomacao(
                          automacao.id,
                          ligado ? "ativa" : "pausada",
                        );
                      })
                    }
                    disabled={automacao.status === "rascunho" || !podeGerenciar}
                  />
                </Td>
                <Td>
                  <p className="font-medium">{automacao.nome}</p>
                  {/* Automação n8n não tem descrição — o vazio não deve virar
                      uma linha em branco embaixo do nome. */}
                  {automacao.descricao ? (
                    <p className="text-xs text-fg-subtle">{automacao.descricao}</p>
                  ) : null}
                </Td>
                {mostrarEmpresa ? (
                  <Td className="text-fg-muted">{automacao.empresa}</Td>
                ) : null}
                <Td>
                  <Badge tone={toneStatusAutomacao[automacao.status]}>
                    <Dot level={nivelDot(toneStatusAutomacao[automacao.status])} />
                    {rotuloStatus[automacao.status]}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone="neutral">
                    {automacao.tipo === "n8n" ? <LogoN8n className="size-4" /> : null}
                    {rotuloTipo[automacao.tipo]}
                  </Badge>
                </Td>
                <Td className="text-fg-muted tabular-nums">
                  {formatarDataHora(automacao.ultimaExecucao)}
                </Td>
                {podeGerenciar ? (
                  <Td>
                    <BotaoExcluirAutomacao
                      id={automacao.id}
                      nome={automacao.nome}
                      empresa={automacao.empresa}
                    />
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          Exibindo {filtradas.length} de {automacoes.length} automações.
        </p>
        <Link
          href="/dashboard"
          className="text-xs font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
        >
          Ver métricas no dashboard
        </Link>
      </div>
    </>
  );
}

/**
 * Lixeira com confirmação, igual à exclusão de usuário: um ícone na linha e
 * um diálogo antes de apagar. A automação leva junto o histórico de execuções
 * e o script enviado, então não há como desfazer.
 */
function BotaoExcluirAutomacao({
  id,
  nome,
  empresa,
}: {
  id: string;
  nome: string;
  empresa: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, iniciarExclusao] = useTransition();

  return (
    <div className="flex items-center justify-end">
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        aria-label={`Excluir ${nome}`}
        title="Excluir"
        className={classesBotaoLixeira}
      >
        <IconLixeira className="size-5" />
      </button>

      {confirmando ? (
        <Modal
          titulo="Excluir automação"
          descricao={`${nome} · ${empresa}`}
          onFechar={() => setConfirmando(false)}
        >
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-fg-muted">
              A automação sai da lista junto com o histórico de execuções e o script
              enviado. Não há como desfazer.
            </p>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmando(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={excluindo}
                onClick={() =>
                  iniciarExclusao(() => {
                    void excluirAutomacao(id);
                    setConfirmando(false);
                  })
                }
              >
                <IconLixeira className="size-4" />
                {excluindo ? "Excluindo…" : "Excluir automação"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** Botão “Nova automação” — leva ao formulário de criação. */
export function BotaoNovaAutomacao() {
  return (
    <Link href="/automacoes/nova" className={classesBotao("primary")}>
      <IconPlus className="size-5" />
      Nova automação
    </Link>
  );
}
