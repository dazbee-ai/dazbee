# PROTOTYPE. run-parts.sh for Windows without a POSIX shell (envy): one set's part matched in N shards
# side by side, merged into .data/results/<tag>.json. Extra arguments go to evaluate.ts.
#   pwsh train/run-parts.ps1 <set> <part> <model folder> <tag> <shards> [evaluate.ts arguments]
$set, $part, $model, $tag, $n = $args[0..4]
$extra = @($args | Select-Object -Skip 5)
Set-Location (Split-Path $PSScriptRoot -Parent)
$procs = foreach ($i in 0..([int]$n - 1)) {
  $a = @('src/evaluate.ts', '--set', $set, '--part', $part, '--model', $model, '--shard', "$i/$n", '--out', "$tag-$i") + $extra
  Start-Process node -ArgumentList $a -NoNewWindow -PassThru -RedirectStandardOutput ".data/results/$tag-$i.log" -RedirectStandardError ".data/results/$tag-$i.err"
}
# A shard is done when its log has its closing line; a process that then hangs on exit (seen on envy
# with many shards at once) is stopped.
while ($true) {
  $done = @(0..([int]$n - 1) | Where-Object { (Test-Path ".data/results/$tag-$_.log") -and (Select-String -Path ".data/results/$tag-$_.log" -Pattern 'results; startup' -Quiet) }).Count
  $alive = @($procs | Where-Object { -not $_.HasExited }).Count
  if ($done -eq [int]$n -or $alive -eq 0) { break }
  Start-Sleep 5
}
Start-Sleep 3
foreach ($p in $procs) { if (-not $p.HasExited) { try { $p.Kill() } catch {} } }
$merge = @"
const fs=require('fs');const parts=[];for(let i=0;i<$n;i++)parts.push(JSON.parse(fs.readFileSync('.data/results/$tag-'+i+'.json')));
const out={...parts[0],startupMs:Math.max(...parts.map(p=>p.startupMs)),peakRssMb:Math.max(...parts.map(p=>p.peakRssMb)),maxRssMb:Math.max(...parts.map(p=>p.maxRssMb)),results:parts.flatMap(p=>p.results)};
fs.writeFileSync('.data/results/$tag.json',JSON.stringify(out));for(let i=0;i<$n;i++){for(const e of ['.json','.log','.err'])try{fs.rmSync('.data/results/$tag-'+i+e,{force:true})}catch{}}console.log('$tag',out.results.length)
"@
node -e $merge
