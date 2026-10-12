# Toolkit de Migração / Implantação — Conta Azul → Omie

Ferramentas reutilizáveis para migrar o histórico financeiro do Conta Azul para o Omie e configurar a operação (BPO Proos). Destilado do projeto Desimec.

> **Este diretório NÃO contém dados de cliente.** Só scripts, templates e referência. Os dados e credenciais de cada cliente ficam **fora do repositório** (ver abaixo).

## Estrutura
```
migracao-omie/
├─ playbook.md          Metodologia + todos os gotchas de API (CA e Omie). LEIA PRIMEIRO.
├─ scripts/             PowerShell reutilizável (extração, importação, baixas, etc.)
├─ templates/           .env.example + de_para_categorias_base.csv
└─ referencia/          plano_categorias_dre.md + lotes de categoria (exemplos Desimec)
```

## Como usar (por cliente)
1. Crie a pasta do cliente **fora do repositório**, ex.:
   `Portal Proos/Migracao/<Cliente>/` (ou `Clientes/<Cliente>/`).
2. Copie `scripts/*.ps1` e `templates/.env.example` para lá; renomeie para `.env.local` e preencha as credenciais.
3. Adapte o `de_para_categorias_base.csv` às categorias do cliente.
4. Rode na ordem do **playbook.md** (auditoria → categorias → clientes → saldos → CP/CR → conferência → operação).
5. Os dados extraídos (`dados/`), o `.env.local`, `tokens.json` e o extrato `.xls/.ofx` ficam **só na pasta do cliente**.

## ⚠️ Segurança (obrigatório)
- **Nunca** commitar `.env.local`, `tokens.json`, `dados/`, extratos (`*.xls`, `*.ofx`) ou qualquer dado financeiro de cliente. (O `.gitignore` já bloqueia os padrões conhecidos.)
- Credenciais de cliente: mantenha a pasta do cliente **fora de pasta sincronizada em nuvem** (OneDrive/Drive) quando possível, ou com os segredos protegidos.
- Se um `client_secret`/`app_secret` vazar (ex.: passou por chat/log), **rotacione** no portal correspondente.

## Scripts principais
| Script | Função |
|---|---|
| `extrator.ps1` | Extrai do CA (clientes, fornecedores, categorias, contas, CP, CR) → JSON em `dados/` |
| `import_cp.ps1` / `import_cr.ps1` | Importa CP/CR históricos (2021+) via Upsert...PorLote (idempotente) |
| `build_cr_historico.ps1` | Monta o lote de CR (categoria + cliente resolvidos) |
| `build_2020.ps1` / `import_2020_titulos.ps1` | 2020 via workaround (venc 01/01/2021 + emissão/baixa reais) |
| `baixa_cr_overlap.ps1` | Baixa as NFs de 2026 já emitidas no Omie na data real (conciliação de overlap) |

Detalhes, limitações e armadilhas de cada canal: **`playbook.md`**.
