import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
    >
      <body className="min-h-full bg-bg font-sans">{children}</body>
    </html>
  );
}
