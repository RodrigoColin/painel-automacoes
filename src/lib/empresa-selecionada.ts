/**
 * Empresa selecionada no painel.
 *
 * Antes isto vivia no `localStorage`, o que não serve mais: o servidor precisa
 * saber qual empresa consultar antes de renderizar. Um cookie resolve — é
 * enviado junto da requisição.
 *
 * O valor NÃO é confiável por si só: qualquer pessoa pode editar o cookie. Quem
 * confere se a empresa pertence ao usuário é `empresaAtual` no DAL, e o RLS
 * recusa a linha no banco caso a checagem falhe.
 */

import { cookies } from "next/headers";

const COOKIE_EMPRESA = "painel-empresa";

export async function lerEmpresaSelecionada() {
  const armazenamento = await cookies();
  return armazenamento.get(COOKIE_EMPRESA)?.value;
}

export async function gravarEmpresaSelecionada(empresaId: string) {
  const armazenamento = await cookies();
  armazenamento.set(COOKIE_EMPRESA, empresaId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
