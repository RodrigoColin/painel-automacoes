# Importa 2020 como TITULO (CP e CR) via Upsert...PorLote. WORKAROUND: venc=01/01/2021, emissao+baixa na data real 2020.
# Resumivel por lote. Em MISUSE: cooldown com heartbeat e retoma o mesmo lote; aborta apos 3 cooldowns sem progresso.
$ErrorActionPreference='Stop'
$inv=[Globalization.CultureInfo]::InvariantCulture
$dir=Split-Path -Parent $MyInvocation.MyCommand.Path; $d=Join-Path $dir 'dados'
$cfg=@{}; Get-Content (Join-Path $dir '.env.local')|Where-Object{$_ -match '^\s*[^#].*='}|ForEach-Object{ $k,$v=$_ -split '=',2; $cfg[$k.Trim()]=$v.Trim() }
$KEY=$cfg['OMIE_APP_KEY']; $SEC=$cfg['OMIE_APP_SECRET']; $CC=6061078717
$log=Join-Path $d 'import_2020_titulos_result.csv'
if(-not(Test-Path $log)){ 'tipo;lote;ok;detalhe' | Out-File $log -Encoding utf8 }
$doneLotes=@{}
Import-Csv $log -Delimiter ';' -Encoding UTF8 | Where-Object{$_.detalhe -eq 'OK'} | ForEach-Object{ $doneLotes["$($_.tipo)-$($_.lote)"]=$true }
$script:deadCd=0
function Cooldown(){ Write-Host "  MISUSE - cooldown ~7min (heartbeat)..."; for($s=0;$s -lt 9;$s++){ Start-Sleep -Seconds 50; Write-Host ("    ...$((($s+1)*50))s") } }

function ImportaTipo($tipo,$csv,$url,$call,$arrTag,$baixaTag){
  $rows=Import-Csv $csv -Delimiter ';' -Encoding UTF8
  $chunks=[math]::Ceiling($rows.Count/50)
  Write-Host ("$tipo : $($rows.Count) titulos em $chunks lotes")
  for($ci=1;$ci -le $chunks;$ci++){
    if($doneLotes["$tipo-$ci"]){ continue }
    $batch=$rows[(($ci-1)*50)..([math]::Min($ci*50-1,$rows.Count-1))]
    $items=foreach($r in $batch){
      $v=[double]::Parse($r.valor,$inv)
      $o=[ordered]@{
        codigo_lancamento_integracao=$r.integ; codigo_cliente_fornecedor=[int64]$r.cod
        data_vencimento='01/01/2021'; data_previsao='01/01/2021'; data_emissao=$r.data
        valor_documento=$v; codigo_categoria=$r.categoria; id_conta_corrente=$CC
        observacao=($r.obs+' (venc orig '+$r.data+')'); baixar_documento='S'
      }
      $o[$baixaTag]=[ordered]@{codigo_conta_corrente=$CC;valor=$v;data=$r.data}
      $o
    }
    $param=@{ lote=(2000+$ci) }; $param[$arrTag]=@($items)
    $body=@{ call=$call; app_key=$KEY; app_secret=$SEC; param=@($param) } | ConvertTo-Json -Depth 10
    $retry=$true
    while($retry){
      $retry=$false
      try{
        $resp=Invoke-RestMethod -Method Post -Uri $url -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'
        if($resp.codigo_status -eq '0'){ "$tipo;$ci;$($batch.Count);OK" | Out-File $log -Append -Encoding utf8; Write-Host ("  $tipo lote $ci/$chunks OK ($($batch.Count))"); $script:deadCd=0 }
        else{ "$tipo;$ci;0;$($resp.descricao_status -replace '[\r\n;]',' ')" | Out-File $log -Append -Encoding utf8; Write-Host ("  $tipo lote $ci ERRO: $($resp.descricao_status)") }
      }catch{
        $m=$_.Exception.Message; if($_.ErrorDetails.Message){$m=$_.ErrorDetails.Message}
        if($m -match 'MISUSE|consumo indevido|suspenso|bloqueada'){
          $script:deadCd++; if($script:deadCd -ge 3){ Write-Host "3 cooldowns sem progresso - abortando."; return }
          Cooldown; $retry=$true
        } else { "$tipo;$ci;0;FALHA:$($m -replace '[\r\n;]',' ')" | Out-File $log -Append -Encoding utf8; Write-Host ("  $tipo lote $ci FALHA: $m") }
      }
    }
    Start-Sleep -Milliseconds 800
  }
}
ImportaTipo 'CR' (Join-Path $d 'import_2020_cr.csv') 'https://app.omie.com.br/api/v1/financas/contareceber/' 'UpsertContaReceberPorLote' 'conta_receber_cadastro' 'recebimento'
ImportaTipo 'CP' (Join-Path $d 'import_2020_cp.csv') 'https://app.omie.com.br/api/v1/financas/contapagar/' 'UpsertContaPagarPorLote' 'conta_pagar_cadastro' 'pagamento'
Write-Host 'Concluido 2020.'
