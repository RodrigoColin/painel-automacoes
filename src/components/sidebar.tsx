"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { clsx } from "@/lib/clsx";
import { AlternadorTema } from "@/components/alternador-tema";
import { EmpresaSwitcher } from "@/components/empresa-switcher";
import { sair } from "@/app/(auth)/login/acoes";
import { chaveDaRota, type ConfigTelas } from "@/lib/telas";
import { iniciais, type Empresa } from "@/lib/tipos";
import {
  IconAutomacoes,
  IconChave,
  IconChevron,
  IconClose,
  IconConfiguracoes,
  IconDashboard,
  IconFluxoCaixa,
  IconHistorico,
  IconMenu,
  IconResumoFinanceiro,
  IconSair,
  IconUpload,
  IconUsuarios,
  IconValidacaoSaldo,
} from "@/components/icons";

type ItemNav = { href: string; label: string; icon: typeof IconDashboard };
type GrupoNav = { label: string; icon: typeof IconDashboard; itens: ItemNav[] };

// Itens soltos ANTES dos grupos (so o Dashboard).
const NAV_TOPO: ItemNav[] = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
];

// Grupos expansiveis — cada um vira uma secao com sub-itens, nao um link
// direto. "Conciliação Bancária" comeca com 1 item de proposito: e onde as
// proximas telas desse fluxo (fila de revisao conectada, etc.) vao entrar.
const NAV_GRUPOS: GrupoNav[] = [
  {
    label: "Gestão Financeira",
    icon: IconResumoFinanceiro,
    itens: [
      { href: "/omie", label: "Gestão de Receitas", icon: IconResumoFinanceiro },
      { href: "/fluxo-caixa", label: "Fluxo de caixa", icon: IconFluxoCaixa },
    ],
  },
  {
    label: "Conciliação Bancária",
    icon: IconValidacaoSaldo,
    itens: [
      { href: "/validacao-saldo", label: "Validação de saldo", icon: IconValidacaoSaldo },
      { href: "/conciliacao-bancaria", label: "Enviar extrato", icon: IconUpload },
    ],
  },
];

// Itens soltos DEPOIS dos grupos.
const NAV_RESTO: ItemNav[] = [
  { href: "/automacoes", label: "Automações", icon: IconAutomacoes },
  { href: "/historico", label: "Histórico", icon: IconHistorico },
  { href: "/acessos", label: "Acessos e chaves", icon: IconChave },
  { href: "/usuarios", label: "Usuários", icon: IconUsuarios },
  { href: "/configuracoes", label: "Configurações", icon: IconConfiguracoes },
];

function LinkItem({
  href,
  label,
  icon: Icon,
  active,
  indent,
  onNavigate,
}: {
  href: string;
  label: string;
  icon?: typeof IconDashboard;
  active: boolean;
  indent?: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center gap-3 rounded-md py-2 text-sm transition-colors",
        indent ? "pl-9 pr-2.5" : "px-2.5",
        active
          ? "bg-surface-muted font-medium text-fg"
          : "text-fg-muted hover:bg-surface-muted hover:text-fg"
      )}
    >
      {Icon ? <Icon className="size-5 shrink-0" /> : null}
      {label}
    </Link>
  );
}

// Grupo expansivel — o cabecalho e um botao (nao um Link, ele nao tem
// pagina propria), abre/fecha os sub-itens. Comeca aberto se a rota atual
// for uma das dele, senao fechado — sem isso, cair direto numa pagina de
// dentro do grupo (refresh, link externo) escondia a propria pagina ativa
// atras de um menu fechado.
function GrupoNavItem({
  grupo,
  pathname,
  onNavigate,
}: {
  grupo: GrupoNav;
  pathname: string;
  onNavigate: () => void;
}) {
  const algumAtivo = grupo.itens.some(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`)
  );
  const [expandido, setExpandido] = useState(algumAtivo);
  const Icon = grupo.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        aria-expanded={expandido}
        className={clsx(
          "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
          algumAtivo
            ? "font-medium text-fg"
            : "text-fg-muted hover:bg-surface-muted hover:text-fg"
        )}
      >
        <Icon className="size-5 shrink-0" />
        <span className="flex-1 text-left">{grupo.label}</span>
        <IconChevron
          className={clsx(
            "size-4 shrink-0 transition-transform",
            expandido && "rotate-90"
          )}
        />
      </button>
      {expandido ? (
        <div className="space-y-1 pt-1">
          {grupo.itens.map((item) => (
            <LinkItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              indent
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  empresas,
  empresaAtual,
  usuario,
  telasOcultas,
  configTelas,
}: {
  empresas: Empresa[];
  empresaAtual: Empresa | null;
  usuario: { nome: string; email: string };
  /** Telas que a Proos desligou para o nível de quem está logado. */
  telasOcultas: string[];
  configTelas: { habilitado: boolean; config: ConfigTelas | null };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const visivel = (item: ItemNav) => {
    const chave = chaveDaRota(item.href);
    return !chave || !telasOcultas.includes(chave);
  };
  const navTopo = NAV_TOPO.filter(visivel);
  const navResto = NAV_RESTO.filter(visivel);
  // Grupo sem nenhuma tela liberada some inteiro, em vez de abrir vazio.
  const navGrupos = NAV_GRUPOS.map((grupo) => ({ ...grupo, itens: grupo.itens.filter(visivel) })).filter(
    (grupo) => grupo.itens.length > 0,
  );

  return (
    <>
      {/* Barra superior — apenas mobile */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="grid size-9 place-items-center rounded-md border border-border text-fg-muted hover:bg-surface-muted"
        >
          <IconMenu className="size-5" />
        </button>
        <EmpresaSwitcher empresas={empresas} empresaAtual={empresaAtual} configTelas={configTelas} />
      </div>

      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center gap-1 border-b border-border px-3">
          <EmpresaSwitcher
            empresas={empresas}
            empresaAtual={empresaAtual}
            onNavegar={() => setOpen(false)}
            configTelas={configTelas}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-muted lg:hidden"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Geral
          </p>
          {navTopo.map(({ href, label, icon }) => (
            <LinkItem
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={pathname === href || pathname.startsWith(`${href}/`)}
              onNavigate={() => setOpen(false)}
            />
          ))}
          {navGrupos.map((grupo) => (
            <GrupoNavItem
              key={grupo.label}
              grupo={grupo}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
            />
          ))}
          {navResto.map(({ href, label, icon }) => (
            <LinkItem
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={pathname === href || pathname.startsWith(`${href}/`)}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <AlternadorTema />

          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-medium text-fg-muted">
              {iniciais(usuario.nome) || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{usuario.nome}</p>
              <p className="truncate text-xs text-fg-subtle">{usuario.email}</p>
            </div>
          </div>
          <form action={sair}>
            {/* Vermelho e com ícone: é a única ação da barra que tira a
                pessoa do painel, e estava com a mesma cara dos itens de
                navegação. */}
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-bg"
            >
              <IconSair className="size-5 shrink-0" />
              Sair
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
