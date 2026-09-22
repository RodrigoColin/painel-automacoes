#!/bin/sh
# Roda uma vez só, na primeira subida do container (volume de dados vazio),
# pelo docker-entrypoint do Postgres.
#
# Cria o banco do painel e o papel com que o app se conecta. Fica aqui, e não
# numa migração, porque a senha vem do ambiente e não pode ser versionada.
# Os privilégios do papel (BYPASSRLS, membro de `authenticated`) são dados
# pela migração 0001.

set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
create database painel;
create role painel_app login password '${PAINEL_APP_PASSWORD}';
grant connect on database painel to painel_app;
SQL
