# Atualiza o painel "Fluxo de caixa · Oystr" (sem Excel).
# Uso: clique com o botão direito > "Executar com o PowerShell"
#      ou, no PowerShell:  .\atualizar_painel_caixa.ps1
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"   # Python sempre em UTF-8 (no Windows o padrão é cp1252)
$mcp   = "C:\Users\Usuario\Office 365\Proos - Documentos\Portal Proos\proos-omie-mcp"
$oystr = "C:\Users\Usuario\proos-automacoes\oystr"
$py    = Join-Path $mcp ".venv\Scripts\python.exe"
$hoje  = Get-Date -Format "yyyy-MM-dd"
$pasta = Join-Path $mcp "dados\oystr\$hoje"

Write-Host "`n=== 1/3  Bases do Omie (contas a receber/pagar, recebimentos, pagamentos, contratos) ===" -ForegroundColor Cyan
Set-Location $mcp
& $py scripts\exportar_pacote_caixa.py --cliente oystr --desde 01/01/2025
if ($LASTEXITCODE -ne 0) { Write-Host "Falhou no passo 1. Rode de novo; se repetir, mande a mensagem ao Claude." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 2/3  Extrato e previsão diária ===" -ForegroundColor Cyan
Set-Location $oystr
& $py extrair_fluxo_caixa_portal.py --cliente OYSTR --historico_desde nao --saida $pasta
if ($LASTEXITCODE -ne 0) { Write-Host "Falhou no passo 2. Rode de novo; se repetir, mande a mensagem ao Claude." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 3/3  Montando o painel ===" -ForegroundColor Cyan
Set-Location $mcp
& $py scripts\montar_painel_caixa.py --pacote $pasta
if ($LASTEXITCODE -ne 0) { Write-Host "Falhou no passo 3. Mande a mensagem ao Claude." -ForegroundColor Red; exit 1 }

Write-Host "`nPronto! Pasta do dia: $pasta" -ForegroundColor Green
Write-Host "Avise o Claude para publicar o painel." -ForegroundColor Green
