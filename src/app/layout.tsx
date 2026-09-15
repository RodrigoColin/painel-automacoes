import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Painel de Automações",
  description: "Painel para gerenciamento de automações",
};

/**
 * Aplica o tema salvo antes da primeira pintura — sem isto, a página
 * renderizaria sempre no tema claro por uma fração de segundo e "piscaria"
 * para o escuro assim que o React hidratasse. Roda como script inline
 * síncrono no `<head>` de propósito, antes de qualquer CSS ou JS do bundle.
 */
const SCRIPT_TEMA = `
try {
  var t = localStorage.getItem("painel:tema");
  if (t === "dark" || t === "light") {
    document.documentElement.setAttribute("data-theme", t);
  }
} catch (e) {}
`;

/**
 * Layout raiz: só o documento e as fontes.
 *
 * A casca do painel (sidebar) vive em `(painel)/layout.tsx`, porque as telas
 * de autenticação em `(auth)` não devem herdá-la — quem não fez login não tem
 * o que navegar.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script id="script-tema" strategy="beforeInteractive">
          {SCRIPT_TEMA}
        </Script>
      </head>
      <body className="min-h-full bg-bg font-sans">{children}</body>
    </html>
  );
}
