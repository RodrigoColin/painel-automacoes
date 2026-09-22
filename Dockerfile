# Imagem do painel (Next.js standalone).
#
# Construída no GitHub Actions, não na VPS: o `next build` passa de 1 GB de
# RAM, e a VPS divide 2 GB com o n8n.

FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS execucao
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ARMAZENAMENTO_DIR=/data/arquivos \
    TZ=America/Sao_Paulo

RUN apk add --no-cache tzdata \
 && addgroup -S -g 1001 painel \
 && adduser -S -u 1001 -G painel painel \
 && mkdir -p /data/arquivos \
 && chown painel:painel /data/arquivos

COPY --from=build --chown=painel:painel /app/.next/standalone ./
COPY --from=build --chown=painel:painel /app/.next/static ./.next/static
COPY --from=build --chown=painel:painel /app/public ./public
# Migrações e o importador rodam de dentro desta imagem (`docker compose run
# app node db/...`). O build embute o driver `postgres` nos chunks do app, sem
# deixar o pacote em node_modules; os scripts precisam dele solto. Ele não
# tem dependências, então a pasta basta.
COPY --from=build --chown=painel:painel /app/db ./db
COPY --from=dependencias --chown=painel:painel /app/node_modules/postgres ./node_modules/postgres

USER painel
EXPOSE 3000
CMD ["node", "server.js"]
