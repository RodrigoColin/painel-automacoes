"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAtualizar } from "@/components/icons";
import { classesBotao } from "@/components/ui";
import { atualizarFluxoCaixa } from "@/lib/acoes";
import { clsx } from "@/lib/clsx";
import type { ExecucaoCaixa } from "@/lib/fluxo-caixa/tipos";

const etapasDe = (fonte: string): Record<string, string> => ({
  iniciando: "iniciando",
  extrato: "lendo o extrato",
  bases: `lendo os títulos do ${fonte}`,
  agregados: "calculando",
  gravando: "gravando",
});

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Quando os dados foram gerados e o estado da rodada mais recente. Com uma
 * rodada na fila ou rodando, a página se atualiza sozinha até ela terminar.
 */
export function StatusAtualizacao({
  atualizadoEm,
  execucoes,
  mostrarErro,
  provedor = "omie",
}: {
  atualizadoEm: string | null;
  execucoes: ExecucaoCaixa[];
  mostrarErro: boolean;
  provedor?: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [mensagem, setMensagem] = useState<string | null>(null);
  const etapas = etapasDe(provedor === "nibo" ? "Nibo" : "Omie");
  const ultima = execucoes[0];
  const emCurso = ultima && (ultima.status === "na_fila" || ultima.status === "em_andamento");

  useEffect(() => {
    if (!emCurso) return;
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [emCurso, router]);

  function atualizar() {
    setMensagem(null);
    iniciar(async () => {
      const r = await atualizarFluxoCaixa();
      if (r.erro) setMensagem(r.erro);
      else if (r.jaNaFila) setMensagem("Já há uma atualização em andamento.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {atualizadoEm ? (
        <span className="rounded-full border border-border px-2.5 py-1 tabular-nums text-fg-muted">Dados de {hora(atualizadoEm)}</span>
      ) : null}
      {emCurso ? (
        <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-fg-muted">
          <IconAtualizar className="size-3.5 animate-spin" />
          {ultima.status === "na_fila" ? "Atualização na fila" : `Atualizando: ${etapas[ultima.etapa ?? ""] ?? "em andamento"}`}
          {ultima.iniciadaEm ? ` · desde ${hora(ultima.iniciadaEm).slice(-5)}` : ""}
        </span>
      ) : ultima?.status === "erro" ? (
        <span role="status" className="rounded-full bg-danger-bg px-2.5 py-1 text-danger" title={mostrarErro ? (ultima.erro ?? undefined) : undefined}>
          A última atualização falhou{ultima.concluidaEm ? ` (${hora(ultima.concluidaEm)})` : ""}
          {mostrarErro && ultima.erro ? `: ${ultima.erro.slice(0, 120)}` : ""}
        </span>
      ) : null}
      <button type="button" onClick={atualizar} disabled={pendente || Boolean(emCurso)} className={clsx(classesBotao("secondary"))}>
        <IconAtualizar className={clsx("size-4", pendente && "animate-spin")} />
        {pendente ? "Enviando…" : "Atualizar agora"}
      </button>
      {mensagem ? <span role="status" className="w-full text-right text-fg-muted">{mensagem}</span> : null}
    </div>
  );
}
