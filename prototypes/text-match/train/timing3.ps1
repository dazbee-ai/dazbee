# PROTOTYPE. Round 3's timing run: one evaluation process at a time on one logical CPU (affinity 0x10),
# over the same 12 test ads as round 2's timing, Medium against the whole library, three times. Before
# and after each run it records every process's CPU seconds, so what else was busy is known. Extra
# arguments go to evaluate.ts (an --onnx and --fp for the int8 copy).
#   pwsh train/timing3.ps1 <model folder> <tag> [evaluate.ts arguments]
$model = $args[0]
$tag = $args[1]
$extra = ($args | Select-Object -Skip 2) -join ' '
$dir = Split-Path $PSScriptRoot -Parent
Set-Location $dir
$ads = 'beauty_olea,fashion_maison,fresh_coffee_brio,fresh_kids_brightminds,fresh_wine_vinea,home_nook,juice_squeeze,morrowmere,qsr_burgerhaus,sneaker_volt,tech_soniq,velofern'
$log = Join-Path $dir ".data/results/timing3-$tag-busy.txt"
"" | Out-File $log
foreach ($rep in 1..3) {
  $name = "timing3-$tag-$rep"
  $before = @{}; Get-Process | ForEach-Object { $before[$_.Id] = $_.CPU }
  $t0 = Get-Date
  cmd /c "start /affinity 10 /wait /b node src/evaluate.ts --set testads --ads $ads --versions medium --model $model $extra --out $name > .data/results/$name.log 2>&1"
  $seconds = ((Get-Date) - $t0).TotalSeconds
  $busy = Get-Process | Where-Object { $_.CPU -ne $null } | ForEach-Object {
    [pscustomobject]@{ Name = $_.ProcessName; Id = $_.Id; Cpu = $_.CPU - ($before[$_.Id] ?? 0) }
  } | Sort-Object Cpu -Descending | Select-Object -First 8
  "== $name, $([int]$seconds) s wall; other processes' CPU seconds during it:" | Out-File $log -Append
  $busy | ForEach-Object { "  {0,-24} {1,7} {2,8:N0}" -f $_.Name, $_.Id, $_.Cpu } | Out-File $log -Append
}
