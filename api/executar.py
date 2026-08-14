"""Executor dos scripts Python das automacoes.

Roda como Vercel Function Python, separada do runtime Next. O dispatcher em
`/api/agendador` chama esta rota; ela executa o script pedido e devolve saida,
erro e codigo de saida.

Os scripts sao de primeira parte: vivem em `scripts/` neste repositorio e
passam por revisao como qualquer outro codigo. Esta funcao NAO executa codigo
enviado por usuario — se isso passar a ser necessario, o caminho e o Vercel
Sandbox, nao este endpoint.
"""

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

# Scripts so podem sair daqui. Impede que `entrada` aponte para outro lugar
# do sistema de arquivos via caminho relativo.
RAIZ_SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"

LIMITE_CORPO = 1 * 1024 * 1024  # 1 MB de payload basta e evita abuso.


def resolver_script(entrada: str) -> Path | None:
    """Resolve `entrada` dentro de `scripts/`, recusando escapes de caminho."""
    if not entrada or entrada.startswith("/") or "\x00" in entrada:
        return None

    # `entrada` vem como "scripts/x.py" ou "x.py"; normaliza para dentro da raiz.
    relativo = entrada[len("scripts/"):] if entrada.startswith("scripts/") else entrada

    try:
        alvo = (RAIZ_SCRIPTS / relativo).resolve()
    except (OSError, ValueError):
        return None

    # `..` no caminho tentaria sair da pasta — resolve() ja normalizou, entao
    # basta conferir que o resultado continua sob a raiz.
    if RAIZ_SCRIPTS not in alvo.parents and alvo != RAIZ_SCRIPTS:
        return None
    if alvo.suffix != ".py" or not alvo.is_file():
        return None

    return alvo


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        segredo = os.environ.get("EXECUTOR_SECRET")
        if not segredo:
            return self._responder(500, {"erro": "EXECUTOR_SECRET ausente no ambiente."})

        # Sem isto qualquer um na internet dispararia execucao de script.
        if self.headers.get("X-Executor-Secret") != segredo:
            return self._responder(401, {"erro": "Nao autorizado."})

        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._responder(400, {"erro": "Content-Length invalido."})

        if tamanho <= 0 or tamanho > LIMITE_CORPO:
            return self._responder(400, {"erro": "Corpo ausente ou grande demais."})

        try:
            dados = json.loads(self.rfile.read(tamanho))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._responder(400, {"erro": "JSON invalido."})

        script = resolver_script(str(dados.get("entrada", "")))
        if script is None:
            return self._responder(
                400, {"erro": "Script nao encontrado em scripts/ ou caminho recusado."}
            )

        # O script recebe um ambiente enxuto: as variaveis da automacao mais o
        # minimo para o Python rodar. Nao herda os segredos da aplicacao.
        ambiente = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", "/tmp"),
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        for chave, valor in (dados.get("variaveis") or {}).items():
            if isinstance(chave, str) and isinstance(valor, str):
                ambiente[chave] = valor

        try:
            timeout = max(1, min(int(dados.get("timeout", 300)), 290))
        except (TypeError, ValueError):
            timeout = 300

        try:
            processo = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True,
                text=True,
                timeout=timeout,
                env=ambiente,
                cwd=str(RAIZ_SCRIPTS),
                check=False,
            )
        except subprocess.TimeoutExpired:
            return self._responder(
                200,
                {
                    "ok": False,
                    "codigo": None,
                    "stdout": "",
                    "stderr": "",
                    "erro": f"Script excedeu o tempo limite de {timeout}s.",
                },
            )
        except OSError as erro:
            return self._responder(
                200,
                {"ok": False, "codigo": None, "stdout": "", "stderr": "", "erro": str(erro)},
            )

        return self._responder(
            200,
            {
                "ok": processo.returncode == 0,
                "codigo": processo.returncode,
                "stdout": processo.stdout,
                "stderr": processo.stderr,
            },
        )

    def _responder(self, status: int, corpo: dict):
        payload = json.dumps(corpo).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        """Silencia o log padrao do BaseHTTPRequestHandler."""
