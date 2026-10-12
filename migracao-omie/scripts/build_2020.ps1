# Monta bases 2020 (CP e CR) p/ lançar via LancCC (titulo-a-titulo) na Itau-Historico.
# CP venc 2020 (exclui aplicacao/saque); CR venc 2020 (exclui resgate). Resolve categoria Omie + cod cliente/fornecedor.
$ErrorActionPreference='Stop'
$dir=Split-Path -Parent $MyInvocation.MyCommand.Path
$d=Join-Path $dir 'dados'
$inv=[Globalization.CultureInfo]::InvariantCulture
function Norm($s){ if(-not $s){return ''}; $n=$s.Normalize([Text.NormalizationForm]::FormD); $sb=New-Object Text.StringBuilder
  foreach($c in $n.ToCharArray()){ if([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark){[void]$sb.Append($c)} }
  ($sb.ToString().Normalize([Text.NormalizationForm]::FormC)).ToUpper().Trim() }
function BR($iso){ $p=$iso.Substring(0,10) -split '-'; '{0}/{1}/{2}' -f $p[2],$p[1],$p[0] }

# de-para: catMap despesa (^2.) e receita (^1.)
$dp=Import-Csv (Join-Path $dir 'de_para_categorias_ATUALIZADO.csv') -Delimiter ';' -Encoding UTF8
$catDesp=@{}; $catRec=@{}
foreach($r in $dp){ if(-not $r.CA_Categoria){continue}; $k=Norm $r.CA_Categoria
  if($r.Omie_Codigo -match '^2\.' -and -not $catDesp.ContainsKey($k)){ $catDesp[$k]=$r.Omie_Codigo }
  if($r.Omie_Codigo -match '^1\.' -and -not $catRec.ContainsKey($k)){ $catRec[$k]=$r.Omie_Codigo } }
$catRec[(Norm 'Receitas de Vendas')]='1.01.01'; $catRec[(Norm 'Receitas de Servicos')]='1.01.02'; $catRec[(Norm 'Receitas de Serviços')]='1.01.02'

# mapas de pessoas
$DIV=6061078694
$cli=Get-Content "$d\omie_clientes_full.json" -Raw -Encoding UTF8|ConvertFrom-Json
$cnpj2code=@{}; $integ2code=@{}
foreach($c in $cli){ $cj=($c.cnpj -replace '\D',''); if($cj.Length -ge 11 -and -not $cnpj2code.ContainsKey($cj)){$cnpj2code[$cj]=$c.codigo_cliente_omie}
  if($c.codigo_cliente_integracao){ $integ2code[$c.codigo_cliente_integracao]=$c.codigo_cliente_omie } }
$uuid2cnpj=@{}
foreach($f in 'clientes.json','fornecedores.json','transportadoras.json'){ $a=Get-Content "$d\$f" -Raw -Encoding UTF8|ConvertFrom-Json; foreach($p in $a){ if($p.id){$uuid2cnpj[$p.id]=($p.documento -replace '\D','')} } }

# ---- CP 2020 ----
$enr=@{}; Import-Csv "$d\cp_enriquecido.csv" -Delimiter ';' -Encoding UTF8 | ForEach-Object{ $enr[$_.id]=$_ }
$cpj=Get-Content "$d\contas_a_pagar.json" -Raw -Encoding UTF8|ConvertFrom-Json; $cpa=if($cpj -is [array]){$cpj}else{$cpj.data}
$cpOut=@(); $cpSemCat=@{}; $seqP=0
foreach($t in $cpa){ if($t.data_vencimento -notlike '2020*'){continue}; if([double]$t.total -le 0.01){continue}
  if($t.descricao -match '(?i)aplica|saque|invest|trust'){continue}
  $e=$enr[$t.id]; $catNome=if($e){$e.categoria}else{$t.categorias[0].nome}
  $cod=$catDesp[(Norm $catNome)]
  if(-not $cod){ $nn=Norm $catNome
    if($nn -match '13.*SAL'){ $cod='2.03.05' }
    elseif($nn -match 'APLICA'){ continue }
    else{ $cod='2.08.02'; $cpSemCat[$catNome]=1 } }
  # fornecedor
  $fc=$DIV; $fcnpj=if($e){$e.forn_cnpj}else{''}
  if($fcnpj){ if($fcnpj -like 'DESC-*'){ if($integ2code.ContainsKey($fcnpj)){$fc=$integ2code[$fcnpj]} } elseif(($fcnpj -replace '\D','').Length -ge 11){ $cj=($fcnpj -replace '\D',''); if($cnpj2code.ContainsKey($cj)){$fc=$cnpj2code[$cj]} } }
  $seqP++
  $cpOut+=[pscustomobject]@{ integ=('L20P'+$seqP.ToString('D4')); data=(BR $t.data_vencimento); valor=([double]$t.total).ToString($inv); categoria=$cod; cod=$fc; natureza='D'; obs=(($t.descricao -replace '[\r\n;]',' ')) }
}
$cpOut | Export-Csv "$d\import_2020_cp.csv" -Delimiter ';' -Encoding UTF8 -NoTypeInformation

# ---- CR 2020 ----
$crj=Get-Content "$d\contas_a_receber.json" -Raw -Encoding UTF8|ConvertFrom-Json; $cra=if($crj -is [array]){$crj}else{$crj.data}
$crOut=@(); $crSemCat=@{}; $seqR=0
foreach($t in $cra){ if($t.data_vencimento -notlike '2020*'){continue}; if([double]$t.total -le 0.01){continue}
  if($t.descricao -match '(?i)resgate'){continue}
  $catNome=if($t.categorias -and $t.categorias.Count){$t.categorias[0].nome}else{''}
  $cod=$catRec[(Norm $catNome)]
  if(-not $cod){ $nn=Norm $catNome
    if($nn -match 'ESTORNO'){ $cod='1.02.97' }
    else{ $cod='1.01.01'; $crSemCat[$catNome]=1 } }
  $cc=$DIV; $cnpj=if($t.cliente.id){$uuid2cnpj[$t.cliente.id]}else{''}
  if($cnpj -and $cnpj.Length -ge 11 -and $cnpj2code.ContainsKey($cnpj)){ $cc=$cnpj2code[$cnpj] }
  $seqR++
  $crOut+=[pscustomobject]@{ integ=('L20R'+$seqR.ToString('D4')); data=(BR $t.data_vencimento); valor=([double]$t.total).ToString($inv); categoria=$cod; cod=$cc; natureza='R'; obs=(($t.descricao -replace '[\r\n;]',' ')) }
}
$crOut | Export-Csv "$d\import_2020_cr.csv" -Delimiter ';' -Encoding UTF8 -NoTypeInformation

"CP 2020: $($cpOut.Count) | R$ {0:N2}" -f (($cpOut|%{[double]::Parse($_.valor,$inv)}|Measure-Object -Sum).Sum)
"CR 2020: $($crOut.Count) | R$ {0:N2}" -f (($crOut|%{[double]::Parse($_.valor,$inv)}|Measure-Object -Sum).Sum)
if($cpSemCat.Count){ "CP cat sem de-para (->2.08.02): $($cpSemCat.Count) distintas: " + (($cpSemCat.Keys|Select-Object -First 15) -join ' | ') }
if($crSemCat.Count){ "CR cat sem de-para (->1.01.01): " + (($crSemCat.Keys) -join ' | ') }
"CP -> Diversos: $(($cpOut|Where-Object{$_.cod -eq $DIV}).Count) | CR -> Diversos: $(($crOut|Where-Object{$_.cod -eq $DIV}).Count)"
