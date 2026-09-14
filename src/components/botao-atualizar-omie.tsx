"use client";

import { useEffect, useState, useTransition } from "react";
import { IconAtualizar } from "@/components/icons";
import { classesBotao } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { atualizarFaturamentoOmie, atualizarResumoOmie } from "@/lib/acoes";

/**
 * Busca o resumo de novo no Omie, sem esperar os cinco minutos do cache.
 *
 * Se a última consulta foi há menos de um minuto, o servidor não consulta e
 * devolve quanto falta — o botão vira uma contagem regressiva em vez de
 * provocar a recusa por "consumo redundante" do Omie.
 */
export function BotaoAtualizarOmie({
  alvo = "financeiro",
  rotulo = "Atualizar",
}: {
  /** `faturamento` sincroniza as OS no banco (pode levar ~20 s; ~2 min na primeira vez). */
  alvo?: "financeiro" | "faturamento";
  rotulo?: string;
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const [espera, setEspera] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const timer = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [espera]);

  const aguardando = espera > 0;

  function atualizar() {
    setErro(null);
    iniciarTransicao(async () => {
      const resultado =
        alvo === "faturamento" ? await atualizarFaturamentoOmie() : await atualizarResumoOmie();
      if (resultado.erro) setErro(resultado.erro);
      else if (resultado.esperarSegundos) setEspera(resultado.esperarSegundos);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={atualizar}
        disabled={pendente || aguardando}
        title={
          erro ??
          (aguardando
            ? "O Omie recusa consultas repetidas em menos de um minuto."
            : "Consultar o Omie de novo agora")
        }
        className={clsx(classesBotao("secondary"), "tabular-nums")}
      >
        <IconAtualizar className={clsx("size-4", pendente && "animate-spin")} />
        {pendente
          ? alvo === "faturamento"
            ? "Sincronizando…"
            : "Atualizando…"
          : aguardando
            ? `Aguarde ${espera}s`
            : rotulo}
      </button>
      {/* Anuncia o resultado para leitor de tela sem mexer no layout do cabeçalho. */}
      <span role="status" className="sr-only">
        {erro ?? (aguardando ? `Aguarde ${espera} segundos para atualizar de novo.` : "")}
      </span>
    </>
  );
}
