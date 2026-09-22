/**
 * Login e sessão, no lugar do Supabase Auth.
 *
 * Sessão opaca em cookie: o navegador guarda um token aleatório; o banco
 * guarda só o SHA-256 dele (`auth.sessoes`). Validar é uma consulta por
 * requisição — barato, e sair (ou apagar a conta) derruba a sessão na hora,
 * o que um JWT autocontido não faria.
 *
 * Senhas em bcrypt, o mesmo algoritmo do Supabase Auth: os hashes migrados de
 * lá continuam valendo. Não há cadastro nem redefinição por e-mail — contas e
 * senhas são criadas e trocadas por um admin, na tela de usuários.
 */

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { COOKIE_SESSAO } from "@/lib/auth/constantes";
import { db } from "@/lib/db";
import { perfis, sessoes, usuarios } from "@/lib/db/schema";

const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function gerarHashSenha(senha: string) {
  return bcrypt.hash(senha, 10);
}

/**
 * Hash de uma senha que não existe, comparado quando o e-mail não tem conta:
 * sem isso, a resposta rápida para "e-mail inexistente" denunciaria quem tem
 * conta no painel só pelo tempo de resposta.
 */
const HASH_FICTICIO = "$2b$10$yZ/386DXexoRNs1rvENK8OkfJf6hNcQEO8HcX45WZSz9eAoiJQjFu";

/** Confere e-mail e senha. Devolve o id da conta, ou `null` sem dizer qual dos dois errou. */
export async function conferirCredenciais(email: string, senha: string): Promise<string | null> {
  const [conta] = await db
    .select({ id: usuarios.id, senhaHash: usuarios.senhaHash })
    .from(usuarios)
    .where(eq(sql`lower(${usuarios.email})`, email.trim().toLowerCase()))
    .limit(1);

  // Conta sem senha utilizável (importada do Supabase sem senha, por
  // exemplo) compara contra o fictício: nunca entra, e leva o mesmo tempo.
  const hashValido = conta?.senhaHash.startsWith("$2") ? conta.senhaHash : null;
  const confere = await bcrypt.compare(senha, hashValido ?? HASH_FICTICIO);
  return conta && hashValido && confere ? conta.id : null;
}

/** Abre a sessão e grava o cookie. Só em Server Action ou Route Handler. */
export async function iniciarSessao(usuarioId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_MS);

  await db.insert(sessoes).values({
    tokenHash: hashToken(token),
    usuarioId,
    expiraEm: expiraEm.toISOString(),
  });

  // Faxina oportunista: sem job próprio para isso, cada login leva junto as
  // sessões vencidas de todo mundo.
  await db.delete(sessoes).where(lt(sessoes.expiraEm, new Date().toISOString()));
  await db
    .update(perfis)
    .set({ ultimo_acesso: new Date().toISOString() })
    .where(eq(perfis.id, usuarioId));

  const armazenamento = await cookies();
  armazenamento.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });
}

/** Pessoa dona do cookie, se a sessão existir e não tiver vencido. */
export async function lerSessao(): Promise<{ userId: string; email: string } | null> {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  const [linha] = await db
    .select({ userId: usuarios.id, email: usuarios.email })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(
      and(eq(sessoes.tokenHash, hashToken(token)), gt(sessoes.expiraEm, new Date().toISOString())),
    )
    .limit(1);

  return linha ?? null;
}

/** Apaga a sessão no banco e o cookie. */
export async function encerrarSessao() {
  const armazenamento = await cookies();
  const token = armazenamento.get(COOKIE_SESSAO)?.value;
  if (token) await db.delete(sessoes).where(eq(sessoes.tokenHash, hashToken(token)));
  armazenamento.delete(COOKIE_SESSAO);
}

/** Derruba todas as sessões da pessoa — depois de trocar a senha dela, por exemplo. */
export async function encerrarSessoesDe(usuarioId: string) {
  await db.delete(sessoes).where(eq(sessoes.usuarioId, usuarioId));
}
