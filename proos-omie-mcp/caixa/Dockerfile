# Pipeline do fluxo de caixa (ver caixa/worker.py).
#
# Contexto do build: a pasta proos-omie-mcp (precisa de omie_mcp/ e caixa/).
#   docker build -f proos-omie-mcp/caixa/Dockerfile proos-omie-mcp
#
# /data/cache guarda os títulos já liquidados que o Omie devolveu (não mudam
# mais): num volume, as rodadas seguintes só consultam os títulos novos.

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=America/Sao_Paulo \
    OMIE_CACHE_DIR=/data/cache

RUN useradd --system --uid 1001 --create-home caixa \
 && mkdir -p /data/cache \
 && chown caixa:caixa /data/cache

WORKDIR /app
COPY caixa/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY omie_mcp ./omie_mcp
COPY caixa ./caixa

USER caixa
CMD ["python", "-m", "caixa.worker"]
