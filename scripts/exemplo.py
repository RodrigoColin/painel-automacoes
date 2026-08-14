"""Script de exemplo — serve para validar o caminho de execucao ponta a ponta.

Os scripts das automacoes vivem nesta pasta, versionados como qualquer outro
codigo. O executor so roda arquivos daqui, e recebe as variaveis de ambiente
configuradas na automacao.
"""

import os
import sys
from datetime import datetime, timezone

print(f"Executado em {datetime.now(timezone.utc).isoformat()}")
print(f"Python {sys.version.split()[0]}")

# As variaveis vem do campo "Variaveis de ambiente" da automacao, guardadas
# em `automacao_segredos` e nunca expostas ao navegador.
configuradas = sorted(
    chave
    for chave in os.environ
    if chave not in {"PATH", "HOME", "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE"}
)

if configuradas:
    print(f"Variaveis recebidas: {', '.join(configuradas)}")
else:
    print("Nenhuma variavel de ambiente configurada.")
