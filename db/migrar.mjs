/**
 * Aplica as migrações de `db/migrations` que ainda não rodaram.
 *
 * Roda com o superusuário do Postgres (MIGRACAO_DATABASE_URL), não com o
 * papel do app: as migrações criam papéis e mexem em atributos como
 * BYPASSRLS, que o `painel_app` de propósito não pode tocar.
 *
 * Cada arquivo roda numa transação própria e só é registrado se terminar
 * inteiro — uma migração que falha no meio não deixa o banco pela metade.
 *
 *   MIGRACAO_DATABASE_URL=postgres://postgres:...@localhost:5432/painel node db/migrar.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.MIGRACAO_DATABASE_URL;
if (!url) {
  console.error("MIGRACAO_DATABASE_URL não definida.");
  process.exit(1);
}

const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`create schema if not exists migracoes`;
  await sql`
    create table if not exists migracoes.aplicadas (
      nome       text primary key,
      aplicada_em timestamptz not null default now()
    )
  `;

  const aplicadas = new Set((await sql`select nome from migracoes.aplicadas`).map((l) => l.nome));
  const arquivos = (await readdir(pasta)).filter((nome) => nome.endsWith(".sql")).sort();
  const pendentes = arquivos.filter((nome) => !aplicadas.has(nome));

  if (pendentes.length === 0) {
    console.log("Nenhuma migração pendente.");
  }

  for (const nome of pendentes) {
    const conteudo = await readFile(path.join(pasta, nome), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(conteudo);
      await tx`insert into migracoes.aplicadas (nome) values (${nome})`;
    });
    console.log(`Aplicada: ${nome}`);
  }
} catch (erro) {
  console.error("Migração falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
