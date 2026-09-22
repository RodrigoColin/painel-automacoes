# Executor dos scripts Python das automações (ver servidor.py).
#
# Usuário sem privilégio e sem nada do app dentro: o container só recebe o
# código pela rede interna do Docker e o roda num diretório temporário.

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=America/Sao_Paulo

RUN useradd --system --uid 1001 --create-home executor
WORKDIR /home/executor
COPY servidor.py .

USER executor
EXPOSE 8000
CMD ["python", "servidor.py"]
