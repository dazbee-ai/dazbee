# Runs each measuring command (from this folder) alone, pinned to one core (affinity mask 2), one after another.
$dir = $PSScriptRoot
$runs = @(
  @('startup', 'src/startup.ts'),
  @('startup2', 'src/startup.ts'),
  @('deltax-light', 'src/run-deltax.ts light'),
  @('deltax-medium', 'src/run-deltax.ts medium'),
  @('synth-light-test', 'src/run-synth.ts light test'),
  @('synth-medium-test', 'src/run-synth.ts medium test')
)
foreach ($r in $runs) {
  $t0 = Get-Date
  $p = Start-Process -FilePath 'node' -ArgumentList $r[1] -WorkingDirectory $dir -RedirectStandardOutput "$dir\out\timed-$($r[0]).log" -RedirectStandardError "$dir\out\timed-$($r[0]).err" -PassThru -NoNewWindow
  $p.ProcessorAffinity = 2
  $peak = 0
  while (-not $p.HasExited) { try { $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 } } catch {}; Start-Sleep -Milliseconds 300 }
  "$($r[0]) seconds=$(((Get-Date) - $t0).TotalSeconds) peak_working_set_mb=$([math]::Round($peak / 1MB)) exit=$($p.ExitCode)" | Out-File -Append "$dir\out\timed-summary.txt"
}
