#!/bin/sh
# Sobe uma versão nova do painel. Roda na VPS, chamado pelo GitHub Actions
# depois de copiar para /opt/painel as imagens (imagens.tar.gz) e os arquivos
# de deploy/.
#
#   ./atualizar.sh <versao>
#
# Voltar para uma versão anterior (as 3 últimas ficam guardadas):
#   sed -i 's/^PAINEL_VERSAO=.*/PAINEL_VERSAO=<versao>/' .env && docker compose up -d

set -eu
cd "$(dirname "$0")"

versao="$1"

if [ -f imagens.tar.gz ]; then
  gunzip -c imagens.tar.gz | docker load
  rm imagens.tar.gz
fi

sed -i "s/^PAINEL_VERSAO=.*/PAINEL_VERSAO=${versao}/" .env
mkdir -p backups

# Banco primeiro, e as migrações antes do app novo: código novo contra schema
# velho quebraria no meio do caminho. `--no-deps` porque só o Postgres
# importa para migrar.
docker compose up -d --wait postgres
docker compose run --rm --no-deps app node db/migrar.mjs

# `--wait` segura até os healthchecks passarem: se a versão nova não subir,
# o Actions falha em vez de reportar sucesso com o painel fora do ar.
docker compose up -d --wait --remove-orphans

# Guarda as 3 últimas versões de cada imagem, para rollback rápido.
for imagem in painel-app painel-executor painel-cron painel-caixa; do
  docker image ls "$imagem" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
    | sort -r | tail -n +4 | cut -f2 \
    | xargs -r docker image rm >/dev/null 2>&1 || true
done

echo "Painel na versão ${versao}."
