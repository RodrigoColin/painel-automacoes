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
import { formatarCnpj, iniciais, type Empresa } from "@/lib/tipos";

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
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-[10px] font-bold text-accent-fg">
            {iniciais(nome) || "E"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
              Empresa
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
            <p className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
              Empresas
            </p>
            {empresas.length === 0 ? (
              <p className="px-3 pb-2 text-xs text-fg-muted">
                Você ainda não participa de nenhuma empresa.
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto p-1">
                {empresas.map((empresa) => {
                  const atual = empresa.id === empresaAtual?.id;
                  return (
                    <li key={empresa.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={atual}
                        onClick={() => {
                          setAberto(false);
                          onNavegar?.();
                          iniciarTransicao(() => {
                            void selecionarEmpresa(empresa.id);
                          });
                        }}
                        className={clsx(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
                          atual
                            ? "bg-surface-muted font-medium text-fg"
                            : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                        )}
                      >
                        <IconEmpresa className="size-4 shrink-0 text-fg-subtle" />
                        <span className="min-w-0 flex-1 truncate">
                          {empresa.nome}
                        </span>
                        {atual ? <IconCheck className="size-4 shrink-0" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
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
                Cadastrar empresa
              </button>
            </div>
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
  const [cnpj, setCnpj] = useState("");
  const [email, setEmail] = useState("");
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
    const resultado = await cadastrarEmpresa({
      nome: nomeLimpo,
      cnpj: cnpj.trim() || undefined,
      email: email.trim() || undefined,
    });
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
              Cadastrar empresa
            </h2>
            <p className="text-xs text-fg-muted">
              A empresa criada passa a ser a selecionada no painel.
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

          <Campo label="CNPJ">
            <input
              value={cnpj}
              onChange={(e) => setCnpj(formatarCnpj(e.target.value))}
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              className={campoClasses}
            />
          </Campo>

          <Campo label="E-mail de contato">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="contato@exemplo.com"
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
