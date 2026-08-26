"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { clsx } from "@/lib/clsx";
import { alterarStatusAutomacao, excluirAutomacao } from "@/lib/acoes";
import {
  formatarDataHora,
  rotuloStatus,
  type Automacao,
  type StatusAutomacao,
} from "@/lib/tipos";
import { rotuloTipo, type TipoAutomacao } from "@/lib/automacao-tipos";
import { nivelDot, toneStatusAutomacao } from "@/lib/status-cores";
import { IconDots, IconPlus } from "@/components/icons";
import { Toggle } from "@/components/toggle";
import { Select } from "@/components/form";
import {
  Badge,
  Button,
  Dot,
  EmptyHint,
  SearchInput,
  StatCard,
  Table,
  Td,
  Th,
  classesBotao,
} from "@/components/ui";

type FiltroStatus = "todos" | StatusAutomacao;
type FiltroTipo = "todos" | TipoAutomacao;

export function ListaAutomacoes({
  automacoes,
  mostrarEmpresa = false,
}: {
  automacoes: Automacao[];
  /** Só a Admin vê automações de mais de uma empresa ao mesmo tempo. */
  mostrarEmpresa?: boolean;
}) {
  const [, iniciarTransicao] = useTransition();

  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<FiltroStatus>("todos");
  const [tipo, setTipo] = useState<FiltroTipo>("todos");
  const [empresaFiltro, setEmpresaFiltro] = useState("todas");

  const empresasDisponiveis = mostrarEmpresa
    ? [...new Set(automacoes.map((a) => a.empresa))].sort((a, b) => a.localeCompare(b))
    : [];

  const termo = busca.trim().toLowerCase();
  const filtradas = automacoes.filter((a) => {
    if (status !== "todos" && a.status !== status) return false;
    if (tipo !== "todos" && a.tipo !== tipo) return false;
    if (empresaFiltro !== "todas" && a.empresa !== empresaFiltro) return false;
    if (!termo) return true;
    return (
      a.nome.toLowerCase().includes(termo) ||
      a.descricao.toLowerCase().includes(termo) ||
      a.gatilho.toLowerCase().includes(termo)
    );
  });

  const temFiltro =
    Boolean(termo) || status !== "todos" || tipo !== "todos" || empresaFiltro !== "todas";
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
        <SearchInput
          placeholder="Buscar automação"
          value={busca}
          onChange={setBusca}
        />
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
              setBusca("");
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
              <Th>Tipo e gatilho</Th>
              <Th>Responsável</Th>
              <Th>Última execução</Th>
              <Th className="w-12" />
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
                    disabled={automacao.status === "rascunho"}
                  />
                </Td>
                <Td>
                  <p className="font-medium">{automacao.nome}</p>
                  <p className="text-xs text-fg-subtle">{automacao.descricao}</p>
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
                  <Badge tone="neutral">{rotuloTipo[automacao.tipo]}</Badge>
                  <p className="mt-1 font-mono text-xs text-fg-subtle">
                    {automacao.gatilho}
                  </p>
                </Td>
                <Td className="text-fg-muted">{automacao.responsavel ?? "—"}</Td>
                <Td className="text-fg-muted tabular-nums">
                  {formatarDataHora(automacao.ultimaExecucao)}
                </Td>
                <Td>
                  <MenuLinha
                    nome={automacao.nome}
                    onExcluir={() =>
                      iniciarTransicao(() => {
                        void excluirAutomacao(automacao.id);
                      })
                    }
                  />
                </Td>
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

/** Botão “Nova automação” — leva ao formulário de criação. */
export function BotaoNovaAutomacao() {
  return (
    <Link href="/automacoes/nova" className={classesBotao("primary")}>
      <IconPlus className="size-4" />
      Nova automação
    </Link>
  );
}

function MenuLinha({
  nome,
  onExcluir,
}: {
  nome: string;
  onExcluir: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      if (!containerRef.current?.contains(evento.target as Node)) {
        setAberto(false);
      }
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Ações de ${nome}`}
        className="size-8 justify-center px-0"
      >
        <IconDots className="size-4" />
      </Button>

      {aberto ? (
        <div
          role="menu"
          className={clsx(
            "absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border",
            "border-border bg-surface p-1 shadow-lg"
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAberto(false);
              onExcluir();
            }}
            className="w-full rounded-md px-2 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
          >
            Excluir automação
          </button>
        </div>
      ) : null}
    </div>
  );
}
