# PROTOTYPE. The synthetic test set in parts of 30 blocks, all parts at once, for accuracy (not timing),
# then merged into .data/results/<tag>.json. From prototypes/text-match:
#   pwsh train/run-synth-parts.ps1 <model folder> <tag> [--subset]
$model = $args[0]; $tag = $args[1]; $subset = if ($args.Count -gt 2) { $args[2] } else { '' }
$dir = Split-Path $PSScriptRoot -Parent
Set-Location $dir
New-Item -ItemType Directory -Force .data/results | Out-Null
$ids = node -e "const t=require('./.data/synthetic/truth.json').filter(x=>x.part===(process.env.PART||'test')).map(x=>x.id);for(let i=0;i<t.length;i+=30)console.log(t.slice(i,i+30).join(','))"
$n = 0
$procs = foreach ($line in $ids) {
  $n++
  Start-Process -PassThru -NoNewWindow -FilePath node -ArgumentList "src/evaluate.ts --set synthetic --part $(if ($env:PART) { $env:PART } else { 'test' }) $subset --ids $line --model $model --out $tag-$n" -RedirectStandardOutput ".data/results/$tag-$n.log" -RedirectStandardError ".data/results/$tag-$n.err"
}
$procs | Wait-Process
node -e "const fs=require('fs');const parts=[];for(let i=1;i<=$n;i++)parts.push(JSON.parse(fs.readFileSync('.data/results/$tag-'+i+'.json')));const out={...parts[0],startupMs:Math.max(...parts.map(p=>p.startupMs)),peakRssMb:Math.max(...parts.map(p=>p.peakRssMb)),maxRssMb:Math.max(...parts.map(p=>p.maxRssMb)),results:parts.flatMap(p=>p.results)};fs.writeFileSync('.data/results/$tag.json',JSON.stringify(out));console.log('$tag',out.results.length)"
