type IconProps = React.SVGProps<SVGSVGElement>;

/**
 * Padrão de ícone do painel. Dois tamanhos, e só dois:
 *
 * - `size-5` (20 px) — o padrão. Botões, navegação, ações de linha, cabeçalho
 *   de modal. É o que sai quando nenhuma classe de tamanho é passada.
 * - `size-4` (16 px) — só para ícone que acompanha texto: item de lista,
 *   badge, linha de aviso.
 *
 * Nada de 3.5 ou 4.5: no traço fino do desenho, esses tamanhos deixavam o
 * ícone quase invisível — foi o que aconteceu com o lápis e a lixeira da
 * tela de usuários. O traço também subiu de 1.6 para 1.8 pelo mesmo motivo.
 */
function Base({
  children,
  className,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Sem `clsx`: duas classes de tamanho do Tailwind na mesma tag brigam
      // pela ordem do CSS, não pela ordem aqui. O padrão vale quando quem
      // chama não pediu tamanho nenhum.
      className={className ?? "size-5"}
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="3.5" width="7" height="8.5" rx="1.2" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.2" />
    <rect x="13.5" y="12" width="7" height="8.5" rx="1.2" />
    <rect x="3.5" y="15.5" width="7" height="5" rx="1.2" />
  </Base>
);

/** Gráfico de barras com tendência — usado no “Resumo Omie”. */
export const IconResumoFinanceiro = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 20.5h17" />
    <path d="M6.5 17v-4M11 17V9.5M15.5 17v-6M20 17V6.5" />
    <path d="m5.5 9 5-4.5 4 3 5-4" />
  </Base>
);

/** Entrada e saída sobre uma linha de saldo — a tela "Fluxo de caixa". */
export const IconFluxoCaixa = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 12h17" />
    <path d="M8 9.5V4m0 0L5.5 6.5M8 4l2.5 2.5" />
    <path d="M16 14.5V20m0 0 2.5-2.5M16 20l-2.5-2.5" />
  </Base>
);

export const IconAlerta = (p: IconProps) => (
  <Base {...p}>
    <path d="M10.7 4.1 2.9 17.4a1.5 1.5 0 0 0 1.3 2.3h15.6a1.5 1.5 0 0 0 1.3-2.3L13.3 4.1a1.5 1.5 0 0 0-2.6 0Z" />
    <path d="M12 9.5v4M12 17h0" />
  </Base>
);

export const IconListaMarcadores = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h0M4.5 12h0M4.5 17.5h0" />
  </Base>
);

export const IconListaNumerada = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 6.5h10M10 12h10M10 17.5h10" />
    <path d="M4 5.2 5.2 4.5v4M4 14.6c0-1.6 2.4-1.5 2.4-.1 0 1-1.6 1.6-2.4 3h2.6" />
  </Base>
);

export const IconDesfazer = (p: IconProps) => (
  <Base {...p}>
    <path d="M8 6 4 10l4 4" />
    <path d="M4 10h10a5 5 0 0 1 0 10h-3" />
  </Base>
);

export const IconRefazer = (p: IconProps) => (
  <Base {...p}>
    <path d="m16 6 4 4-4 4" />
    <path d="M20 10H10a5 5 0 0 0 0 10h3" />
  </Base>
);

export const IconCalendario = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Base>
);

/** Quadro de colunas (kanban). */
export const IconPlanosAcao = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M9.2 4v16M14.8 4v16M5.8 8h1.2M11.4 8h1.2M11.4 11.5h1.2M17 8h1.2" />
  </Base>
);

export const IconAutomacoes = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="3.2" />
  </Base>
);

export const IconHistorico = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Base>
);

export const IconUsuarios = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 5.9M17.2 14.9c2 .6 3.3 2.3 3.3 4.6" />
  </Base>
);

export const IconConfiguracoes = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1A1.6 1.6 0 0 0 4 14a1.9 1.9 0 0 1-1.9-1.9v-.2A1.9 1.9 0 0 1 4 10a1.6 1.6 0 0 0 1-2.7l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1A1.6 1.6 0 0 0 10 4.6a1.9 1.9 0 0 1 1.9-1.9h.2A1.9 1.9 0 0 1 14 4.6a1.6 1.6 0 0 0 2.7 1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.2.2z" />
  </Base>
);

export const IconSol = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
  </Base>
);

export const IconLua = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconChave = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="12" r="3.5" />
    <path d="M11.5 12H20M17 12v3M20 12v2.5" />
  </Base>
);

export const IconChevron = (p: IconProps) => (
  <Base {...p}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);

export const IconMenu = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);

export const IconClose = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconChevronUpDown = (p: IconProps) => (
  <Base {...p}>
    <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />
  </Base>
);

/** Duas setas em círculo — "atualizar". */
export const IconAtualizar = (p: IconProps) => (
  <Base {...p}>
    <path d="M19.5 12a7.5 7.5 0 0 1-13.1 5" />
    <path d="M4.5 12a7.5 7.5 0 0 1 13.1-5" />
    <path d="M17.8 3.5v3.7h-3.7M6.2 20.5v-3.7h3.7" />
  </Base>
);

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Base>
);

/** Duas barras (banco x Omie) com um visto — a tela "Validação de saldo". */
export const IconValidacaoSaldo = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 8h9M4 12h6" />
    <path d="M15.5 15.5 18 18l4-4.5" />
  </Base>
);

export const IconEmpresa = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 20.5h17M5 20.5V5.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M14 10h4a1 1 0 0 1 1 1v9.5" />
    <path d="M7.5 8h3M7.5 11.5h3M7.5 15h3M16.5 13.5h0M16.5 17h0" />
  </Base>
);

/** Porta com seta saindo — encerrar a sessão. */
export const IconSair = (p: IconProps) => (
  <Base {...p}>
    <path d="M14.5 4.5h-7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7" />
    <path d="M18.5 12h-8" />
    <path d="m15.5 9 3 3-3 3" />
  </Base>
);

/** Lápis — editar o registro da linha. */
export const IconEditar = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="m14.5 6.5 3 3" />
  </Base>
);

/** Seta para baixo sobre uma linha — exportar/baixar arquivo. */
export const IconDownload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
    <path d="M5 19h14" />
  </Base>
);

/** Seta pra cima saindo de uma bandeja — enviar um arquivo do computador. */
export const IconUpload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 15V4m0 0 4 4m-4-4-4 4" />
    <path d="M5 19h14" />
  </Base>
);

/** Seta na diagonal — abrir em outra tela ou num detalhe maior. */
export const IconExterno = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17 17 7M9 7h8v8" />
  </Base>
);

/** Lixeira — excluir o registro da linha. */
export const IconLixeira = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7h16" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
    <path d="M10.5 11v5.5M13.5 11v5.5" />
  </Base>
);
