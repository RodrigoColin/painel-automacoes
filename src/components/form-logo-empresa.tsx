"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { IconLixeira } from "@/components/icons";
import { iniciais } from "@/lib/tipos";
import { atualizarLogoEmpresa, removerLogoEmpresa } from "@/lib/acoes";
import { TAMANHO_MAXIMO_LOGO, TIPOS_LOGO_ACEITOS } from "@/lib/logo-empresa";

type Estado =
  | { tipo: "ocioso" }
  | { tipo: "enviando" }
  | { tipo: "erro"; msg: string }
  | { tipo: "ok" };

/**
 * Envia a logo que substitui as iniciais da empresa no seletor da barra
 * lateral. Escolher o arquivo já envia — não há um "Salvar" separado porque
 * não existe estado intermediário útil: ou a imagem nova vale, ou continua a
 * anterior.
 */
export function FormLogoEmpresa({
  empresaId,
  nomeEmpresa,
  logoAtual,
}: {
  empresaId: string;
  nomeEmpresa: string;
  logoAtual: string | null;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "ocioso" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviar(arquivo: File) {
    // A validação de verdade está na action; esta só evita a ida ao servidor
    // com um arquivo que já se sabe recusado.
    if (!TIPOS_LOGO_ACEITOS.includes(arquivo.type)) {
      setEstado({ tipo: "erro", msg: "Use uma imagem PNG, JPG, WEBP ou SVG." });
      return;
    }
    if (arquivo.size > TAMANHO_MAXIMO_LOGO) {
      setEstado({ tipo: "erro", msg: "A imagem passa do limite de 512 KB." });
      return;
    }

    setEstado({ tipo: "enviando" });

    const dados = new FormData();
    dados.set("empresaId", empresaId);
    dados.set("arquivo", arquivo);

    const resultado = await atualizarLogoEmpresa(dados);
    setEstado(resultado.erro ? { tipo: "erro", msg: resultado.erro } : { tipo: "ok" });
  }

  async function remover() {
    setEstado({ tipo: "enviando" });
    const resultado = await removerLogoEmpresa(empresaId);
    setEstado(resultado.erro ? { tipo: "erro", msg: resultado.erro } : { tipo: "ok" });
  }

  const ocupado = estado.tipo === "enviando";

  // Sem `Field`: ele embrulha tudo num `label`, e aí um clique em "Remover"
  // abriria o seletor de arquivo junto — o input de arquivo é o primeiro
  // controle de dentro, logo o rotulado pelo `label`.
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_260px] sm:items-center sm:gap-4">
      <div>
        <p className="text-sm font-medium">Logo</p>
        <p className="text-xs text-fg-subtle">
          {estado.tipo === "erro"
            ? estado.msg
            : estado.tipo === "ok"
              ? "Salvo."
              : "PNG, JPG, WEBP ou SVG, até 512 KB. Aparece no lugar das iniciais na barra lateral."}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-muted text-xs font-bold text-fg-muted">
          {logoAtual ? (
            // `img` e não `next/image`: a logo tem proporção livre, vem de um
            // bucket público e é exibida em 48 px — não há o que otimizar.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoAtual}
              alt={`Logo de ${nomeEmpresa}`}
              className="size-full object-contain"
            />
          ) : (
            iniciais(nomeEmpresa) || "E"
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={TIPOS_LOGO_ACEITOS.join(",")}
          className="hidden"
          aria-label="Arquivo da logo"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            // Limpa o input para que escolher o mesmo arquivo de novo
            // (depois de um erro) continue disparando `change`.
            e.target.value = "";
            if (arquivo) void enviar(arquivo);
          }}
        />

        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
          className="shrink-0"
        >
          {ocupado ? "Enviando…" : logoAtual ? "Trocar" : "Enviar"}
        </Button>

        {logoAtual ? (
          // Sem `variant="ghost"`: ele traz `text-fg-muted`, e duas classes
          // de cor na mesma tag brigam pela ordem do CSS.
          <button
            type="button"
            onClick={remover}
            disabled={ocupado}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-danger transition-colors hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <IconLixeira className="size-4" />
            Remover
          </button>
        ) : null}
      </div>
    </div>
  );
}
