# PROTOTYPE. The timing run: one evaluation process at a time on one logical CPU (affinity 0x10, CPU 4;
# its hyperthread sibling CPU 5 is left alone), over 12 of the real test ads (every fourth by name),
# Light and Medium, against Dazbee's 321 families and the whole library, three times each. Before and
# after each run it records every process's CPU seconds, so what else was busy is known.
#   pwsh train/timing.ps1 .data/models/lib-w32-p48
$model = $args[0]
$dir = Split-Path $PSScriptRoot -Parent
Set-Location $dir
$ads = 'beauty_olea,fashion_maison,fresh_coffee_brio,fresh_kids_brightminds,fresh_wine_vinea,home_nook,juice_squeeze,morrowmere,qsr_burgerhaus,sneaker_volt,tech_soniq,velofern'
$log = Join-Path $dir '.data/results/timing-busy.txt'
"" | Out-File $log
foreach ($mode in @('sub', 'lib')) {
  foreach ($rep in 1..3) {
    $name = "timing-$mode-$rep"
    $before = @{}; Get-Process | ForEach-Object { $before[$_.Id] = $_.CPU }
    $t0 = Get-Date
    $subset = if ($mode -eq 'sub') { '--subset' } else { '' }
    cmd /c "start /affinity 10 /wait /b node src/evaluate.ts --set testads --ads $ads $subset --model $model --out $name > .data/results/$name.log 2>&1"
    $seconds = ((Get-Date) - $t0).TotalSeconds
    $busy = Get-Process | Where-Object { $_.CPU -ne $null } | ForEach-Object {
      [pscustomobject]@{ Name = $_.ProcessName; Id = $_.Id; Cpu = $_.CPU - ($before[$_.Id] ?? 0) }
    } | Sort-Object Cpu -Descending | Select-Object -First 8
    "== $name, $([int]$seconds) s wall; other processes' CPU seconds during it:" | Out-File $log -Append
    $busy | ForEach-Object { "  {0,-24} {1,7} {2,8:N0}" -f $_.Name, $_.Id, $_.Cpu } | Out-File $log -Append
  }
}
