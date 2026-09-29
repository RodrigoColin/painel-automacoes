# Painel na VPS

O painel roda em `45.179.90.19`, em `/opt/painel`, ao lado do n8n (`/opt/n8n`),
sem Supabase nem Vercel.

```
nginx do host (TLS, certbot)  ──►  app (Next, 127.0.0.1:3000)
                                     │
                    rede interna ────┼──► postgres (Postgres 17, RLS)
                    do Docker        ├──► executor (Python, só pela rede interna)
                                     ├──◄ cron (agendador, n8n, Omie, backup)
                    postgres ◄───────┴─── caixa (pipeline do fluxo de caixa)
```

| O que era | O que é |
|---|---|
| Supabase Postgres | container `postgres`, schema em `db/migrations` |
| Supabase Auth | `src/lib/auth/sessao.ts`: bcrypt + sessão em cookie (`auth.usuarios`, `auth.sessoes`) |
| Supabase Storage | volume `arquivos`, via `src/lib/armazenamento.ts`; logos em `/arquivos-publicos/logos/...` |
| pg_cron + pg_net + Vault | container `cron` (`deploy/cron/crontab`), segredos no `.env` |
| Vercel Function Python | container `executor` (`executor/servidor.py`) |
| Deploy da Vercel | `.github/workflows/deploy.yml` → `deploy/atualizar.sh` |

Não existe cadastro nem redefinição de senha por e-mail: contas e senhas são
criadas e trocadas por um admin na tela **Usuários**.

## Operação do dia a dia

Tudo em `/opt/painel` na VPS:

```sh
docker compose ps                      # estado dos containers
docker compose logs -f app             # log do Next
docker compose logs -f cron            # cada disparo do agendador/n8n/Omie e o backup
docker compose exec postgres psql -U postgres painel
```

**Deploy:** push na `main` (ou "Run workflow" em Actions). O workflow compila
as imagens, copia para a VPS, aplica as migrações pendentes e só dá sucesso se
os healthchecks passarem.

**Voltar uma versão** (as 3 últimas ficam guardadas):

```sh
docker image ls painel-app             # versões disponíveis
sed -i 's/^PAINEL_VERSAO=.*/PAINEL_VERSAO=<versao>/' .env && docker compose up -d
```

Migração não volta sozinha: se a versão nova mudou o schema, a antiga precisa
ser compatível com ele (escreva migrações que só acrescentam).

**Migração nova:** crie `db/migrations/NNNN_descricao.sql` e atualize
`src/lib/db/schema.ts`. Ela roda no próximo deploy.

**Cache do Omie:** o que as telas leem do Omie ao abrir (resumo financeiro,
contas correntes) fica na tabela `cache_externo` por 24 h. A rota
`/api/sincronizar-omie` (10h e 16h) sincroniza o faturamento e renova esse
cache; se o Omie falhar, a tela segue com o último valor bom. As chaves do
Infisical ficam só em memória no app (24 h), nunca no banco.

**Rodar uma sincronização na mão** (também renova o cache):

```sh
docker compose exec cron disparar.sh '/api/sincronizar-omie?completa=1' 1800
```

## Fluxo de caixa (container `caixa`)

A tela **Fluxo de caixa** não consulta o Omie ao abrir: lê o pacote do dia em
`caixa_pacote_diario`, gravado pelo container `caixa`
(`proos-omie-mcp/caixa/`). A fila é a tabela `caixa_execucao`:

- às 10h e às 16h o `cron` chama `/api/fluxo-caixa/agendar`, que põe na fila
  uma rodada por empresa com pasta no Infisical;
- o botão **Atualizar agora** da tela põe na fila só a empresa em uso;
- o `caixa` processa uma rodada por vez (extrato → títulos → agregados →
  banco). A primeira de cada empresa pode levar mais de meia hora; as
  seguintes reaproveitam o cache de títulos no volume `caixa-cache`.

```sh
docker compose logs -f caixa                                  # rodada em andamento
docker compose exec cron disparar.sh '/api/fluxo-caixa/agendar' 60   # enfileirar todas agora
docker compose exec postgres psql -U postgres painel \
  -c "select id, empresa_id, status, etapa, criada_em, erro from caixa_execucao order by id desc limit 10"
# Rodar uma empresa na mão, gravando também os JSON para conferir:
docker compose run --rm caixa python -m caixa.rodada --empresa-id <uuid> --saida /tmp/caixa --nao-gravar
```

Regras por empresa (contas fora do caixa, limites, grupos de categoria,
linhas de receita, histórico fixo) ficam em `fluxo_caixa_config` e são
editadas no bloco "Configuração da Proos" da própria tela.

## Backup

Todo dia às 03:30 o container `cron` grava em `/opt/painel/backups` um dump
do banco e um tar dos arquivos, e guarda 14 dias.

**Isso não protege contra perder a VPS.** Copie a pasta para fora dela, por
exemplo do seu computador:

```sh
scp -r root@45.179.90.19:/opt/painel/backups ./backups-painel
```

Restaurar:

```sh
docker compose stop app cron
docker compose exec -T postgres pg_restore -U postgres -d painel --clean --if-exists < backups/painel-AAAAMMDD-HHMM.dump
docker compose run --rm --no-deps -v "$PWD/backups:/b" app sh -c 'cd /data && tar -xzf /b/arquivos-AAAAMMDD-HHMM.tar.gz'
docker compose up -d
```

## Preparação da VPS (uma vez)

1. **Usuário de deploy**, usado só pelo GitHub Actions:

   ```sh
   adduser --disabled-password --gecos "" deploy
   usermod -aG docker deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   # cole a chave pública do Actions em /home/deploy/.ssh/authorized_keys
   install -d -o deploy -g deploy /opt/painel /opt/painel/postgres /opt/painel/backups
   ```

   Estar no grupo `docker` equivale a root na máquina — a vantagem sobre usar
   o root direto é a chave ser própria, e revogável sem mexer no acesso de
   ninguém.

2. **Segredos:** copie `deploy/env.exemplo` para `/opt/painel/.env`, preencha
   (`openssl rand -hex 32` para cada senha) e `chmod 600`.

3. **Segredos do GitHub** (Settings → Secrets → Actions): `VPS_HOST`,
   `VPS_USER=deploy`, `VPS_SSH_KEY` (chave privada) e `VPS_KNOWN_HOSTS`
   (`ssh-keyscan 45.179.90.19`).

4. **Primeiro deploy:** rode o workflow. Ele cria o banco, aplica as migrações
   e sobe tudo.

5. **nginx + TLS:** `deploy/nginx/painel.conf`, com as instruções no topo do
   arquivo. O DNS do domínio precisa apontar para a VPS antes do `certbot`.
   Na Cloudflare, deixe o registro como "DNS only" (nuvem cinza) até o
   certificado sair.

## Virada (Supabase + Vercel → VPS)

Feita em 22/09/2026: os dados foram copiados do Supabase com um importador de
uso único (removido do repositório depois; está no histórico do git, em
`db/importar-supabase.mjs`). Contas que nunca definiram senha no Supabase
ficam sem acesso até um admin definir uma na tela Usuários.
