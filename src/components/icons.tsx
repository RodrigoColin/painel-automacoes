type IconProps = React.SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
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

/** Script / código — usado para o tipo “cron job com Python”. */
export const IconCodigo = (p: IconProps) => (
  <Base {...p}>
    <path d="m8.5 8.5-4 3.5 4 3.5M15.5 8.5l4 3.5-4 3.5M13.5 5.5l-3 13" />
  </Base>
);

/** Nós conectados — usado para o tipo “workflow no n8n”. */
export const IconFluxo = (p: IconProps) => (
  <Base {...p}>
    <circle cx="5.5" cy="12" r="2.2" />
    <circle cx="18.5" cy="6.5" r="2.2" />
    <circle cx="18.5" cy="17.5" r="2.2" />
    <path d="M7.6 11.1 16.4 7.4M7.6 12.9l8.8 3.7" />
  </Base>
);

export const IconAlerta = (p: IconProps) => (
  <Base {...p}>
    <path d="M10.7 4.1 2.9 17.4a1.5 1.5 0 0 0 1.3 2.3h15.6a1.5 1.5 0 0 0 1.3-2.3L13.3 4.1a1.5 1.5 0 0 0-2.6 0Z" />
    <path d="M12 9.5v4M12 17h0" />
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

export const IconSearch = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.3-4.3" />
  </Base>
);

export const IconPlus = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
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

export const IconCheck = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Base>
);

export const IconEmpresa = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.5 20.5h17M5 20.5V5.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M14 10h4a1 1 0 0 1 1 1v9.5" />
    <path d="M7.5 8h3M7.5 11.5h3M7.5 15h3M16.5 13.5h0M16.5 17h0" />
  </Base>
);

export const IconDots = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Base>
);
