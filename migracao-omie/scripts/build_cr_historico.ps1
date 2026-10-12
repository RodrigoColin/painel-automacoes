# Monta o lote de importacao do CR historico (emissao < 10/03/2026, venc 2021+).
# Exclui estornos e resgates (vao p/ arquivo de revisao). Mapeia categoria (de-para) e cliente (uuid->cnpj->CA-<cnpj>, senao Diversos).
$ErrorActionPreference='Stop'
$dir=Split-Path -Parent $MyInvocation.MyCommand.Path
$d=Join-Path $dir 'dados'

function Norm($s){ if(-not $s){return ''}; $n=$s.Normalize([Text.NormalizationForm]::FormD); $sb=New-Object Text.StringBuilder
  foreach($c in $n.ToCharArray()){ if([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark){[void]$sb.Append($c)} }
  return ($sb.ToString().Normalize([Text.NormalizationForm]::FormC).ToUpper().Trim()) }

# de-para categoria (nome CA normalizado -> codigo Omie)
$dp=Import-Csv (Join-Path $dir 'de_para_categorias_ATUALIZADO.csv') -Delimiter ';' -Encoding UTF8
$catMap=@{}
foreach($r in $dp){ if($r.Omie_Codigo -match '^1\.' -and $r.CA_Categoria){ $k=Norm $r.CA_Categoria; if(-not $catMap.ContainsKey($k)){ $catMap[$k]=$r.Omie_Codigo } } }
# fallbacks diretos
$catMap[(Norm 'Receitas de Vendas')]='1.01.01'
$catMap[(Norm 'Receitas de Servicos')]='1.01.02'
$catMap[(Norm 'Receitas de Serviços')]='1.01.02'

# mapa uuid CA -> cnpj
$uuid2cnpj=@{}
foreach($f in 'clientes.json','fornecedores.json','transportadoras.json'){
  $arr=Get-Content "$d\$f" -Raw -Encoding UTF8|ConvertFrom-Json
  foreach($p in $arr){ if($p.id){ $uuid2cnpj[$p.id]=($p.documento -replace '\D','') } }
}
# mapa cnpj -> codigo cliente Omie (resolve direto no build)
$DIV=6061078694
$cnpj2code=@{}
$cli=Get-Content "$d\omie_clientes_full.json" -Raw -Encoding UTF8|ConvertFrom-Json
foreach($c in $cli){ $cj=($c.cnpj -replace '\D',''); if($cj.Length -ge 11 -and -not $cnpj2code.ContainsKey($cj)){ $cnpj2code[$cj]=$c.codigo_cliente_omie } }

$cr=Get-Content "$d\contas_a_receber.json" -Raw -Encoding UTF8|ConvertFrom-Json
$arr = if($cr -is [array]){ $cr } else { $cr.data }
$cut=[datetime]'2026-03-10'
function Emis($t){ if($t.data_competencia){try{return [datetime]($t.data_competencia)}catch{return $null}}; return $null }
function BR($iso){ $p=$iso -split '-'; return ('{0}/{1}/{2}' -f $p[2],$p[1],$p[0]) }

$imp=@(); $rev=@(); $semCat=@{}
foreach($t in $arr){
  $e=Emis $t; if(-not $e -or $e -ge $cut){continue}
  if([double]$t.total -le 0.01){continue}
  if([string]$t.data_vencimento -lt '2021'){continue}   # 2020 bloqueado
  $catNome=''; if($t.categorias -and $t.categorias.Count -gt 0){$catNome=$t.categorias[0].nome}
  $isEstorno = ($catNome -match '(?i)estorno') -or ($t.descricao -match '(?i)estorno')
  $isResgate = ($t.descricao -match '(?i)resgate')
  if($isEstorno -or $isResgate){ $rev+=[pscustomobject]@{id=$t.id;tipo=$(if($isEstorno){'ESTORNO'}else{'RESGATE'});desc=$t.descricao;valor=$t.total;venc=$t.data_vencimento;cliente=$t.cliente.nome}; continue }
  $cat=$catMap[(Norm $catNome)]
  if(-not $cat){ $cat='1.01.01'; $semCat[$catNome]=1 }   # default receita de venda
  # cliente -> resolve p/ codigo numerico Omie por CNPJ; senao Diversos
  $cnpj=if($t.cliente.id){$uuid2cnpj[$t.cliente.id]}else{''}
  $cliCode=$DIV
  if($cnpj -and $cnpj.Length -ge 11 -and $cnpj2code.ContainsKey($cnpj)){ $cliCode=$cnpj2code[$cnpj] }
  $venc=BR $t.data_vencimento
  $imp+=[pscustomobject]@{
    integ=('CR-'+$t.id)
    cli_code=$cliCode
    categoria=$cat
    data_venc=$venc
    data_emissao=$venc
    valor=([double]$t.total).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    baixar=$(if($t.status -eq 'ACQUITTED'){'S'}else{'N'})
    obs=($t.descricao -replace '[\r\n;]',' ')
  }
}
$imp | Export-Csv (Join-Path $d 'import_cr_lote_2021.csv') -Delimiter ';' -Encoding UTF8 -NoTypeInformation
$rev | Export-Csv (Join-Path $d 'cr_estornos_resgates_revisar.csv') -Delimiter ';' -Encoding UTF8 -NoTypeInformation

"IMPORT historico 2021+: $($imp.Count) titulos"
"  a baixar (S): $(($imp|Where-Object{$_.baixar -eq 'S'}).Count) | em aberto (N): $(($imp|Where-Object{$_.baixar -eq 'N'}).Count)"
"  vinculados a cliente: $(($imp|Where-Object{[string]$_.cli_code -ne [string]$DIV}).Count) | Diversos: $(($imp|Where-Object{[string]$_.cli_code -eq [string]$DIV}).Count)"
$valTot=($imp|ForEach-Object{[double]::Parse($_.valor,[Globalization.CultureInfo]::InvariantCulture)}|Measure-Object -Sum).Sum
"  valor total: R$ {0:N2}" -f $valTot
"REVISAR (estornos+resgates, fora do import): $($rev.Count)"
$rev|Group-Object tipo|ForEach-Object{ "  $($_.Name): $($_.Count) | R$ " + ('{0:N2}' -f (($_.Group|ForEach-Object{[double]$_.valor}|Measure-Object -Sum).Sum)) }
if($semCat.Count){ "categorias CA sem de-para (usaram default 1.01.01): " + (($semCat.Keys) -join ' | ') }
"distribuicao por categoria Omie:"
$imp|Group-Object categoria|Sort-Object Count -Descending|ForEach-Object{ "  $($_.Name): $($_.Count)" }
