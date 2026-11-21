# The final measurements. Each command runs alone (from this folder), pinned to one core (core 11,
# above-normal priority, so other work on the machine does not share it), with garbage collected
# between blocks, under the rule named (v1 the shared rule, v2 the proposed one).
$dir = $PSScriptRoot
$runs = @(
  @{ rule = 'v1'; synth = ''; name = 'f-deltax-light-v1'; args = '--expose-gc src/run-deltax.ts light' },
  @{ rule = 'v2'; synth = ''; name = 'f-deltax-light-v2'; args = '--expose-gc src/run-deltax.ts light' },
  @{ rule = 'v1'; synth = ''; name = 'f-deltax-medium-v1'; args = '--expose-gc src/run-deltax.ts medium' },
  @{ rule = 'v2'; synth = ''; name = 'f-deltax-medium-v2'; args = '--expose-gc src/run-deltax.ts medium' },
  @{ rule = 'v1'; synth = ''; name = 'f-synth-light-v1'; args = '--expose-gc src/run-synth.ts light test' },
  @{ rule = 'v2'; synth = ''; name = 'f-synth-light-v2'; args = '--expose-gc src/run-synth.ts light test' },
  @{ rule = 'v1'; synth = ''; name = 'f-synth-medium-v1'; args = '--expose-gc src/run-synth.ts medium test' },
  @{ rule = 'v2'; synth = ''; name = 'f-synth-medium-v2'; args = '--expose-gc src/run-synth.ts medium test' },
  @{ rule = 'v1'; synth = 'data/synth2'; name = 'f-synth2-light-v1'; args = '--expose-gc src/run-synth.ts light all' },
  @{ rule = 'v2'; synth = 'data/synth2'; name = 'f-synth2-light-v2'; args = '--expose-gc src/run-synth.ts light all' },
  @{ rule = 'v1'; synth = 'data/synth2'; name = 'f-synth2-medium-v1'; args = '--expose-gc src/run-synth.ts medium all' },
  @{ rule = 'v2'; synth = 'data/synth2'; name = 'f-synth2-medium-v2'; args = '--expose-gc src/run-synth.ts medium all' }
)
foreach ($r in $runs) {
  $env:RULE = $r.rule
  if ($r.synth) { $env:SYNTH_DIR = $r.synth } else { Remove-Item Env:SYNTH_DIR -ErrorAction SilentlyContinue }
  $t0 = Get-Date
  $p = Start-Process -FilePath 'node' -ArgumentList $r.args -WorkingDirectory $dir -RedirectStandardOutput "$dir\out\timed-$($r.name).log" -RedirectStandardError "$dir\out\timed-$($r.name).err" -PassThru -NoNewWindow
  $p.ProcessorAffinity = 0x800
  $p.PriorityClass = 'AboveNormal'
  $peak = 0
  while (-not $p.HasExited) { try { $p.Refresh(); if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 } } catch {}; Start-Sleep -Milliseconds 300 }
  "$($r.name) seconds=$(((Get-Date) - $t0).TotalSeconds) peak_working_set_mb=$([math]::Round($peak / 1MB)) exit=$($p.ExitCode)" | Out-File -Append "$dir\out\timed-summary.txt"
}
