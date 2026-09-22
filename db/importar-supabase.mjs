/**
 * Copia os dados do Supabase para o Postgres da VPS. Uso único, na virada.
 *
 * - Tabelas de `public`, na ordem das chaves estrangeiras, numa transação só:
 *   ou entra tudo, ou nada.
 * - Contas de `auth.users` para `auth.usuarios`, com o hash bcrypt da senha:
 *   ninguém precisa trocar de senha. Os ids são os mesmos, então perfis,
 *   vínculos e autorias continuam apontando para as pessoas certas.
 * - Arquivos do Storage para o disco (ARMAZENAMENTO_DIR/<bucket>/<caminho>),
 *   e `empresas.logo_url` reescrito para a rota nova.
 *
 * Os dados atravessam como texto JSON (`json_agg` na origem,
 * `jsonb_populate_recordset` no destino): sem passar por tipos do JavaScript,
 * `bigint`, `numeric` e datas chegam exatamente como saíram.
 *
 * Roda de dentro do container do app, que já tem o driver e o volume:
 *
 *   docker compose run --rm \
 *     -e SUPABASE_DB_URL=... -e SUPABASE_URL=... -e SUPABASE_SECRET_KEY=... \
 *     app node db/importar-supabase.mjs [--simular] [--substituir]
 *
 * --simular    só conta o que seria copiado; não grava nada.
 * --substituir apaga o que já houver no destino antes de copiar. Sem ela, o
 *              script se recusa a rodar num banco que já tem contas.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const simular = process.argv.includes("--simular");
const substituir = process.argv.includes("--substituir");

const { SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, MIGRACAO_DATABASE_URL } = process.env;
const ARMAZENAMENTO_DIR = path.resolve(process.env.ARMAZENAMENTO_DIR ?? "./armazenamento");

for (const [nome, valor] of Object.entries({
  SUPABASE_DB_URL,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  MIGRACAO_DATABASE_URL,
})) {
  if (!valor) {
    console.error(`${nome} não definida.`);
    process.exit(1);
  }
}

/** Ordem das chaves estrangeiras: quem é referenciado vem antes. */
const TABELAS = [
  "empresas",
  "perfis",
  "membros",
  "automacoes",
  "automacao_segredos",
  "execucoes",
  "logs_execucao",
  "integracao_n8n_plataforma",
  "integracao_n8n_plataforma_segredo",
  "integracao_infisical_plataforma",
  "infisical_caminhos_clientes",
  "arquivos",
  "acessos_chaves",
  "acessos_chaves_segredo",
  "omie_clientes",
  "omie_categorias",
  "omie_sincronizacao",
  "omie_contratos",
  "omie_faturamento_mensal",
];

// `prepare: false`: o pooler do Supabase (Supavisor) não aceita prepared
// statements em todos os modos.
const origem = postgres(SUPABASE_DB_URL, { max: 1, prepare: false, onnotice: () => {} });
const destino = postgres(MIGRACAO_DATABASE_URL, { max: 1, onnotice: () => {} });

const contar = (json) => (JSON.parse(json).length);

try {
  /* ------------------------------- Leitura ------------------------------- */

  const [{ json: contas }] = await origem`
    select coalesce(json_agg(json_build_object(
      'id', id,
      'email', lower(email),
      -- Conta sem senha (convite nunca aceito) entra sem hash utilizável: não
      -- consegue entrar até um admin definir uma senha pela tela.
      'senha_hash', coalesce(encrypted_password, ''),
      'criado_em', created_at,
      'atualizado_em', coalesce(updated_at, created_at)
    )), '[]')::text as json
    from auth.users
    where email is not null
  `;

  const dados = {};
  for (const tabela of TABELAS) {
    const [{ json }] = await origem.unsafe(
      `select coalesce(json_agg(t), '[]')::text as json from public."${tabela}" t`,
    );
    dados[tabela] = json;
  }

  const objetos = await origem`
    select bucket_id, name, (metadata->>'size')::bigint as tamanho
    from storage.objects
    order by bucket_id, name
  `;

  console.log(`Contas: ${contar(contas)}`);
  for (const tabela of TABELAS) console.log(`${tabela}: ${contar(dados[tabela])}`);
  console.log(
    `Arquivos do Storage: ${objetos.length} (${objetos.reduce((s, o) => s + Number(o.tamanho ?? 0), 0)} bytes)`,
  );

  if (simular) {
    console.log("\n--simular: nada foi gravado.");
  } else {
    /* ------------------------------- Banco ------------------------------- */

    const [{ total }] = await destino`select count(*)::int as total from auth.usuarios`;
    if (total > 0 && !substituir) {
      throw new Error(
        `O destino já tem ${total} conta(s). Rode com --substituir para apagar e copiar de novo.`,
      );
    }

    await destino.begin(async (tx) => {
      if (substituir) {
        await tx.unsafe(
          `truncate ${TABELAS.map((t) => `public."${t}"`).join(", ")}, auth.sessoes, auth.usuarios cascade`,
        );
      }

      await tx`
        insert into auth.usuarios
        select * from jsonb_populate_recordset(null::auth.usuarios, ${contas}::text::jsonb)
      `;

      for (const tabela of TABELAS) {
        await tx.unsafe(
          `insert into public."${tabela}"
           select * from jsonb_populate_recordset(null::public."${tabela}", $1::text::jsonb)`,
          [dados[tabela]],
        );
      }

      // O bigserial não sabe dos ids que entraram prontos.
      await tx`
        select setval(
          pg_get_serial_sequence('public.logs_execucao', 'id'),
          coalesce((select max(id) from public.logs_execucao), 0) + 1,
          false
        )
      `;

      // URL pública do Storage → rota do painel que serve a logo do disco.
      await tx`
        update public.empresas
           set logo_url = '/arquivos-publicos/logos/'
                          || substring(logo_url from '/storage/v1/object/public/logos-empresa/(.*)$')
         where logo_url like '%/storage/v1/object/public/logos-empresa/%'
      `;
    });

    console.log("\nBanco copiado.");

    /* ------------------------------ Arquivos ----------------------------- */

    const falhas = [];
    for (const objeto of objetos) {
      const caminho = objeto.name.split("/").map(encodeURIComponent).join("/");
      const resposta = await fetch(`${SUPABASE_URL}/storage/v1/object/${objeto.bucket_id}/${caminho}`, {
        headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` },
      });

      if (!resposta.ok) {
        falhas.push(`${objeto.bucket_id}/${objeto.name}: HTTP ${resposta.status}`);
        continue;
      }

      const alvo = path.join(ARMAZENAMENTO_DIR, objeto.bucket_id, ...objeto.name.split("/"));
      if (!alvo.startsWith(path.join(ARMAZENAMENTO_DIR, objeto.bucket_id) + path.sep)) {
        falhas.push(`${objeto.bucket_id}/${objeto.name}: caminho inválido`);
        continue;
      }
      await mkdir(path.dirname(alvo), { recursive: true });
      await writeFile(alvo, Buffer.from(await resposta.arrayBuffer()));
    }

    console.log(`Arquivos copiados: ${objetos.length - falhas.length} de ${objetos.length}.`);
    if (falhas.length > 0) {
      console.log("Falharam:\n  " + falhas.join("\n  "));
      process.exitCode = 1;
    }
  }
} catch (erro) {
  console.error("Importação falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await origem.end();
  await destino.end();
}
