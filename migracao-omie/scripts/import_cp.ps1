param([int]$From=1,[int]$To=0)
# Importa Contas a Pagar (2021+) no Omie via UpsertContaPagarPorLote (lotes de 50). Idempotente pela chave CP-<id>.
$ErrorActionPreference='Stop'
$inv=[System.Globalization.CultureInfo]::InvariantCulture
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg=@{}; Get-Content (Join-Path $dir '.env.local') | Where-Object {$_ -match '^\s*[^#].*='} | ForEach-Object { $k,$v=$_ -split '=',2; $cfg[$k.Trim()]=$v.Trim() }
$KEY=$cfg['OMIE_APP_KEY']; $SEC=$cfg['OMIE_APP_SECRET']
$CC=6061078717   # Itau - Historico
$url='https://app.omie.com.br/api/v1/financas/contapagar/'
$rows = Import-Csv (Join-Path $dir 'dados\import_cp_lote_2021.csv') -Delimiter ';' -Encoding UTF8
$chunks=[math]::Ceiling($rows.Count/50); if($To -le 0){$To=$chunks}
$log = Join-Path $dir ('dados\import_cp_result.csv')
if(-not (Test-Path $log)){ 'lote;ok;erros;detalhe' | Out-File $log -Encoding utf8 }
Write-Host ("Rodando lotes $From..$To de $chunks  (total $($rows.Count) titulos)")

for($ci=$From; $ci -le $To; $ci++){
  $batch = $rows[(($ci-1)*50)..([math]::Min($ci*50-1,$rows.Count-1))]
  $items = foreach($r in $batch){
    $o=[ordered]@{
      codigo_lancamento_integracao=$r.integ
      codigo_cliente_fornecedor=[int64]$r.forn_code
      data_vencimento=$r.data_venc; data_previsao=$r.data_venc; data_emissao=$r.data_emissao
      valor_documento=[double]::Parse($r.valor,$inv)
      codigo_categoria=$r.categoria
      id_conta_corrente=$CC
      observacao=$r.obs
    }
    if($r.baixar -eq 'S'){ $o.baixar_documento='S'; $o.pagamento=[ordered]@{codigo_conta_corrente=$CC;valor=[double]::Parse($r.valor,$inv);data=$r.data_venc} }
    $o
  }
  $body=@{ call='UpsertContaPagarPorLote'; app_key=$KEY; app_secret=$SEC; param=@(@{ lote=$ci; conta_pagar_cadastro=@($items) }) }
  $json=$body | ConvertTo-Json -Depth 10
  try{
    $resp = Invoke-RestMethod -Method Post -Uri $url -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json'
    if($resp.codigo_status -eq '0'){
      "{0};{1};0;OK" -f $ci,$batch.Count | Out-File $log -Append -Encoding utf8
      Write-Host ("  lote {0,3}: OK ({1} titulos)" -f $ci,$batch.Count)
    } else {
      "{0};0;{1};{2}" -f $ci,$batch.Count,($resp.descricao_status -replace '[\r\n;]',' ') | Out-File $log -Append -Encoding utf8
      Write-Host ("  lote {0,3}: ERRO -> {1}" -f $ci,$resp.descricao_status)
    }
  }catch{
    $msg=$_.Exception.Message; if($_.ErrorDetails.Message){$msg=$_.ErrorDetails.Message}
    "{0};0;{1};FALHA:{2}" -f $ci,$batch.Count,($msg -replace '[\r\n;]',' ') | Out-File $log -Append -Encoding utf8
    Write-Host ("  lote {0,3}: FALHA -> {1}" -f $ci,$msg)
  }
  Start-Sleep -Milliseconds 400
}
Write-Host 'Concluido.'