This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

O painel roda numa VPS própria, com Postgres, executor Python e cron em Docker — sem Supabase nem Vercel. Arquitetura, operação, backup e o passo a passo da virada estão em [`deploy/LEIA-ME.md`](deploy/LEIA-ME.md).

Para rodar localmente, o app precisa de um Postgres com o papel `painel_app` criado (o que `deploy/postgres/init.sh` faz no container), as migrações de `db/migrations` aplicadas (`MIGRACAO_DATABASE_URL=... npm run db:migrar`) e `DATABASE_URL` no `.env.local`.
