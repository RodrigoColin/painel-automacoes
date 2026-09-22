#!/bin/sh
# Backup diário: dump do banco (formato custom, restaurável com pg_restore) e
# um tar dos arquivos enviados (logos e scripts). Guarda os últimos 14 dias
# em /backups, que é um volume na VPS.
#
# Isto protege contra erro humano e migração que deu errado, não contra a
# VPS sumir: para isso, copie /backups para fora da máquina (ver
# deploy/LEIA-ME.md).

set -eu
. /run/cron-env

destino=/backups
carimbo=$(date '+%Y%m%d-%H%M')
mkdir -p "$destino"

PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host=postgres --username=postgres --dbname=painel \
  --format=custom --file="$destino/painel-$carimbo.dump"

tar -czf "$destino/arquivos-$carimbo.tar.gz" -C /data arquivos

find "$destino" -name 'painel-*.dump' -mtime +14 -delete
find "$destino" -name 'arquivos-*.tar.gz' -mtime +14 -delete

echo "$(date '+%F %T') backup ok: painel-$carimbo.dump, arquivos-$carimbo.tar.gz"
