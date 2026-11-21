#!/bin/sh
# PROTOTYPE. The test ads in eight parts at once, for accuracy (not timing), merged into
# .data/results/<tag>.json:  sh train/run-testads-parts.sh <model folder> <tag> [--subset]
cd "$(dirname "$0")/.."
M=$1; T=$2; S=$3
node -e "import('./src/testads.ts').then(d=>{const n=d.adNames();for(let i=0;i<8;i++)console.log(n.filter((_,k)=>k%8===i).join(','))})" > .data/results/parts-$T.txt
n=0
while read ads; do n=$((n+1)); node src/evaluate.ts --set testads --ads $ads $S --model $M --out $T-$n > .data/results/$T-$n.log 2>&1 & done < .data/results/parts-$T.txt
wait
node -e "const fs=require('fs');const parts=[];for(let i=1;i<=$n;i++)parts.push(JSON.parse(fs.readFileSync('.data/results/$T-'+i+'.json')));const out={...parts[0],startupMs:Math.max(...parts.map(p=>p.startupMs)),peakRssMb:Math.max(...parts.map(p=>p.peakRssMb)),maxRssMb:Math.max(...parts.map(p=>p.maxRssMb)),results:parts.flatMap(p=>p.results)};fs.writeFileSync('.data/results/$T.json',JSON.stringify(out));console.log('$T',out.results.length)"
