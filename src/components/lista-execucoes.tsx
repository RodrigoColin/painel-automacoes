"use client";

import { useState } from "react";
import { nivelDot, toneResultado } from "@/lib/status-cores";
import {
  formatarDataHora,
  formatarDuracao,
  rotuloResultado,
  type Execucao,
  type ResultadoExecucao,
} from "@/lib/tipos";
import { Select } from "@/components/form";
import {
  Badge,
  Button,
  Dot,
  EmptyHint,
  SearchInput,
  Table,
  Td,
  Th,
} from "@/components/ui";

type FiltroResultado = "todos" | ResultadoExecucao;

export function ListaExecucoes({
  execucoes,
  mostrarEmpresa = false,
}: {
  execucoes: Execucao[];
  /** Só a Admin vê execuções de mais de uma empresa ao mesmo tempo. */
  mostrarEmpresa?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [resultado, setResultado] = useState<FiltroResultado>("todos");
  const [empresaFiltro, setEmpresaFiltro] = useState("todas");

  const empresasDisponiveis = mostrarEmpresa
    ? [...new Set(execucoes.map((e) => e.empresa))].sort((a, b) => a.localeCompare(b))
    : [];

  const termo = busca.trim().toLowerCase();
  const filtradas = execucoes.filter((e) => {
    if (resultado !== "todos" && e.resultado !== resultado) return false;
    if (empresaFiltro !== "todas" && e.empresa !== empresaFiltro) return false;
    if (!termo) return true;
    return (
      e.automacao.toLowerCase().includes(termo) || e.id.toLowerCase().includes(termo)
    );
  });

  const temFiltro =
    Boolean(termo) || resultado !== "todos" || empresaFiltro !== "todas";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          placeholder="Buscar por automação ou ID"
          value={busca}
          onChange={setBusca}
        />
        <div className="w-44">
          <Select
            aria-label="Filtrar por resultado"
            value={resultado}
            onChange={(e) => setResultado(e.target.value as FiltroResultado)}
            options={[
              { valor: "todos", rotulo: "Todos os resultados" },
              { valor: "sucesso", rotulo: rotuloResultado.sucesso },
              { valor: "erro", rotulo: rotuloResultado.erro },
              { valor: "em_andamento", rotulo: rotuloResultado.em_andamento },
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
              setResultado("todos");
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
            ? "Nenhuma execução corresponde aos filtros aplicados."
            : "Nenhuma execução registrada ainda. Assim que uma automação rodar, ela aparece aqui."}
        </EmptyHint>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Execução</Th>
              <Th>Automação</Th>
              {mostrarEmpresa ? <Th>Empresa</Th> : null}
              <Th>Resultado</Th>
              <Th>Início</Th>
              <Th className="text-right">Duração</Th>
              <Th>Origem</Th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((execucao) => (
              <tr key={execucao.id} className="hover:bg-surface-muted/50">
                <Td className="font-mono text-xs text-fg-muted">
                  {execucao.id.slice(0, 8)}
                </Td>
                <Td className="font-medium">{execucao.automacao}</Td>
                {mostrarEmpresa ? (
                  <Td className="text-fg-muted">{execucao.empresa}</Td>
                ) : null}
                <Td>
                  <Badge tone={toneResultado[execucao.resultado]}>
                    <Dot level={nivelDot(toneResultado[execucao.resultado])} />
                    {rotuloResultado[execucao.resultado]}
                  </Badge>
                </Td>
                <Td className="text-fg-muted tabular-nums">
                  {formatarDataHora(execucao.inicio)}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatarDuracao(execucao.duracaoMs)}
                </Td>
                <Td className="text-fg-muted">{execucao.origem}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <p className="text-xs text-fg-subtle">
        Exibindo {filtradas.length} de {execucoes.length} execuções.
      </p>
    </>
  );
}
