# Painel "Fluxo de caixa · Oystr" — handoff para levar a rotina para a VPS

Atualizado em 25/09/2026. Objetivo: tirar a dependência do computador do Rodrigo (código, credenciais, arquivos e execução) e deixar a atualização diária automática na VPS, orquestrada pelo n8n.

## Auditoria do histórico jan–ago/26 (28/09/2026) — resultado: sem problema

Corrigido nesta data: o mês corrente ("em curso") agora bate byte a byte com a aba Diário —
`build_extra_dashboard_caixa.py` lê `MOVS_HOJE_RECEBER`/`MOVS_HOJE_PAGAR` direto do `extrato.json`
(mesma fonte da aba Diário) em vez de recalcular "aberto até hoje" a partir de
`receber_aberto.json`/`pagar_aberto.json` — essas duas fontes divergiam em alguns títulos por
critério interno do Omie que não aparece nos campos Vencimento/Previsão.

Isso revelou uma diferença de ~R$17 mil no acumulado que parecia vir do histórico jan–ago.
Auditei rodando `extrair_fluxo_caixa_portal.py --historico_desde 2026-01-01` (real, direto do
extrato bancário, não por título) e comparando mês a mês contra o `hist` do Python:

| Mês | Diferença (hist − extrato real) |
|---|---|
| jan–mai/26 | entre -R$1.247 e +R$780 (tarifas/arredondamento) |
| jun–ago/26 | R$0,00 |
| **Total 8 meses** | **-R$632,30** |

Ou seja: **jan–ago/26 está correto** (diferença de R$632 em ~9,3 milhões movimentados, 0,007% —
ruído normal, não um bug). O "ago/26 R$1,18 mi vs ≈R$400 mil" registrado em 24/09 (nota abaixo,
`--usar-historico-extrato`) parece ter sido outro problema, ou uma comparação com dado diferente —
não reproduzi nada parecido nesta auditoria.

O que causou o susto inicial: comparei o fechamento de agosto (mês inteiro) contra o de setembro
**parcial** (`historicoMensal` só cobre até `hoje - 7 dias`, i.e., até 20/09) — nesses 20 dias a
folha de pagamento (que sai no início do mês) ainda não tinha sido compensada pelas receitas (que
entram mais perto do fim do mês, dia 28 principalmente). É o ritmo normal do caixa dentro do mês,
não uma divergência real. Confirmei que a folha (Salários/INSS/FGTS/Férias/Rescisões) está
corretamente baixada como título todo mês, inclusive setembro (R$618.133,48 em `pagamentos.json`).

## Os ~R$17 mil restantes — causa raiz e correção definitiva (28/09/2026)

Rastreado até o centavo: **saídas batiam 100%**; a diferença inteira estava do lado das entradas —
10 recebimentos que caíram de verdade na conta mas não estavam em `recebimentos.json`:
- 9 datados de hoje (28/09) — títulos que ainda serão baixados/conciliados amanhã, dentro do
  prazo normal (é exatamente o caso que motivou o ajuste de `MOVS_HOJE_*` acima).
- 1 de 10/09 (RODRIGUES E MARTINS SOCIEDADE DE ADVOGADOS, R$1.358,00) — já **baixado** no Omie,
  só não **conciliado** com o extrato bancário. `montar_recebimentos_pagamentos` cruza título
  baixado com o lançamento *conciliado* na conta corrente — sem a conciliação, o cruzamento falha
  e o título some do relatório mesmo já pago. Vale o financeiro da Oystr conferir esse título.

Correção aplicada: em vez de encadear o "Caixa acumulado" do mês corrente a partir do saldo do
mês fechado anterior (`hist.acum` recalculado por título, que carrega esse tipo de resíduo — R$632
de jan-ago + esse ~R$17 mil de setembro), `build_extra_dashboard_caixa.py` agora ancora o mês
corrente no **mesmo saldo real do banco que a aba Diário usa** (`D["caixaProprio"]` + previsto de
hoje + previsto futuro). "Saldo do mês" passa a ser a diferença necessária pra bater com a linha
de cima, em vez de calculado independente por `entradas − saídas`. Resultado: Visão Mensal, Por
Categoria e Diário sempre mostram o mesmo número pro mês corrente, por construção — não por
coincidência. Confirmado no navegador: `384.359,51` nas três abas.

Meses **fechados** (jan-ago) continuam com o cálculo por título normalmente — não têm esse
problema de "ainda não conciliado" porque já tiveram tempo de se resolver.

---

## 1. O que foi feito (24–25/09/2026)

### 1.1 Painel (artifact publicado)
- URL de compartilhamento (a que o Rodrigo usa/salva, gerada pelo menu Share): https://claude.ai/artifact/FcpbPrdBUJPfjDbQ4twxZF
- URL interna do mesmo artefato (a que o Claude usa pra publicar atualizações via ferramenta): https://claude.ai/code/artifact/76604dac-dbf1-47e4-a2ec-2a5a0c9c964a — achada em 28/09/2026 via `Artifact(action: "list")`, porque a ferramenta de publicação não aceita o formato da URL de compartilhamento como destino de atualização. Mesmo artefato ("Fluxo de Caixa Oystr", só essa entrada na lista), duas portas de entrada.
- Abas: Diário, Por categoria, Visão mensal, Inadimplência. A aba "Radar do CEO" foi removida.
- Por categoria: clique em qualquer número abre o detalhe (composição, lançamentos, rateio do título) com Exportar Excel (CSV); gráfico "Evolução mensal do caixa" (linha) acima da tabela; gráfico "Entradas, saídas e faturamento — 2026" com linha do saldo do mês; análise com os cards da Visão mensal que não se repetiam.
- Visão mensal: out–dez usam a mesma conta da aba Por categoria (catmes + regra do dashboard + cenário) — as duas abas batem mês a mês nos 3 cenários.
- Valores sem centavos na tela (CSV exportado mantém centavos).
- Limitação conhecida: com o artifact aberto direto pela URL, `claude.use("downloads")` retorna null — Exportar Excel não funciona nesse modo. Só resolve servindo o painel no painel.proos.com.br.

### 1.2 Rotina de dados: saiu o Excel, entrou um pacote JSON
Antes: `refresh_oystr_diagnostico.py` (2 modos) → `Oystr_Diagnostico_Consolidado_*.xlsx` (23 abas, fórmulas) + `analise_faturamento_mrr.py` + `extrair_fluxo_caixa_portal.py` → Claude montava o HTML à mão.
Agora (validado em 25/09, primeira rodada real sem Excel):

```
exportar_pacote_caixa.py   ─┐
extrair_fluxo_caixa_portal ─┼─► dados/oystr/AAAA-MM-DD/ ─► montar_painel_caixa.py ─► painel.html + checagem.json
historico_2025.json (fixo) ─┘
```

- Mesma lógica de negócio do Omie (reusa `montar_relatorio()` de `omie_mcp/reports/oystr_diagnostico.py`, sem recalcular nada).
- Validação: o pacote convertido do xlsx de 24/09 gerou `extra.json` com 0 diferenças e `painel.html` byte a byte igual ao publicado. A rodada de 25/09 gerada no Windows também saiu idêntica à montada no Claude.
- MRR saiu da rotina (já está no painel.proos.com.br, lendo a API). `analise_faturamento_mrr.py` não é mais necessário para este painel.

---

## 2. Arquivos e pastas

> **Atualização 28/09/2026**: o `proos-omie-mcp` deixou de ser um repositório
> separado — foi consolidado dentro do `painel-automacoes` (via `git subtree`,
> preservando histórico), em `painel-automacoes/proos-omie-mcp/`. O
> `extrair_fluxo_caixa_portal.py` também veio junto do `proos-automacoes`
> pra cá (era a última peça fora do repositório único). O resto desta
> seção 2 e boa parte da seção 5 abaixo descrevem o estado ANTES dessa
> consolidação — os caminhos `C:\Users\Usuario\Office 365\...\proos-omie-mcp`
> e `C:\Users\Usuario\proos-automacoes\oystr` citados abaixo não existem
> mais nesse papel; tudo é `painel-automacoes/proos-omie-mcp/`.

### proos-omie-mcp (`painel-automacoes/proos-omie-mcp/`, desde 28/09/2026 — ver nota acima)
| Caminho | Status | Função |
|---|---|---|
| `scripts/exportar_pacote_caixa.py` | NOVO | Busca no Omie e grava as 7 bases em JSON + `manifesto.json`. Args: `--cliente oystr --desde 01/01/2025 [--ate hoje] [--saida dados]` |
| `scripts/montar_painel_caixa.py` | NOVO | Roda o build_extra e monta `painel.html` + `checagem.json`. Arg: `--pacote dados/oystr/AAAA-MM-DD` |
| `scripts/build_extra_dashboard_caixa.py` | ALTERADO | Aceita `--pacote` (padrão) ou `.xlsx` (legado). Histórico do extrato desligado por padrão (`--usar-historico-extrato` para ligar). Grava UTF-8. |
| `scripts/gravar_pacote_caixa.py` | NOVO (28/09) | Lê o pacote já montado e grava em `caixa_pacote_diario` (Postgres do painel-automacoes) — substitui o arquivo local como fonte de dado pra atualização automática. |
| `scripts/extrair_fluxo_caixa_portal.py` | MOVIDO (28/09, veio do proos-automacoes) | `--saida <pasta>` (grava `extrato.json` no pacote); `LIMITE_PADRAO = {"OYSTR": {"itau - conta corrente": 61500}}` aplicado quando o Omie não informa limite. Credencial em `scripts/credenciais.env` (gitignored), não em `clientes_omie.json`/Infisical. |
| `paineis/fluxo_caixa/template.html` | NOVO | Modelo do painel (HTML/CSS/JS). Placeholders: `__DATA__`, `__EXTRA__`, `__LOGO__`, `__REFDIAG__` |
| `paineis/fluxo_caixa/logo.txt` | NOVO | Logo Proos em base64 |
| `dados/oystr/historico_2025.json` | NOVO | Jan–Dez/25 fixo (ent, sai, acum) — extraído da aba "Fluxo Mensal Historico" |
| `dados/oystr/AAAA-MM-DD/` | GERADO | Pacote do dia (ver 2.1) |
| `atualizar_painel_caixa.ps1`/`.sh` | NOVO | Roda as 4 etapas (Windows/Linux) — a 4ª grava no banco |
| `.gitignore` | ALTERADO | `dados/`, `scripts/credenciais.env` (dados financeiros/credencial de cliente — nunca versionar) |
| `scripts/refresh_oystr_diagnostico.py`, `scripts/analise_faturamento_mrr.py` | REMOVIDO (28/09) | Caminho antigo com Excel, aposentado |
| `.venv` | recriado do zero em 28/09 | `requirements.txt` — `pandas`, `psycopg[binary]`, `requests` |

### 2.1 Conteúdo do pacote `dados/oystr/AAAA-MM-DD/`
| Arquivo | Origem | Observação |
|---|---|---|
| `recebimentos.json`, `pagamentos.json`, `receber_aberto.json`, `pagar_aberto.json`, `contratos_nao_faturados.json`, `os_nao_faturadas.json` | exportar_pacote_caixa | Mesmos nomes de coluna das antigas abas "Base -"; datas ISO |
| `status_contratos.json` | exportar_pacote_caixa (ListarContratos) | Status 10=Ativo, 90=Suspenso, 99=Cancelado |
| `manifesto.json` | exportar_pacote_caixa | período, ref (data), contagens, estatísticas, horário |
| `extrato.json` | extrair_fluxo_caixa_portal `--saida` | contas, dias, movimentos, caixaProprio |
| `extra.json` | montar_painel_caixa (build_extra) | dados agregados do painel |
| `painel.html` | montar_painel_caixa | o que é publicado |
| `checagem.json` | montar_painel_caixa | números-chave + `avisos` (limite zerado; extrato e bases de datas diferentes) |

Tamanho ≈ 6 MB por dia.

---

## 3. Comandos atuais (Windows, manual)
```powershell
cd "C:\Users\Usuario\Office 365\Proos - Documentos\Portal Proos\proos-omie-mcp"
powershell -ExecutionPolicy Bypass -File .\atualizar_painel_caixa.ps1
```
Equivalente, passo a passo (é o que a VPS vai rodar):
```bash
export PYTHONUTF8=1
python scripts/exportar_pacote_caixa.py --cliente oystr --desde 01/01/2025
python scripts/extrair_fluxo_caixa_portal.py --cliente OYSTR --historico_desde nao --saida dados/oystr/$(date +%F)
python scripts/montar_painel_caixa.py --pacote dados/oystr/$(date +%F)
python scripts/gravar_pacote_caixa.py --pacote dados/oystr/$(date +%F)
```
Tempo: ~10 min (etapa 1 ≈ 9 min; etapa 2 ≈ 1 min com `--historico_desde nao`; etapas 3-4 segundos).

---

## 4. Lições que não podem se perder
- Windows: Python usa cp1252 por padrão → sempre `PYTHONUTF8=1` e `encoding="utf-8"` em todo open(). (Na VPS Linux isso já é o padrão, mas manter.)
- `--ate` tem que ser a data de hoje (o exportar já usa hoje por padrão) — data atrasada some com títulos baixados.
- Histórico mensal do extrato (`historicoMensal`) NÃO bate com o banco (ago/26 R$ 1,18 mi vs ≈ R$ 400 mil real; saídas mar–ago R$ 100–150 mil/mês menores que o Diagnóstico). Por isso fica desligado e 2025 vem do `historico_2025.json`. Pendência: investigar o que o ListarExtrato deixa de fora (cartão? aplicação? transferências?).
- O limite do Itaú às vezes vem zerado do Omie → `LIMITE_PADRAO` no extrair + aviso no `checagem.json`.
- Não reimplementar a lógica do Omie em nós do n8n: o n8n só orquestra (7 bugs já corrigidos no Python).
- Credenciais: `clientes_omie.json` (Oystr agora vem do Infisical, sem segredo no arquivo — ver `omie_mcp/infisical.py`) e `scripts/credenciais.env` (OYSTR_KEY/OYSTR_SECRET do `extrair_fluxo_caixa_portal.py`, ainda não migrado pro Infisical): nunca no git.

---

## 5. O que falta fazer — levar para a VPS

### 5.1 Código
- [x] Versionar as mudanças (varios commits, 25-28/09/2026).
- [x] Consolidar tudo num repositório só: `git subtree` trouxe o `proos-omie-mcp` inteiro pra dentro do `painel-automacoes` (`proos-omie-mcp/`, histórico preservado), e `extrair_fluxo_caixa_portal.py` veio do `proos-automacoes` junto (28/09/2026). O `proos-omie-mcp` como repositório separado no OneDrive fica só como cópia antiga/backup, sem uso ativo.
- [x] `requirements.txt` com `pandas`, `psycopg[binary]`, `requests` e o que o `omie_mcp`/MCP usam (`mcp<2` travado — achado real, 2.x quebra `omie_mcp/server.py`).
- [ ] `git push` do `painel-automacoes` pro GitHub (`RodrigoColin/painel-automacoes`) — commits ainda só locais.

### 5.2 VPS — achado importante (28/09/2026): já existe uma VPS, mas o painel de caixa nunca foi ligado nela

Descoberto ao investigar por que o deploy do Vercel está bloqueado (~10 deploys seguidos desde 22/09): existe uma
migração real, feita em 22/09/2026 (branch `migracao-vps`, ver `deploy/LEIA-ME.md`), que tirou o
`painel-automacoes` do Supabase/Vercel e passou pra uma VPS (`45.179.90.19`, `/opt/painel`), com
Postgres, app (Next.js) e cron em containers Docker, deploy automático via GitHub Actions
(`.github/workflows/deploy.yml`). **Ainda não confirmado com a pessoa responsável se essa VPS está
de fato no ar servindo `painel.proos.com.br`, ou se a virada de DNS não chegou a acontecer** —
pergunta enviada, resposta pendente.

Confirmado por revisão de código (não depende da resposta acima):
- O `proos-omie-mcp` **nunca foi levado pra essa VPS** — o `deploy.yml` só empacota e envia as 3
  imagens Docker (`app`, `executor`, `cron`), não a pasta inteira do repositório.
- A imagem do `app` é `node:24-alpine` — **sem Python nenhum**. A Conciliação Bancária
  (`acoes-conciliacao.ts`), que chama Python via `execFile` apontando por padrão pra
  `proos-omie-mcp/.venv/Scripts/python.exe` (caminho de Windows!), **não funciona nesse ambiente**,
  apesar do commit que portou as telas dizer "entra sem alteração" — a parte que roda o Python
  não tem onde rodar.
- O container `executor` tem Python, mas é um sandbox genérico pra scripts avulsos de automação
  (sem pandas/psycopg/openpyxl, sem acesso a banco, sem o código do `proos-omie-mcp`) — não serve
  pra rodar nosso pipeline nem a conciliação.
- **Decisão (28/09/2026): usar o n8n pra orquestrar o painel de caixa, não o pipeline de deploy do
  app.** O n8n já roda do lado do painel (`/opt/n8n`, mesma VPS). Ele mantém o `proos-omie-mcp`
  atualizado sozinho (`git pull`) e dispara o script por SSH — não depende do Dockerfile do app,
  não decompõe o problema da Conciliação Bancária (que é outro, ver abaixo), mas resolve o caixa
  sem precisar reconstruir um container Python dentro do `docker-compose.yml` do painel.

**Runbook (pronto pra executar assim que a VPS for confirmada):**

1. Preparo único, por SSH:
   ```sh
   git clone https://github.com/RodrigoColin/painel-automacoes.git /opt/painel-automacoes
   cd /opt/painel-automacoes/proos-omie-mcp
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   ```
   Credenciais (nunca versionadas, criar direto na VPS):
   - `.env`: `DATABASE_URL` (Postgres do `docker-compose.yml` do painel — precisa estar
     alcançável pela rede que o n8n usa) + `INFISICAL_CLIENT_ID`/`INFISICAL_CLIENT_SECRET`.
   - `scripts/credenciais.env`: `OYSTR_KEY`/`OYSTR_SECRET` (enquanto o mapeamento Oystr→Infisical
     de produção não existir, usar `clientes_omie.json` com credencial de arquivo, igual ao teste
     local de 28/09).
2. Testar uma vez na mão: `cd /opt/painel-automacoes/proos-omie-mcp && ./atualizar_painel_caixa.sh`
   — confirma que os 4 passos rodam e o `painel.html` sai certo antes de confiar no n8n.
3. Dois workflows no n8n:
   - **A) Disparo diário** — Schedule Trigger (6h, horário de Brasília) → nó SSH:
     ```sh
     cd /opt/painel-automacoes && git pull --ff-only
     cd proos-omie-mcp && N8N_WEBHOOK_URL='<url do workflow B>' ./atualizar_painel_caixa.sh
     ```
   - **B) Alerta de falha** — Webhook Trigger → IF (`{{$json.status}} == "erro"`) → notificação
     (Slack/e-mail/o que já usarem), com `checagem`/`log_tail` do payload (o script já monta esse
     payload sozinho, ver `enviar_webhook()` em `atualizar_painel_caixa.sh`).

**Em aberto, dependem da pessoa responsável pela VPS:**
- [ ] A VPS está mesmo no ar, com o DNS de `painel.proos.com.br` apontando pra ela?
- [ ] O n8n consegue alcançar o Postgres do painel pela rede (mesma rede Docker, ou porta exposta)?
- [ ] Infisical (produção) ou credencial de arquivo pra Oystr — mapeamento existe no banco de lá?
- [ ] Acesso SSH pra executar o passo 1 (usuário, chave — pode ser o mesmo `deploy` do GitHub Actions).

**Conciliação Bancária — problema separado, ainda sem solução desenhada:** diferente do caixa
(rotina agendada, resolvida pelo n8n), a conciliação é uma tela interativa (upload de extrato,
resultado na hora) — precisa que o próprio `app` consiga chamar Python de forma síncrona. Isso
exige um executor de verdade (com as dependências certas, código do `proos-omie-mcp` e acesso ao
banco), não resolvido pelo n8n. Fica como pendência separada.

### 5.4 Publicação
- Transição (artifact): expor o `painel.html` do dia num endereço HTTPS protegido (Nginx + Basic Auth ou token), e uma tarefa agendada do Claude busca o arquivo depois da rodada e republica no mesmo link (a URL não muda).
- Definitivo (recomendado para acesso diário do cliente): aba "Fluxo de caixa" no painel.proos.com.br, com login por cliente. Opção rápida: servir o `painel.html` do dia atrás do login. Opção integrada: o portal lê `extra.json` + `extrato.json`. Resolve também o Exportar Excel e tira a dependência do Claude para publicar.

### 5.5 Para o próximo cliente
- Parametrizar `--cliente` no exportar/extrair/montar (hoje o nome "Oystr" e algumas regras — categorias, grupos, limite, contas excluídas — estão no template/build_extra/extrair). Levantar o que é específico da Oystr antes de replicar.

---

## 6. Pendências de negócio abertas
- Diferença do histórico do extrato vs Diagnóstico (seção 4).
- Contas a pagar vencidas em aberto no Omie e datas de previsão dos títulos a pagar: confirmar com a Oystr.
- Concentração de recebimento (dependência dos 3 maiores clientes nos próximos 30 dias): item do plano original ainda não feito.
