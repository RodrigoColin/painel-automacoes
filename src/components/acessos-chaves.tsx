"use client";

import { useEffect, useState, useTransition } from "react";
import { criarChave, excluirChave } from "@/lib/acoes";
import { formatarDataHora } from "@/lib/tipos";
import type { Chave } from "@/lib/consultas";
import { IconClose, IconPlus } from "@/components/icons";
import { Field, Input } from "@/components/form";
import { Button, EmptyHint, Table, Td, Th, classesBotao } from "@/components/ui";

export function BotaoNovaChave() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={classesBotao("primary")}>
        <IconPlus className="size-4" />
        Nova chave
      </button>

      {aberto ? <ModalChave onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

function ModalChave({ onFechar }: { onFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    if (!nome.trim()) {
      setErro("Informe o nome da chave.");
      return;
    }
    if (!valor.trim()) {
      setErro("Informe o valor da chave.");
      return;
    }

    setSalvando(true);
    const resultado = await criarChave({ nome, descricao, valor });
    setSalvando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }
    onFechar();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div role="presentation" onClick={onFechar} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-nova-chave"
        className="relative w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 id="titulo-nova-chave" className="text-sm font-semibold tracking-tight">
              Nova chave
            </h2>
            <p className="text-xs text-fg-muted">
              O valor é gravado e não volta a ser exibido. Para trocá-lo, exclua
              a chave e cadastre de novo.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-muted"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-5 py-4">
          <Field
            label="Nome"
            hint="É por este nome que a automação pede a chave. Único dentro da empresa."
            required
          >
            <Input
              autoFocus
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErro(null);
              }}
              placeholder="STRIPE_API_KEY"
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Descrição" hint="Para que serve, onde é usada.">
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Chave de produção da Stripe"
            />
          </Field>

          <Field label="Valor" required>
            <Input
              value={valor}
              onChange={(e) => {
                setValor(e.target.value);
                setErro(null);
              }}
              type="password"
              autoComplete="off"
              placeholder="••••••••"
              className="font-mono text-xs"
            />
          </Field>

          {erro ? (
            <p role="alert" className="text-xs text-danger">
              {erro}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar chave"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ListaChaves({
  chaves,
  podeGerenciar,
}: {
  chaves: Chave[];
  podeGerenciar: boolean;
}) {
  const [, iniciarTransicao] = useTransition();

  if (chaves.length === 0) {
    return (
      <EmptyHint>
        Nenhuma chave cadastrada. As credenciais guardadas aqui ficam
        disponíveis para as automações desta empresa.
      </EmptyHint>
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Nome</Th>
          <Th>Descrição</Th>
          <Th>Cadastrada por</Th>
          <Th>Data</Th>
          {podeGerenciar ? <Th className="w-24" /> : null}
        </tr>
      </thead>
      <tbody>
        {chaves.map((chave) => (
          <tr key={chave.id} className="hover:bg-surface-muted/50">
            <Td>
              <span className="font-mono text-xs font-medium">{chave.nome}</span>
            </Td>
            <Td className="text-fg-muted">{chave.descricao || "—"}</Td>
            <Td className="text-fg-muted">{chave.criadoPor ?? "—"}</Td>
            <Td className="text-fg-muted tabular-nums">
              {formatarDataHora(chave.criadoEm)}
            </Td>
            {podeGerenciar ? (
              <Td>
                <BotaoExcluir
                  nome={chave.nome}
                  onExcluir={() =>
                    iniciarTransicao(() => {
                      void excluirChave(chave.id);
                    })
                  }
                />
              </Td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Exclusão é irreversível e o valor não é recuperável de lugar nenhum, então
 * exige um segundo clique em vez de disparar de primeira.
 */
function BotaoExcluir({ nome, onExcluir }: { nome: string; onExcluir: () => void }) {
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!confirmando) return;
    const timer = setTimeout(() => setConfirmando(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmando]);

  if (!confirmando) {
    return (
      <Button variant="ghost" onClick={() => setConfirmando(true)}>
        Excluir
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      aria-label={`Confirmar exclusão de ${nome}`}
      onClick={() => {
        setConfirmando(false);
        onExcluir();
      }}
    >
      <span className="text-danger">Confirmar</span>
    </Button>
  );
}
