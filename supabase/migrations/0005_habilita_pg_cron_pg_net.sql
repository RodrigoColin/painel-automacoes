-- O plano Hobby da Vercel só permite cron diário, o que não serve para
-- automações de 15 em 15 minutos. O agendador passa a ser acionado pelo
-- próprio Postgres, que já hospeda a agenda.

create extension if not exists pg_cron;
create extension if not exists pg_net;
