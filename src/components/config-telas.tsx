"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { IconConfiguracoes } from "@/components/icons";
import { Toggle } from "@/components/toggle";
import { clsx } from "@/lib/clsx";
import { salvarTelaEmpresa } from "@/lib/acoes";
import { TELAS, type ConfigTelas, type NivelTela } from "@/lib/telas";
import type { Empresa } from "@/lib/tipos";

/**
 * Engrenagem ao lado do seletor de empresa, só para admin da plataforma.
 * Abre a lista de telas com um interruptor por nível: "Interno" é a equipe da
 * Proos olhando esta empresa, "Externo" são as pessoas do cliente. Vale para a
 * empresa selecionada no momento.
 */
export function ConfigTelasEmpresa({
  empresa,
  config,
}: {
  empresa: Empresa | null;
  config: ConfigTelas | null;
}) {
  const [aberto, setAberto] = useState(false);
  // O interruptor muda no clique; se o servidor recusar, a transição termina
  // e o valor volta sozinho ao que veio de `config`.
  const [valores, aplicar] = useOptimistic(
    config,
    (atual, mudanca: { tela: string; nivel: NivelTela; ativo: boolean }) =>
      atual
        ? { ...atual, [mudanca.tela]: { ...atual[mudanca.tela], [mudanca.nivel]: mudanca.ativo } }
        : atual,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const painelId = useId();

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(evento: MouseEvent) {
      if (!containerRef.current?.contains(evento.target as Node)) setAberto(false);
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

  function alternar(tela: string, nivel: NivelTela, ativo: boolean) {
    if (!empresa || !valores) return;
    setErro(null);

    iniciarTransicao(async () => {
      aplicar({ tela, nivel, ativo });
      const resposta = await salvarTelaEmpresa(empresa.id, tela, nivel, ativo);
      if (resposta.erro) setErro(resposta.erro);
    });
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? painelId : undefined}
        aria-label="Configurar telas"
        title="Configurar telas"
        className={clsx(
          "grid size-8 place-items-center rounded-md text-fg-muted transition-colors",
          "hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          aberto && "bg-surface-muted text-fg",
        )}
      >
        <IconConfiguracoes className="size-4" />
      </button>

      {aberto ? (
        <div
          id={painelId}
          role="dialog"
          aria-label="Telas por nível de acesso"
          className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[85vw] rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <p className="text-sm font-semibold tracking-tight">Telas por nível de acesso</p>

          {!empresa || empresa.eh_plataforma || !valores ? (
            <p className="pt-2 text-xs text-fg-muted">
              Selecione uma empresa cliente para escolher quais telas ela e a equipe da Proos enxergam.
            </p>
          ) : (
            <>
              <p className="truncate pt-0.5 text-xs text-fg-muted">{empresa.nome}</p>

              <div className="mt-3 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2.5">
                <span />
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                  Interno
                </span>
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                  Externo
                </span>

                {TELAS.map((tela) => (
                  <Linha
                    key={tela.chave}
                    rotulo={tela.rotulo}
                    estado={valores[tela.chave] ?? { interno: true, externo: true }}
                    onAlterar={(nivel, ativo) => alternar(tela.chave, nivel, ativo)}
                  />
                ))}
              </div>

              <p className="pt-3 text-[11px] leading-snug text-fg-subtle">
                Interno: equipe da Proos. Externo: pessoas da empresa cliente. Usuários e Configurações
                ficam sempre liberados.
                {pendente ? " Salvando…" : ""}
              </p>
              {erro ? <p className="pt-1 text-xs text-danger">{erro}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Linha({
  rotulo,
  estado,
  onAlterar,
}: {
  rotulo: string;
  estado: { interno: boolean; externo: boolean };
  onAlterar: (nivel: NivelTela, ativo: boolean) => void;
}) {
  return (
    <>
      <span className="truncate text-sm">{rotulo}</span>
      <div className="grid place-items-center">
        <Toggle
          label={`${rotulo}: equipe interna`}
          checked={estado.interno}
          onChange={(ativo) => onAlterar("interno", ativo)}
        />
      </div>
      <div className="grid place-items-center">
        <Toggle
          label={`${rotulo}: clientes (externo)`}
          checked={estado.externo}
          onChange={(ativo) => onAlterar("externo", ativo)}
        />
      </div>
    </>
  );
}
