# Lanca 2020 (CR + CP) via IncluirLancCC na Itau-Historico. Resumivel.
# Em MISUSE: espera o cooldown (com heartbeat) e retoma sozinho; aborta se cooldown nao render progresso.
$ErrorActionPreference='Stop'
$inv=[Globalization.CultureInfo]::InvariantCulture
$dir=Split-Path -Parent $MyInvocation.MyCommand.Path; $d=Join-Path $dir 'dados'
$cfg=@{}; Get-Content (Join-Path $dir '.env.local')|Where-Object{$_ -match '^\s*[^#].*='}|ForEach-Object{ $k,$v=$_ -split '=',2; $cfg[$k.Trim()]=$v.Trim() }
$KEY=$cfg['OMIE_APP_KEY']; $SEC=$cfg['OMIE_APP_SECRET']; $CC=6061078717
$url='https://app.omie.com.br/api/v1/financas/contacorrentelancamentos/'
$log=Join-Path $d 'import_2020_result.csv'
$done=@{}
if(Test-Path $log){ Import-Csv $log -Delimiter ';' -Encoding UTF8 | Where-Object{$_.status -eq 'OK'} | ForEach-Object{ $done[$_.integ]=$true } }
else{ 'integ;status;detalhe' | Out-File $log -Encoding utf8 }
$rows=@(); $rows += Import-Csv (Join-Path $d 'import_2020_cr.csv') -Delimiter ';' -Encoding UTF8; $rows += Import-Csv (Join-Path $d 'import_2020_cp.csv') -Delimiter ';' -Encoding UTF8
$fila = $rows | Where-Object{ -not $done.ContainsKey($_.integ) }
Write-Host ("A processar: $($fila.Count) de $($rows.Count) (ja feitos: $($done.Count))")
$ok=0; $i=0; $okAtLastCooldown=-1; $deadCycles=0
function Cooldown(){
  Write-Host "MISUSE - cooldown de ~32min com heartbeat..."
  for($s=0;$s -lt 38;$s++){ Start-Sleep -Seconds 50; Write-Host ("  ...cooldown $((($s+1)*50))s") }
}
while($i -lt $fila.Count){
  $r=$fila[$i]
  $body=@{ call='IncluirLancCC'; app_key=$KEY; app_secret=$SEC; param=@([ordered]@{
    cCodIntLanc=$r.integ
    cabecalho=@{ nCodCC=$CC; dDtLanc=$r.data; nValorLanc=[double]::Parse($r.valor,$inv) }
    detalhes=[ordered]@{ cCodCateg=$r.categoria; cTipo='DIN'; nCodCliente=[int64]$r.cod; cObs=$r.obs }
  }) } | ConvertTo-Json -Depth 8
  try{
    $resp=Invoke-RestMethod -Method Post -Uri $url -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'
    if($resp.nCodLanc){ $ok++; "{0};OK;{1}" -f $r.integ,$resp.nCodLanc | Out-File $log -Append -Encoding utf8; if($ok % 25 -eq 0){ Write-Host "  ok=$ok" } }
    else{ "{0};ERRO;{1}" -f $r.integ,($resp.faultstring -replace '[\r\n;]',' ') | Out-File $log -Append -Encoding utf8 }
    $i++
  }catch{
    $msg=$_.Exception.Message; if($_.ErrorDetails.Message){$msg=$_.ErrorDetails.Message}
    if($msg -match 'suspenso|bloqueada|MISUSE|consumo indevido'){
      if($ok -eq $okAtLastCooldown){ $deadCycles++ } else { $deadCycles=0 }
      $okAtLastCooldown=$ok
      if($deadCycles -ge 2){ Write-Host "2 cooldowns sem progresso - abortando."; break }
      Cooldown
      continue  # re-tenta o mesmo item
    } else { "{0};FALHA;{1}" -f $r.integ,($msg -replace '[\r\n;]',' ') | Out-File $log -Append -Encoding utf8; $i++ }
  }
  Start-Sleep -Milliseconds 2000
}
Write-Host ("FIM 2020: ok nesta run=$ok | total OK no log=$((Import-Csv $log -Delimiter ';' -Encoding UTF8 | Where-Object{$_.status -eq 'OK'}).Count)")
