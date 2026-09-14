"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  IconCheck,
  IconChevronUpDown,
  IconClose,
  IconEmpresa,
  IconPlus,
} from "@/components/icons";
import { Button } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import { cadastrarEmpresa, selecionarEmpresa } from "@/lib/acoes";
import { iniciais, type Empresa } from "@/lib/tipos";

/**
 * As empresas chegam por prop, resolvidas no servidor — o cliente não decide
 * mais o que existe. Trocar de empresa é uma Server Action, que revalida a
 * página inteira para tudo passar a consultar a empresa nova.
 */
export function EmpresaSwitcher({
  empresas,
  empresaAtual,
  onNavegar,
}: {
  empresas: Empresa[];
  empresaAtual: Empresa | null;
  onNavegar?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const listaId = useId();

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

  const nome = empresaAtual?.nome ?? "Sem empresa";

  // A Admin (plataforma) só entra nesta lista para quem administra a
  // plataforma — para o resto, `empresas` já vem filtrada só com as próprias.
  // É essa presença que decide se mostramos a hierarquia (Admin + clientes)
  // ou a lista simples de sempre.
  const principal = empresas.find((e) => e.eh_plataforma);
  const clientes = empresas.filter((e) => !e.eh_plataforma);
  const ehAdminPlataforma = Boolean(principal);
  const nivelAtual = empresaAtual?.eh_plataforma ? "Empresa principal" : "Empresa";

  function escolher(empresaId: string) {
    setAberto(false);
    onNavegar?.();
    iniciarTransicao(() => {
      void selecionarEmpresa(empresaId);
    });
  }

  return (
    <>
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-controls={aberto ? listaId : undefined}
          className={clsx(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            aberto ? "bg-surface-muted" : "hover:bg-surface-muted",
            pendente && "opacity-60",
          )}
        >
          <div
            className={clsx(
              "grid size-7 shrink-0 place-items-center overflow-hidden rounded-md text-[10px] font-bold",
              // Fundo só atrás das iniciais: sobre a logo ele viraria uma
              // moldura colorida em volta de uma imagem com fundo próprio.
              empresaAtual?.logo_url
                ? "border border-border bg-surface"
                : "bg-accent text-accent-fg",
            )}
          >
            {empresaAtual?.logo_url ? (
              // `img` e não `next/image`: proporção livre, bucket público e
              // 28 px de lado — não há o que otimizar.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={empresaAtual.logo_url}
                alt=""
                className="size-full object-contain"
              />
            ) : (
              iniciais(nome) || "E"
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
              {nivelAtual}
            </p>
            <p className="truncate text-sm font-semibold tracking-tight">{nome}</p>
          </div>
          <IconChevronUpDown className="size-4 shrink-0 text-fg-subtle" />
        </button>

        {aberto ? (
          <div
            id={listaId}
            role="listbox"
            aria-label="Selecionar empresa"
            className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
          >
            {empresas.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-fg-muted">
                Você ainda não participa de nenhuma empresa.
              </p>
            ) : ehAdminPlataforma ? (
              <div className="max-h-72 overflow-y-auto p-1">
                <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                  Principal
                </p>
                <ul>
                  <ItemEmpresa
                    empresa={principal!}
                    atual={principal!.id === empresaAtual?.id}
                    onEscolher={() => escolher(principal!.id)}
                  />
                </ul>

                {clientes.length > 0 ? (
                  <>
                    <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                      Clientes
                    </p>
                    {/* Recuo + linha vertical: as clientes ficam visualmente
                        "dentro" da principal, não soltas ao lado dela. */}
                    <ul className="ml-3 space-y-0.5 border-l border-border pl-2">
                      {clientes.map((empresa) => (
                        <ItemEmpresa
                          key={empresa.id}
                          empresa={empresa}
                          atual={empresa.id === empresaAtual?.id}
                          onEscolher={() => escolher(empresa.id)}
                        />
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : (
              <ul className="max-h-64 overflow-y-auto p-1">
                {empresas.map((empresa) => (
                  <ItemEmpresa
                    key={empresa.id}
                    empresa={empresa}
                    atual={empresa.id === empresaAtual?.id}
                    onEscolher={() => escolher(empresa.id)}
                  />
                ))}
              </ul>
            )}

            {ehAdminPlataforma ? (
              <div className="border-t border-border p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAberto(false);
                    setCadastrando(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
                >
                  <IconPlus className="size-4 shrink-0" />
                  Cadastrar empresa cliente
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {cadastrando ? (
        <ModalCadastro
          empresas={empresas}
          onFechar={() => setCadastrando(false)}
          onCadastrado={() => {
            setCadastrando(false);
            onNavegar?.();
          }}
        />
      ) : null}
    </>
  );
}

function ItemEmpresa({
  empresa,
  atual,
  onEscolher,
}: {
  empresa: Empresa;
  atual: boolean;
  onEscolher: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={atual}
        onClick={onEscolher}
        className={clsx(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
          atual
            ? "bg-surface-muted font-medium text-fg"
            : "text-fg-muted hover:bg-surface-muted hover:text-fg",
        )}
      >
        {empresa.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={empresa.logo_url}
            alt=""
            className="size-4 shrink-0 rounded-sm object-contain"
          />
        ) : (
          <IconEmpresa className="size-4 shrink-0 text-fg-subtle" />
        )}
        <span className="min-w-0 flex-1 truncate">{empresa.nome}</span>
        {atual ? <IconCheck className="size-4 shrink-0" /> : null}
      </button>
    </li>
  );
}

function ModalCadastro({
  empresas,
  onFechar,
  onCadastrado,
}: {
  empresas: Empresa[];
  onFechar: () => void;
  onCadastrado: () => void;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const primeiroCampoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primeiroCampoRef.current?.focus();

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro("Informe o nome da empresa.");
      return;
    }
    const duplicada = empresas.some(
      (e) => e.nome.trim().toLowerCase() === nomeLimpo.toLowerCase(),
    );
    if (duplicada) {
      setErro("Já existe uma empresa com esse nome.");
      return;
    }

    setEnviando(true);
    const resultado = await cadastrarEmpresa({ nome: nomeLimpo });
    setEnviando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }
    onCadastrado();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div
        role="presentation"
        onClick={onFechar}
        className="absolute inset-0 bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cadastro-empresa"
        className="relative w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2
              id="titulo-cadastro-empresa"
              className="text-sm font-semibold tracking-tight"
            >
              Cadastrar empresa cliente
            </h2>
            <p className="text-xs text-fg-muted">
              Entra como cliente da Proos e passa a ser a selecionada no painel.
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
          <Campo label="Nome da empresa" obrigatorio>
            <input
              ref={primeiroCampoRef}
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErro(null);
              }}
              placeholder="Ex.: Indústria Exemplo Ltda."
              className={campoClasses}
            />
          </Campo>

          {erro ? (
            <p role="alert" className="text-xs text-danger">
              {erro}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={enviando}>
              {enviando ? "Cadastrando…" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const campoClasses =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-ring";

function Campo({
  label,
  obrigatorio,
  children,
}: {
  label: string;
  obrigatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">
        {label}
        {obrigatorio ? (
          <span className="text-fg-subtle" aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}
