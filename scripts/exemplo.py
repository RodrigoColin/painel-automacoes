"""Script de exemplo — serve para validar o caminho de execucao ponta a ponta.

Para usar, envie este arquivo no campo "Arquivo Python" da tela de nova
automacao. O executor grava o script num diretorio temporario e o roda com um
ambiente minimo, sem variaveis de ambiente da automacao.
"""

import sys
from datetime import datetime, timezone

print(f"Executado em {datetime.now(timezone.utc).isoformat()}")
print(f"Python {sys.version.split()[0]}")
