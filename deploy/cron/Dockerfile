# Disparos agendados do painel — o que antes era pg_cron + pg_net no
# Supabase — e o backup diário do banco e dos arquivos.
#
# Base `postgres:17-alpine` pelo `pg_dump` da mesma versão do servidor; o
# crond vem do busybox.

FROM postgres:17-alpine

RUN apk add --no-cache curl tzdata

COPY crontab /etc/crontabs/root
COPY disparar.sh backup.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/disparar.sh /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
