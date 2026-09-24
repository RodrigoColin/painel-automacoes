# Painel de Automações — Proos

## Deploy

O painel roda numa VPS própria, com Postgres, executor Python e cron em Docker — sem Supabase nem Vercel. Arquitetura, operação, backup e o passo a passo da virada estão em [`deploy/LEIA-ME.md`](deploy/LEIA-ME.md).

Para rodar localmente, o app precisa de um Postgres com o papel `painel_app` criado (o que `deploy/postgres/init.sh` faz no container), as migrações de `db/migrations` aplicadas (`MIGRACAO_DATABASE_URL=... npm run db:migrar`) e `DATABASE_URL` no `.env.local`.
