#!/bin/bash
# Atualiza o painel "Fluxo de caixa · Oystr" (sem Excel) — equivalente Linux
# do atualizar_painel_caixa.ps1, pra rodar na VPS via cron. O n8n so' cuida
# de alerta (le' o webhook que este script dispara no fim), nao orquestra.
#
# Uso:
#   ./atualizar_painel_caixa.sh
#
# Caminhos configuraveis por variavel de ambiente (default = layout da VPS,
# ver docs/HANDOFF_PAINEL_CAIXA_VPS.md secao 5.2):
#   MCP_DIR          pasta do proos-omie-mcp   (default /opt/proos/proos-omie-mcp)
#   DATABASE_URL     connection string do Postgres do painel-automacoes (a
#                    mesma que o app usa) — sem ela o passo 4/4 (gravar no
#                    banco) para o script com erro, ja que essa gravacao
#                    deixou de ser opcional (2026-09-28).
#   N8N_WEBHOOK_URL  se definida, recebe um POST no fim (sucesso ou falha) —
#                    ver enviar_webhook() abaixo pro formato exato.
#
# Cron sugerido (todo dia as 6h, horario de Brasilia):
#   0 6 * * * MCP_DIR=/opt/proos/proos-omie-mcp N8N_WEBHOOK_URL=https://.../webhook/painel-caixa /opt/proos/proos-omie-mcp/atualizar_painel_caixa.sh
# Se o servidor estiver em UTC (nao em horario de Brasilia), use "0 9 * * *"
# (Brasilia = UTC-3, sem horario de verao).
set -e

MCP_DIR="${MCP_DIR:-/opt/proos/proos-omie-mcp}"
PY="$MCP_DIR/.venv/bin/python"
HOJE="$(date +%F)"
PASTA="$MCP_DIR/dados/oystr/$HOJE"
LOG_DIR="$MCP_DIR/logs"
LOG="$LOG_DIR/$HOJE.log"
RETENCAO_DIAS=90

mkdir -p "$LOG_DIR"
# Tudo (stdout + stderr) vai pro log E continua aparecendo no console/n8n.
exec > >(tee -a "$LOG") 2>&1

export PYTHONUTF8=1   # mesmo cuidado do .ps1 — no Linux ja e' o padrao, mas explicito nao custa

ETAPA_FALHOU=""

# --- retry: so' pras duas etapas que chamam a API do Omie (erro pontual
# ja conhecido — ver secao 4 do handoff). Espera 10 min e tenta mais 1 vez
# antes de desistir de verdade.
rodar_com_retry() {
    local descricao="$1"
    shift
    if "$@"; then
        return 0
    fi
    echo ""
    echo "AVISO: $descricao falhou na 1a tentativa - aguardando 10 min pra "
    echo "tentar de novo (erro pontual conhecido do Omie, ver handoff secao 4)."
    sleep 600
    if "$@"; then
        echo "$descricao funcionou na 2a tentativa."
        return 0
    fi
    echo "ERRO: $descricao falhou de novo depois da 2a tentativa."
    return 1
}

# --- aviso ao n8n (so' alerta, nao orquestra) — best-effort: se o webhook
# falhar (URL fora do ar, DNS, etc.), so' registra no log, nunca derruba a
# rotina do dia. Nunca manda credenciais nem o conteudo dos pacotes — so'
# checagem.json (numeros-chave + avisos) e as ultimas linhas do log.
enviar_webhook() {
    local status="$1" etapa="$2"
    if [ -z "${N8N_WEBHOOK_URL:-}" ]; then
        return 0
    fi

    local payload
    payload="$("$PY" - "$status" "$HOJE" "$etapa" "$PASTA/checagem.json" "$LOG" <<'PYEOF'
import json
import sys

status, data, etapa, checagem_path, log_path = sys.argv[1:6]

checagem = None
try:
    with open(checagem_path, encoding="utf-8") as f:
        checagem = json.load(f)
except Exception:
    checagem = None

try:
    # o log e' escrito por um "tee" assincrono (exec > >(tee ...)) — em
    # tese pode faltar a ultima linha ou duas por uma corrida de tempo,
    # mas pra um resumo de alerta isso e' aceitavel (nao vale a
    # complexidade de sincronizar com wait/PID do subshell aqui).
    with open(log_path, encoding="utf-8", errors="replace") as f:
        linhas = f.readlines()[-30:]
except Exception:
    linhas = []

print(json.dumps({
    "status": status,
    "data": data,
    "etapa_falhou": etapa or None,
    "checagem": checagem,
    "log_tail": "".join(linhas),
}, ensure_ascii=False))
PYEOF
    )" || {
        echo "AVISO: nao consegui montar o aviso do webhook (nao afeta o resultado da rotina)."
        return 0
    }

    if ! curl -fsS -m 15 -X POST -H "Content-Type: application/json" \
            -d "$payload" "$N8N_WEBHOOK_URL" >/dev/null 2>&1; then
        echo "AVISO: falha ao notificar o webhook do n8n (nao afeta o resultado da rotina)."
    fi
}

# Roda sempre no fim, sucesso ou falha (inclusive quando `set -e` derruba o
# script no meio) — e' o que garante que o n8n sempre recebe o aviso.
finalizar() {
    local codigo=$?
    local status="ok"
    if [ "$codigo" -ne 0 ]; then
        status="erro"
    fi
    enviar_webhook "$status" "$ETAPA_FALHOU"
}
trap finalizar EXIT

echo ""
echo "===== $(date '+%Y-%m-%d %H:%M:%S') - atualizar_painel_caixa.sh ====="

echo ""
echo "=== 1/4  Bases do Omie (contas a receber/pagar, recebimentos, pagamentos, contratos) ==="
cd "$MCP_DIR"
if ! rodar_com_retry "Passo 1 (exportar_pacote_caixa)" \
        "$PY" scripts/exportar_pacote_caixa.py --cliente oystr --desde 01/01/2025; then
    ETAPA_FALHOU="1/4 exportar_pacote_caixa"
    exit 1
fi

echo ""
echo "=== 2/4  Extrato e previsao diaria ==="
if ! rodar_com_retry "Passo 2 (extrair_fluxo_caixa_portal)" \
        "$PY" scripts/extrair_fluxo_caixa_portal.py --cliente OYSTR --historico_desde nao --saida "$PASTA"; then
    ETAPA_FALHOU="2/4 extrair_fluxo_caixa_portal"
    exit 1
fi

echo ""
echo "=== 3/4  Montando o painel ==="
if ! "$PY" scripts/montar_painel_caixa.py --pacote "$PASTA"; then
    ETAPA_FALHOU="3/4 montar_painel_caixa"
    exit 1
fi

echo ""
echo "=== 4/4  Gravando no banco do painel-automacoes ==="
if ! "$PY" scripts/gravar_pacote_caixa.py --pacote "$PASTA"; then
    ETAPA_FALHOU="4/4 gravar_pacote_caixa"
    exit 1
fi

echo ""
echo "=== Limpeza: pacotes e logs com mais de $RETENCAO_DIAS dias ==="
find "$MCP_DIR/dados/oystr" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENCAO_DIAS" -print -exec rm -rf {} + \
    || echo "AVISO: limpeza de pacotes antigos falhou (nao critico, confira permissoes)."
find "$LOG_DIR" -maxdepth 1 -name '*.log' -mtime "+$RETENCAO_DIAS" -print -delete \
    || echo "AVISO: limpeza de logs antigos falhou (nao critico, confira permissoes)."

echo ""
echo "Pronto! Pasta do dia: $PASTA"
echo "Log salvo em: $LOG"
