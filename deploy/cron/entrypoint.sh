#!/bin/sh
# O crond do busybox não repassa o ambiente do container para os jobs. Grava
# as variáveis de que eles precisam num arquivo só legível pelo root, que
# cada job carrega com `. /run/cron-env`.

set -eu

umask 077
{
  printf 'CRON_SECRET=%s\n' "$CRON_SECRET"
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'PAINEL_URL_INTERNA=%s\n' "${PAINEL_URL_INTERNA:-http://app:3000}"
  printf 'CRON_ATIVO=%s\n' "${CRON_ATIVO:-false}"
  printf 'export CRON_SECRET POSTGRES_PASSWORD PAINEL_URL_INTERNA CRON_ATIVO\n'
} > /run/cron-env

# -f: primeiro plano (o container vive enquanto o crond vive); -l 8: só
# avisos e erros do próprio crond — a saída dos jobs sai no stdout mesmo.
exec crond -f -l 8
