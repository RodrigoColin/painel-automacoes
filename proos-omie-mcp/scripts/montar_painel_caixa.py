"""
Monta o HTML do painel "Fluxo de caixa · Oystr" a partir de um pacote de dados.

    python scripts\\montar_painel_caixa.py --pacote dados\\oystr\\2026-09-25

Passos (sem Excel):
  1. build_extra_dashboard_caixa.py --pacote <pasta>  ->  <pasta>/extra.json
  2. paineis/fluxo_caixa/template.html + extrato.json + extra.json + logo  ->  <pasta>/painel.html

O painel.html é o mesmo arquivo publicado no artifact "Fluxo de Caixa Oystr"
(e o que a VPS vai servir na Opção 2). Também grava <pasta>/checagem.json com
os números-chave, para o n8n/alerta conferir sem abrir o HTML.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAINEL = RAIZ / "paineis" / "fluxo_caixa"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pacote", required=True)
    args = ap.parse_args()
    pacote = Path(args.pacote).resolve()

    for arq in ("manifesto.json", "extrato.json", "recebimentos.json", "pagar_aberto.json"):
        if not (pacote / arq).exists():
            print(f"[erro] falta {arq} em {pacote}")
            return 1

    extra = pacote / "extra.json"
    r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "build_extra_dashboard_caixa.py"),
                        "--pacote", str(pacote), "--out", str(extra)],
                       env={**os.environ, "PYTHONUTF8": "1"})  # força UTF-8 no Windows (padrão cp1252)
    if r.returncode != 0:
        print("[erro] build_extra falhou")
        return r.returncode

    D = json.loads((pacote / "extrato.json").read_text(encoding="utf-8"))
    bruto = extra.read_bytes()
    try:
        X = json.loads(bruto.decode("utf-8"))
    except UnicodeDecodeError:  # arquivo gravado por versão antiga (cp1252): regrava em UTF-8
        X = json.loads(bruto.decode("cp1252"))
        extra.write_text(json.dumps(X, ensure_ascii=False), encoding="utf-8")

    # Conferências que já deram problema de verdade (viram alerta no n8n):
    avisos = []
    lim = sum(c.get("limite") or 0 for c in D["contas"])
    if lim <= 0:
        avisos.append("limite da conta zerado no extrato (esperado R$ 61.500 no Itaú)")
    if D.get("hoje") != json.loads((pacote / "manifesto.json").read_text(encoding="utf-8")).get("ref"):
        avisos.append(f"extrato de {D.get('hoje')} e bases de outra data — rodar os dois no mesmo dia")

    esc = lambda o: json.dumps(o, ensure_ascii=False).replace("</", "<\\/")
    html = (PAINEL / "template.html").read_text(encoding="utf-8")
    html = (html.replace("__LOGO__", (PAINEL / "logo.txt").read_text(encoding="utf-8").strip())
                .replace("__DATA__", esc(D)).replace("__EXTRA__", esc(X))
                .replace("__REFDIAG__", "/".join(reversed(str(X.get("ref", D.get("hoje")))[5:10].split("-")))))
    (pacote / "painel.html").write_text(html, encoding="utf-8", newline="\n")  # mesmo arquivo no Windows e na VPS

    checagem = {"ref": D.get("hoje"), "consultadoEm": D.get("consultadoEm"), "caixaProprio": D.get("caixaProprio"),
                "limiteConta": lim, "vencido2026": X.get("inad", {}).get("total"), "avisos": avisos}
    (pacote / "checagem.json").write_text(json.dumps(checagem, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Painel: {pacote / 'painel.html'}")
    for a in avisos:
        print(f"[aviso] {a}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
