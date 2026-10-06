#!/bin/sh
# Sobe uma versão nova do painel. Roda na VPS, chamado pelo GitHub Actions
# depois de copiar para /opt/painel os arquivos de deploy (docker-compose.yml,
# atualizar.sh, postgres/init.sh). As imagens NÃO vêm por arquivo: são baixadas
# do GHCR com `docker compose pull` (o Actions já fez `docker login` antes).
#
#   ./atualizar.sh <versao> [registry]
#
# Voltar para uma versão anterior (as 3 últimas ficam em cache local):
#   sed -i 's/^PAINEL_VERSAO=.*/PAINEL_VERSAO=<versao>/' .env && docker compose pull && docker compose up -d
# (a imagem também fica no GHCR; se já estiver em cache local, o pull é instantâneo.)

set -eu
cd "$(dirname "$0")"

versao="$1"
reg="${2:-ghcr.io/rodrigocolin}"

sed -i "s/^PAINEL_VERSAO=.*/PAINEL_VERSAO=${versao}/" .env
mkdir -p backups

# Baixa as imagens da versão nova do GHCR (só o diff de camadas entre versões
# trafega). Precisa do PAINEL_VERSAO já setado acima, que o compose interpola.
docker compose pull

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
  docker image ls "${reg}/${imagem}" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
    | sort -r | tail -n +4 | cut -f2 \
    | xargs -r docker image rm >/dev/null 2>&1 || true
done

echo "Painel na versão ${versao}."
