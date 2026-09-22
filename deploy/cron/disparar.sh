#!/bin/sh
# Chama uma rota de cron do painel com o Bearer do CRON_SECRET.
#
#   disparar.sh <caminho> <tempo-maximo-em-segundos>
#
# O resultado vai para o log do container (`docker compose logs cron`), que é
# onde se investiga um disparo — o equivalente ao `cron.job_run_details`.

set -eu
. /run/cron-env

caminho="$1"
limite="${2:-300}"

resposta=$(curl --silent --show-error --max-time "$limite" \
  --write-out ' [HTTP %{http_code}]' \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  "${PAINEL_URL_INTERNA}${caminho}" 2>&1) || true

# Uma linha por disparo, cortada: a resposta do agendador lista cada
# automação e encheria o log.
echo "$(date '+%F %T') ${caminho} $(printf '%s' "$resposta" | tr -d '\n' | cut -c1-400)"
