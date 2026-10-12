# Extrator Conta Azul API v2 -> arquivos JSON (Desimec)
# Renova token, pagina tudo, trata UTF-8. Reutilizavel.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $dir 'dados'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# --- credenciais ---
$envFile = Join-Path $dir '.env.local'
$cfg = @{}
Get-Content $envFile | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
  $k,$v = $_ -split '=',2; $cfg[$k.Trim()] = $v.Trim()
}
$cid = $cfg['CONTAAZUL_CLIENT_ID']; $sec = $cfg['CONTAAZUL_CLIENT_SECRET']
$tokenUrl = 'https://api-v2.contaazul.com/oauth/token'
$base = 'https://api-v2.contaazul.com'

# --- renova access_token via refresh_token ---
$tok = Get-Content (Join-Path $dir 'tokens.json') -Raw | ConvertFrom-Json
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$cid`:$sec"))
try {
  $new = Invoke-RestMethod -Method Post -Uri $tokenUrl -Headers @{ Authorization = "Basic $basic" } `
         -ContentType 'application/x-www-form-urlencoded' `
         -Body @{ grant_type='refresh_token'; refresh_token=$tok.refresh_token }
  $new | ConvertTo-Json -Depth 5 | Out-File (Join-Path $dir 'tokens.json') -Encoding utf8
  $access = $new.access_token
  Write-Host "Token renovado (expira em $($new.expires_in)s)."
} catch {
  Write-Host "Refresh falhou, usando access_token atual. $($_.Exception.Message)"
  $access = $tok.access_token
}
$H = @{ Authorization = "Bearer $access" }

# --- GET com decodificacao UTF-8 correta ---
function Get-CA($url) {
  $resp = Invoke-WebRequest -Uri $url -Headers $H -UseBasicParsing
  $jsonTxt = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
  return $jsonTxt | ConvertFrom-Json
}

# --- paginador generico ---
function Collect($label, $urlBase, $itemsKey, $totalKey, $sep) {
  $all = @(); $pagina = 1; $size = 500
  do {
    $u = "$urlBase$sep" + "pagina=$pagina&tamanho_pagina=$size"
    $r = Get-CA $u
    $itens = $r.$itemsKey
    if ($itens) { $all += $itens }
    $total = [int]$r.$totalKey
    Write-Host ("  {0}: pagina {1} -> +{2} (total {3})" -f $label, $pagina, @($itens).Count, $total)
    $pagina++
  } while ($all.Count -lt $total -and @($itens).Count -gt 0)
  $file = Join-Path $outDir "$label.json"
  $all | ConvertTo-Json -Depth 8 | Out-File $file -Encoding utf8
  Write-Host ("  => {0} registros salvos em dados\{1}.json" -f $all.Count, $label)
  return $all
}

$resumo = [ordered]@{}

Write-Host "`n[1/6] Clientes"
$resumo.clientes = (Collect 'clientes' "$base/v1/pessoas?tipo_perfil=Cliente" 'items' 'totalItems' '&').Count
Write-Host "`n[2/6] Fornecedores"
$resumo.fornecedores = (Collect 'fornecedores' "$base/v1/pessoas?tipo_perfil=Fornecedor" 'items' 'totalItems' '&').Count
Write-Host "`n[3/6] Transportadoras"
$resumo.transportadoras = (Collect 'transportadoras' "$base/v1/pessoas?tipo_perfil=Transportadora" 'items' 'totalItems' '&').Count
Write-Host "`n[4/6] Categorias"
$resumo.categorias = (Collect 'categorias' "$base/v1/categorias?" 'itens' 'itens_totais' '').Count
Write-Host "`n[5/6] Contas financeiras"
$resumo.contas_financeiras = (Collect 'contas_financeiras' "$base/v1/conta-financeira?" 'itens' 'itens_totais' '').Count

Write-Host "`n[6/6] Contas a pagar e a receber (venc. 2015-01-01 a 2026-09-30)"
$per = 'data_vencimento_de=2015-01-01&data_vencimento_ate=2026-09-30'
$cp = Collect 'contas_a_pagar' "$base/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?$per" 'itens' 'itens_totais' '&'
$cr = Collect 'contas_a_receber' "$base/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?$per" 'itens' 'itens_totais' '&'
$resumo.contas_a_pagar = $cp.Count
$resumo.contas_a_receber = $cr.Count

# totais financeiros (1a pagina traz bloco 'totais')
$cpTot = (Get-CA "$base/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?$per&pagina=1&tamanho_pagina=10").totais
$crTot = (Get-CA "$base/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?$per&pagina=1&tamanho_pagina=10").totais

Write-Host "`n==================== RESUMO ===================="
$resumo.GetEnumerator() | ForEach-Object { "{0,-20}: {1}" -f $_.Key, $_.Value }
"CP totais  -> pago {0:N2} | aberto {1:N2} | todos {2:N2}" -f $cpTot.pago.valor, $cpTot.aberto.valor, $cpTot.todos
"CR totais  -> pago {0:N2} | aberto {1:N2} | todos {2:N2}" -f $crTot.pago.valor, $crTot.aberto.valor, $crTot.todos
($resumo + @{ cp_totais=$cpTot; cr_totais=$crTot; extraido_em='2026-10-10' }) | ConvertTo-Json -Depth 6 | Out-File (Join-Path $outDir '_resumo.json') -Encoding utf8
Write-Host "Arquivos em: $outDir"