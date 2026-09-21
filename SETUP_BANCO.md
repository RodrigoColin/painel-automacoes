# Gravação em banco de dados (--banco) — guia de configuração

## O que foi construído

Uma camada nova, **aditiva**, que grava os mesmos dados que hoje só existem
no `Oystr_Diagnostico_Consolidado.xlsx` também num banco PostgreSQL — sem
mudar em nada a lógica de negócio já validada (qual data usar, como
cruzar título com contrato, como qualificar churn por status de contrato,
etc.). Os dois scripts continuam funcionando exatamente como hoje quando
`--banco` não é passado.

Arquivos novos:

- `db/schema.sql` — as tabelas e views do Postgres.
- `omie_mcp/db.py` — funções que gravam os dicts que `montar_relatorio()`
  (diagnóstico) e `main()` de `analise_faturamento_mrr.py` (MRR) já
  produzem em memória. Não recalcula nada, só grava.
- Uma flag `--banco` nova em `scripts/refresh_oystr_diagnostico.py` e em
  `scripts/analise_faturamento_mrr.py`.

Desenho importante: cada execução vira uma **rodada** nova
(`rodadas_extracao`), carimbando as linhas gravadas com o mesmo
`rodada_id` — nenhuma rodada anterior é sobrescrita ou apagada (mesmo
princípio que você já escolheu pro nome de arquivo do Excel, com
timestamp em vez de sobrescrita). "Os dados de agora" é sempre a rodada
**concluída** mais recente por empresa — as views `v_*` no schema já
filtram isso pra você.

## O que já foi testado, e o que ainda não

**Testado nesta sessão, contra um Postgres real:** o schema aplica sem
erro e é seguro rodar mais de uma vez; as funções de gravação usam as
MESMAS funções reais do projeto (`linha_receber_aberto`,
`linha_liquidado`, `linha_contrato_nao_faturado_via_extrato`, etc.) pra
montar os dados de teste, não dicionários inventados à mão; e as
`main()` **reais e inalteradas** dos dois scripts rodam de ponta a ponta
com `--banco` (só a chamada de rede ao Omie foi substituída por dado
sintético — todo o resto, incluindo o parsing de argumentos e o bloco de
gravação em si, é o código de produção).

**Ainda não testado:** uma rodada de verdade contra a API real do Omie —
este ambiente (assim como o container de nuvem da Claude, ver
`claude/proos-omie-mcp.md`) não alcança `app.omie.com.br`. Isso só pode
ser confirmado rodando no seu computador. Recomendo o primeiro teste real
ser `--modo relatorio --banco` (no script de diagnóstico) — não escreve
no Excel, só busca os dados e grava no banco, mais rápido de conferir.

## 1. Ter um Postgres pra apontar

Você ainda não decidiu onde vai hospedar isso de forma definitiva (VPS
própria da Proos, etc.) — mas pra já poder testar HOJE, sem esperar essa
decisão, duas opções rápidas:

**Opção A — gratuita, sem instalar nada (recomendada pra já testar)**:
crie uma conta em [neon.tech](https://neon.tech) ou
[supabase.com](https://supabase.com) (os dois têm tier gratuito de
Postgres) e crie um banco nesse serviço, sempre 24h ligado. Isso já é
uma VPS "de fato" no sentido de que roda fora da sua máquina — dá pra
inclusive testar mais tarde se o `n8n`/uma automação rodando em outro
lugar consegue gravar nela. Copie a "connection string" que o serviço
mostra (formato `postgresql://usuario:senha@host:5432/banco`).

**Opção B — local, no seu Windows, via Docker Desktop** (se já tiver
instalado):

```powershell
docker run -d --name proos-postgres -e POSTGRES_PASSWORD=escolha-uma-senha `
    -e POSTGRES_DB=proos_omie -p 5432:5432 postgres:16
```

Connection string: `postgresql://postgres:escolha-uma-senha@localhost:5432/proos_omie`

## 2. Instalar a dependência nova

Com o `.venv` do projeto ativado (mesmo de sempre):

```powershell
pip install "psycopg[binary]"
```

## 3. Configurar `DATABASE_URL`

Adicione ao seu `.env` (mesmo arquivo onde já estão `OMIE_APP_KEY`/
`OMIE_APP_SECRET` — `.env.example` já foi atualizado com o exemplo):

```
DATABASE_URL=postgresql://usuario:senha@host:5432/proos_omie
```

## 4. Rodar

O schema é aplicado sozinho na primeira vez que `--banco` é usado (não
precisa rodar `schema.sql` na mão, mas pode se quiser inspecionar antes
com `psql -f db\schema.sql`). Primeiro teste recomendado, seguro (não
escreve em nada além do banco):

```powershell
python scripts\refresh_oystr_diagnostico.py --cliente oystr `
    --arquivo Oystr_Diagnostico_Consolidado.xlsx `
    --desde 01/08/2026 --ate 04/09/2026 `
    --modo relatorio --banco
```

Se aparecer `[banco] rodada N gravada: ...` no fim, funcionou. Depois,
uso normal (Excel + banco juntos, dos dois scripts):

```powershell
python scripts\refresh_oystr_diagnostico.py --cliente oystr `
    --arquivo Oystr_Diagnostico_Consolidado.xlsx `
    --desde 01/08/2026 --ate 04/09/2026 --modo escrever --banco

python scripts\analise_faturamento_mrr.py --cliente oystr `
    --modo gerar --arquivo Oystr_Diagnostico_Consolidado_<timestamp-da-rodada-acima>.xlsx `
    --banco
```

Se algo der errado na gravação em banco (Postgres fora do ar, credencial
errada, etc.), o script **avisa e continua** — a saída em Excel nunca
depende do banco funcionar.

## 5. Consultar os dados depois

Exemplos com `psql` (ou qualquer cliente Postgres — DBeaver, Supabase
Studio, etc.):

```sql
-- MRR por período/categoria, só a rodada mais recente (inclui o quadro
-- "MRR (RPA + Presto Recorrente)")
SELECT * FROM v_mrr_por_periodo_categoria WHERE empresa = 'oystr' ORDER BY periodo_data, categoria;

-- Status de contrato por cliente, rodada mais recente
SELECT * FROM v_contratos_status_atual WHERE empresa = 'oystr';

-- Histórico de rodadas (auditoria — inclui as que falharam)
SELECT id, tipo, status, iniciado_em, concluido_em, erro FROM rodadas_extracao
WHERE empresa = 'oystr' ORDER BY id DESC LIMIT 20;
```

## O que falta (próximos passos, não construídos ainda)

- **Novos Clientes / Churn** (diferença de conjunto de clientes entre
  períodos consecutivos) não está numa view SQL — continua sendo
  calculado em Python (`calcular_kpis`/`validacao_churn`), a partir do
  que já está no banco. Dá pra levar pra SQL depois se fizer sentido,
  mas achei mais seguro deixar essa lógica só num lugar por enquanto.
- **Onde rodar isso sozinho, sem você disparar manualmente**: continua
  precisando rodar no seu computador (ou numa VPS que ainda não existe —
  ver a conversa sobre n8n/VPS). O banco por si só não resolve isso;
  ele é o passo que faz a automação futura (n8n, agendador do Windows,
  ou o que for) ter algo confiável pra escrever, em vez de reprocessar
  Excel toda vez.
- **O dashboard (artefato Oystr) ainda lê do Excel**, não do banco —
  trocar isso é outra etapa, natural depois que o banco estiver
  confiável e povoado de verdade.
