# Baixa dos 84 titulos de NF (overlap 2026) via LancarRecebimento, na Itau-Historico.
# Resumivel (pula OK no log). Ritmo 12s. Em suspensao: espera 60s e RE-TENTA o mesmo titulo.
$ErrorActionPreference='Stop'
$br=[System.Globalization.CultureInfo]::GetCultureInfo('pt-BR')
$dir=Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg=@{}; Get-Content (Join-Path $dir '.env.local')|Where-Object{$_ -match '^\s*[^#].*='}|ForEach-Object{ $k,$v=$_ -split '=',2; $cfg[$k.Trim()]=$v.Trim() }
$KEY=$cfg['OMIE_APP_KEY']; $SEC=$cfg['OMIE_APP_SECRET']; $CC=6061078717
$url='https://app.omie.com.br/api/v1/financas/contareceber/'
$pares=Import-Csv (Join-Path $dir 'dados\cr_overlap_baixa.csv') -Delimiter ';' -Encoding UTF8
$log=Join-Path $dir 'dados\cr_overlap_baixa_result.csv'
# codigos ja resolvidos (OK/SKIP) do log anterior + #1 e #2 (feitos manualmente)
$done=@{}; $done['5986449489']=$true; $done['5987170349']=$true
if(Test-Path $log){ Import-Csv $log -Delimiter ';' -Encoding UTF8 | Where-Object{$_.status -eq 'OK' -or $_.status -eq 'SKIP'} | ForEach-Object{ $done[$_.omie_code]=$true } }
'omie_code;status;detalhe' | Out-File $log -Encoding utf8
$done.Keys | ForEach-Object{ "{0};OK;pre-done" -f $_ | Out-File $log -Append -Encoding utf8 }
$ok=$done.Count; $err=0

$fila = $pares | Where-Object{ -not $done.ContainsKey($_.omie_code) }
Write-Host ("A processar: $($fila.Count) titulos")
$i=0
while($i -lt $fila.Count){
  $p=$fila[$i]
  $val=[double]::Parse($p.valor,$br)
  $key=('RB-'+($p.ca_id -replace '-','').Substring(0,16))
  $body=@{ call='LancarRecebimento'; app_key=$KEY; app_secret=$SEC; param=@(@{
    codigo_lancamento=[int64]$p.omie_code; codigo_baixa_integracao=$key
    codigo_conta_corrente=$CC; valor=$val; data=$p.rec_date
    observacao=('Baixa historica conciliada CA (NF '+$p.nf+')'); conciliar_documento='N'
  }) } | ConvertTo-Json -Depth 6
  try{
    $resp=Invoke-RestMethod -Method Post -Uri $url -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'
    if($resp.liquidado -eq 'S' -or $resp.codigo_status -eq '0'){ $ok++; "{0};OK;{1}" -f $p.omie_code,$resp.codigo_baixa | Out-File $log -Append -Encoding utf8; Write-Host ("  [{0}/{1}] {2} OK" -f ($i+1),$fila.Count,$p.omie_code) }
    else{ $err++; "{0};ERRO;{1}" -f $p.omie_code,($resp.descricao_status -replace '[\r\n;]',' ') | Out-File $log -Append -Encoding utf8; Write-Host ("  [{0}/{1}] {2} ERRO {3}" -f ($i+1),$fila.Count,$p.omie_code,$resp.descricao_status) }
    $i++
  }catch{
    $msg=$_.Exception.Message; if($_.ErrorDetails.Message){$msg=$_.ErrorDetails.Message}
    if($msg -match 'menor ou igual ao total|já (foi )?(baixad|recebid)'){ "{0};SKIP;sem saldo/ja recebido" -f $p.omie_code | Out-File $log -Append -Encoding utf8; Write-Host ("  [{0}/{1}] {2} SKIP" -f ($i+1),$fila.Count,$p.omie_code); $i++ }
    elseif($msg -match 'suspenso|bloqueada|MISUSE|consumo indevido'){ Write-Host ("  [{0}/{1}] {2} BLOQUEIO detectado - parando run (retoma depois). msg: {3}" -f ($i+1),$fila.Count,$p.omie_code,$msg); break }
    else{ $err++; "{0};FALHA;{1}" -f $p.omie_code,($msg -replace '[\r\n;]',' ') | Out-File $log -Append -Encoding utf8; Write-Host ("  [{0}/{1}] {2} FALHA {3}" -f ($i+1),$fila.Count,$p.omie_code,$msg); $i++ }
  }
  Start-Sleep -Seconds 12
}
Write-Host ("FIM baixa overlap: OK=$ok | ERRO/FALHA=$err")
