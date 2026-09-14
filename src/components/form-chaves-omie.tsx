"use client";

import { useEffect, useState } from "react";
import { Field, Input } from "@/components/form";
import { IconAlerta, IconCheck, IconClose, IconConfiguracoes } from "@/components/icons";
import { Badge, Button, classesBotao } from "@/components/ui";
import { salvarChavesOmie } from "@/lib/acoes";
import type { PresencaChave, StatusChavesOmie } from "@/lib/omie/resumo";

/**
 * "Gerenciar chaves" do Resumo Omie — só renderizado para admin da Proos.
 *
 * O pop-up mostra o status das chaves atuais e recebe chaves novas. Os
 * valores nunca chegam ao navegador: o servidor manda só se cada chave existe
 * e se o Omie a aceitou. As "bolinhas" são desenho, não a chave mascarada.
 */
export function BotaoChavesOmie({
  empresaId,
  status,
}: {
  empresaId: string;
  status: StatusChavesOmie;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={classesBotao("secondary")}>
        <IconConfiguracoes className="size-5" />
        Gerenciar chaves
      </button>

      {aberto ? (
        <ModalChavesOmie
          empresaId={empresaId}
          status={status}
          onFechar={() => setAberto(false)}
        />
      ) : null}
    </>
  );
}

function ModalChavesOmie({
  empresaId,
  status,
  onFechar,
}: {
  empresaId: string;
  status: StatusChavesOmie;
  onFechar: () => void;
}) {
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const temChaves = status.chaves.some((chave) => chave.presenca === "cadastrada");

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div role="presentation" onClick={onFechar} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-chaves-omie"
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 id="titulo-chaves-omie" className="text-sm font-semibold tracking-tight">
              Chaves do Omie
            </h2>
            <p className="text-xs text-fg-muted">
              Gravadas no Infisical, na pasta deste cliente. Os valores não são exibidos.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-muted"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {/* ------------------------------ Status atual ------------------------------ */}
        <section aria-label="Status das chaves atuais" className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
              Chaves atuais
            </h3>
            <SeloValidacao validacao={status.validacao} />
          </div>

          <ul className="divide-y divide-border rounded-md border border-border">
            {status.chaves.map((chave) => (
              <li key={chave.nome} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-mono text-xs text-fg-muted">{chave.nome}</p>
                  <p
                    aria-label={chave.presenca === "cadastrada" ? "Valor oculto" : "Sem valor"}
                    className="font-mono text-sm tracking-[0.2em] text-fg"
                  >
                    {chave.presenca === "cadastrada" ? "••••••••••••" : "—"}
                  </p>
                </div>
                <SeloPresenca presenca={chave.presenca} />
              </li>
            ))}
          </ul>

          {status.validacao.tipo === "recusadas" || status.validacao.tipo === "nao-verificadas" ? (
            <p className="text-xs text-fg-muted">{status.validacao.mensagem}</p>
          ) : null}
        </section>

        {/* ------------------------------ Chaves novas ------------------------------ */}
        <section aria-labelledby="titulo-novas-chaves" className="space-y-3 px-5 py-4">
          <h3
            id="titulo-novas-chaves"
            className="text-xs font-medium uppercase tracking-wider text-fg-subtle"
          >
            {temChaves ? "Substituir chaves" : "Cadastrar chaves"}
          </h3>
          {status.infisicalConfigurado ? (
            <FormChavesOmie empresaId={empresaId} substituir={temChaves} onSalvo={onFechar} />
          ) : (
            <p className="text-sm text-fg-muted">
              Configure o Infisical em Configurações, com a Proos selecionada, antes de cadastrar
              as chaves.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function SeloPresenca({ presenca }: { presenca: PresencaChave }) {
  if (presenca === "cadastrada") {
    return (
      <Badge tone="success" className="shrink-0">
        <IconCheck className="size-4" />
        Cadastrada
      </Badge>
    );
  }
  if (presenca === "ausente") {
    return (
      <Badge tone="warning" className="shrink-0">
        <IconAlerta className="size-4" />
        Ausente
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" className="shrink-0">
      Desconhecido
    </Badge>
  );
}

function SeloValidacao({ validacao }: { validacao: StatusChavesOmie["validacao"] }) {
  switch (validacao.tipo) {
    case "validas":
      return (
        <Badge tone="success">
          <IconCheck className="size-4" />
          Conectado ao Omie
        </Badge>
      );
    case "recusadas":
      return (
        <Badge tone="danger">
          <IconAlerta className="size-4" />
          Recusadas pelo Omie
        </Badge>
      );
    case "ausentes":
      return (
        <Badge tone="warning">
          <IconAlerta className="size-4" />
          Não cadastradas
        </Badge>
      );
    case "nao-verificadas":
      return <Badge tone="neutral">Não verificadas</Badge>;
  }
}

/**
 * Os valores vão direto para o Infisical, na pasta do cliente; o painel não
 * guarda nem devolve nenhum dos dois, por isso os campos sempre começam
 * vazios.
 */
function FormChavesOmie({
  empresaId,
  substituir,
  onSalvo,
}: {
  empresaId: string;
  substituir?: boolean;
  onSalvo?: () => void;
}) {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string }
  >({ tipo: "ocioso" });

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setEstado({ tipo: "salvando" });
    const resultado = await salvarChavesOmie({ empresaId, appKey, appSecret });

    if (resultado.erro) {
      setEstado({ tipo: "erro", msg: resultado.erro });
      return;
    }
    // A action revalida a página: ao fechar, o resumo já reflete as chaves novas.
    onSalvo?.();
  }

  return (
    <form onSubmit={salvar} className="space-y-4" noValidate>
      <Field label="App Key" hint="Omie → Configurações → Desenvolvedor → Meus aplicativos.">
        <Input
          autoFocus
          value={appKey}
          onChange={(e) => {
            setAppKey(e.target.value);
            setEstado({ tipo: "ocioso" });
          }}
          autoComplete="off"
          className="font-mono text-xs"
        />
      </Field>
      <Field label="App Secret">
        <Input
          type="password"
          value={appSecret}
          onChange={(e) => {
            setAppSecret(e.target.value);
            setEstado({ tipo: "ocioso" });
          }}
          autoComplete="off"
          placeholder="••••••••"
          className="font-mono text-xs"
        />
      </Field>

      {estado.tipo === "erro" ? (
        <p role="alert" className="text-xs text-danger">
          {estado.msg}
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          As chaves são testadas no Omie antes de ir para o Infisical.
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button
          type="submit"
          variant="primary"
          disabled={estado.tipo === "salvando" || !appKey.trim() || !appSecret.trim()}
        >
          {estado.tipo === "salvando" ? "Testando…" : substituir ? "Substituir chaves" : "Salvar chaves"}
        </Button>
      </div>
    </form>
  );
}
