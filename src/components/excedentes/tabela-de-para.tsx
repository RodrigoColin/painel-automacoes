"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Table, Td, Th } from "@/components/ui";
import {
  listarDePara,
  salvarDePara,
  type DeParaItem,
} from "@/lib/acoes-excedentes";

const TOM_STATUS: Record<string, "success" | "warning" | "neutral"> = {
  confirmado: "success",
  automatico: "neutral",
  confirmar: "warning",
  revisar: "warning",
};

export function TabelaDePara({ empresaId }: { empresaId: string }) {
  const [itens, setItens] = useState<DeParaItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | "novo" | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    void listarDePara(empresaId).then((r) => {
      if (!vivo) return;
      if (r.erro) setErro(r.erro);
      else setItens(r.itens ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [empresaId, versao]);

  const carregar = () => setVersao((v) => v + 1);

  if (erro) {
    return <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{erro}</p>;
  }
  if (itens === null) return <p className="text-sm text-fg-muted">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setEditando("novo")}>
          Adicionar mapeamento
        </Button>
        <Button variant="secondary" onClick={() => exportarCsv(itens)}>
          Exportar (CSV)
        </Button>
        <span className="text-xs text-fg-subtle">
          {itens.length} mapeamento(s) · edição registra quem mudou e quando
        </span>
      </div>

      {editando !== null ? (
        <FormDePara
          empresaId={empresaId}
          item={editando === "novo" ? null : itens.find((i) => i.id === editando) ?? null}
          aoFechar={() => {
            setEditando(null);
            carregar();
          }}
        />
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>Cod. recorrente</Th>
            <Th>Serviço recorrente</Th>
            <Th>Cod. excedente</Th>
            <Th>Serviço excedente (nCodServ)</Th>
            <Th>Categoria</Th>
            <Th>Status</Th>
            <Th>Atualizado</Th>
            <Th> </Th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id} className="border-t border-border">
              <Td className="tabular-nums">{i.codRecorrente}</Td>
              <Td>
                <span className="block max-w-[22rem] truncate" title={i.descricaoRecorrente ?? ""}>
                  {i.descricaoRecorrente ?? "—"}
                </span>
              </Td>
              <Td className="tabular-nums">{i.codExcedente ?? "—"}</Td>
              <Td>
                <span className="block max-w-[22rem] truncate" title={i.descricaoExcedente ?? ""}>
                  {i.descricaoExcedente ?? "—"}
                </span>
                <span className="text-[11px] text-fg-subtle tabular-nums">
                  {i.nCodServExcedente ?? "sem nCodServ — não utilizável"}
                </span>
              </Td>
              <Td>{i.categoriaExcedente ?? "—"}</Td>
              <Td>
                <Badge tone={TOM_STATUS[i.status] ?? "neutral"}>{i.status}</Badge>
              </Td>
              <Td>
                <span className="text-xs text-fg-subtle">
                  {i.atualizadoPor ?? "importação"}
                  {i.atualizadoEm ? ` · ${i.atualizadoEm.slice(0, 10)}` : ""}
                </span>
              </Td>
              <Td>
                <button
                  className="text-xs font-medium text-brand hover:underline"
                  onClick={() => setEditando(i.id)}
                >
                  editar
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function FormDePara({
  empresaId,
  item,
  aoFechar,
}: {
  empresaId: string;
  item: DeParaItem | null;
  aoFechar: () => void;
}) {
  const [codRecorrente, setCodRecorrente] = useState(item?.codRecorrente ?? "");
  const [descricaoRecorrente, setDescricaoRecorrente] = useState(
    item?.descricaoRecorrente ?? "",
  );
  const [codExcedente, setCodExcedente] = useState(item?.codExcedente ?? "");
  const [descricaoExcedente, setDescricaoExcedente] = useState(
    item?.descricaoExcedente ?? "",
  );
  const [nCodServ, setNCodServ] = useState(
    item?.nCodServExcedente ? String(item.nCodServExcedente) : "",
  );
  const [categoria, setCategoria] = useState(item?.categoriaExcedente ?? "");
  const [status, setStatus] = useState(item?.status ?? "confirmado");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const n = nCodServ.trim() ? Number(nCodServ.trim()) : undefined;
    if (nCodServ.trim() && (!Number.isInteger(n) || (n as number) <= 0)) {
      setErro("nCodServ precisa ser um inteiro positivo (ou vazio).");
      return;
    }
    setOcupado(true);
    setErro(null);
    const r = await salvarDePara(empresaId, {
      codRecorrente,
      descricaoRecorrente: descricaoRecorrente.trim() || undefined,
      codExcedente: codExcedente.trim() || undefined,
      descricaoExcedente: descricaoExcedente.trim() || undefined,
      nCodServExcedente: n,
      categoriaExcedente: categoria.trim() || undefined,
      status,
    });
    setOcupado(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    aoFechar();
  }

  const campo =
    "mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">
        {item ? `Editar mapeamento ${item.codRecorrente}` : "Novo mapeamento"}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-fg-muted">
          Código do serviço recorrente
          <input
            className={campo}
            value={codRecorrente}
            onChange={(e) => setCodRecorrente(e.target.value)}
            disabled={ocupado || item != null}
          />
        </label>
        <label className="text-xs text-fg-muted sm:col-span-2">
          Descrição do recorrente
          <input
            className={campo}
            value={descricaoRecorrente}
            onChange={(e) => setDescricaoRecorrente(e.target.value)}
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Código do serviço excedente
          <input
            className={campo}
            value={codExcedente}
            onChange={(e) => setCodExcedente(e.target.value)}
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted sm:col-span-2">
          Descrição do excedente
          <input
            className={campo}
            value={descricaoExcedente}
            onChange={(e) => setDescricaoExcedente(e.target.value)}
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted">
          nCodServ do excedente (Omie)
          <input
            className={campo}
            value={nCodServ}
            onChange={(e) => setNCodServ(e.target.value)}
            placeholder="ex.: 2174029906"
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Categoria (cCodCateg)
          <input
            className={campo}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="1.01.02"
            disabled={ocupado}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Status
          <select
            className={campo}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={ocupado}
          >
            <option value="confirmado">confirmado</option>
            <option value="automatico">automático</option>
            <option value="confirmar">confirmar</option>
            <option value="revisar">revisar</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? "Salvando…" : "Salvar"}
        </Button>
        <Button variant="secondary" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
      {erro ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{erro}</p>
      ) : null}
    </Card>
  );
}

function exportarCsv(itens: DeParaItem[]): void {
  const cab = [
    "cod_recorrente", "descricao_recorrente", "cod_excedente",
    "descricao_excedente", "nCodServ_excedente", "categoria_excedente",
    "origem", "status", "atualizado_por", "atualizado_em",
  ];
  const corpo = itens.map((i) =>
    [
      i.codRecorrente, i.descricaoRecorrente ?? "", i.codExcedente ?? "",
      i.descricaoExcedente ?? "", i.nCodServExcedente ?? "",
      i.categoriaExcedente ?? "", i.origem ?? "", i.status,
      i.atualizadoPor ?? "", i.atualizadoEm ?? "",
    ]
      .map((c) => `"${String(c).replaceAll('"', '""')}"`)
      .join(";"),
  );
  const csv = "﻿" + [cab.join(";"), ...corpo].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "de-para-servicos.csv";
  a.click();
  URL.revokeObjectURL(url);
}
