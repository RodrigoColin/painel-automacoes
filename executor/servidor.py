"""Executor dos scripts Python das automacoes.

Roda num container proprio (`executor` no docker-compose), separado do Next.
O agendador em `/api/agendador` le o script da automacao do disco e manda o
codigo no corpo da chamada; este servidor grava o arquivo num diretorio
temporario, executa e devolve saida, erro e codigo de saida.

O container nao tem acesso ao banco nem ao volume de arquivos: recebe o
codigo pronto, e so e alcancavel pela rede interna do Docker (a porta nao e
publicada no host). O script e enviado por admin da Proos na criacao da
automacao. Se clientes passarem a enviar codigo, isto precisa de um sandbox
de verdade, nao deste container.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# O script pode ter ate 1 MB (limite do bucket). O JSON escapa aspas, barras
# e caracteres de controle, entao o corpo pode crescer bem alem disso.
LIMITE_CORPO = 8 * 1024 * 1024


def nome_seguro(nome: str) -> str:
    """Reduz o nome enviado a um basename .py sem caracteres estranhos."""
    base = re.sub(r"[^A-Za-z0-9._-]", "_", Path(nome).name) or "script.py"
    return base if base.endswith(".py") else f"{base}.py"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Healthcheck do docker-compose. Nao revela nada alem de "estou de pe".
        if self.path == "/saude":
            return self._responder(200, {"ok": True})
        return self._responder(404, {"erro": "Nao encontrado."})

    def do_POST(self):
        if self.path != "/api/executar":
            return self._responder(404, {"erro": "Nao encontrado."})

        segredo = os.environ.get("EXECUTOR_SECRET")
        if not segredo:
            return self._responder(500, {"erro": "EXECUTOR_SECRET ausente no ambiente."})

        # Sem isto qualquer um na internet dispararia execucao de codigo.
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

        codigo = dados.get("codigo")
        if not isinstance(codigo, str) or not codigo.strip():
            return self._responder(400, {"erro": "Codigo do script ausente."})

        # O script recebe um ambiente enxuto, o minimo para o Python rodar.
        # Nao herda os segredos da aplicacao.
        ambiente = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", "/tmp"),
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }

        # Teto herdado da Vercel (funcao de 300 s). Fora dela nao ha limite
        # imposto, mas manter o teto evita um script travado segurar um
        # processo para sempre.
        try:
            timeout = max(1, min(int(dados.get("timeout", 300)), 290))
        except (TypeError, ValueError):
            timeout = 290

        # Diretorio proprio por execucao, apagado ao final: execucoes
        # simultaneas na mesma instancia nao enxergam o arquivo uma da outra.
        with tempfile.TemporaryDirectory(prefix="automacao-") as pasta:
            script = Path(pasta) / nome_seguro(str(dados.get("nome", "")))
            script.write_text(codigo, encoding="utf-8")

            try:
                processo = subprocess.run(
                    [sys.executable, str(script)],
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    env=ambiente,
                    cwd=pasta,
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


if __name__ == "__main__":
    # Uma thread por requisicao: o agendador dispara em serie dentro de uma
    # rodada, mas uma rodada lenta ainda esta rodando quando o cron chama a
    # do minuto seguinte.
    porta = int(os.environ.get("PORTA", "8000"))
    ThreadingHTTPServer(("0.0.0.0", porta), handler).serve_forever()
