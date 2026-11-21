#!/bin/sh
# PROTOTYPE. The synthetic test set in parts of 30 blocks, eight processes at a time, for accuracy
# (not timing): sh train/run-synth-parts.sh <model folder> <tag> [--subset]
cd "$(dirname "$0")/.."
M=$1
T=$2
S=$3
node -e "const t=require('./.data/synthetic/truth.json').filter(x=>x.part==='test').map(x=>x.id);for(let i=0;i<t.length;i+=30)console.log(t.slice(i,i+30).join(','))" > .data/results/parts-$T.txt
n=0
while read ids; do
  n=$((n+1))
  node src/evaluate.ts --set synthetic --part test $S --ids $ids --model $M --out $T-$n > .data/results/$T-$n.log 2>&1 &
done < .data/results/parts-$T.txt
wait
node -e "
const fs=require('fs');const parts=[];for(let i=1;i<=$n;i++)parts.push(JSON.parse(fs.readFileSync('.data/results/$T-'+i+'.json')));
const out={...parts[0],startupMs:Math.max(...parts.map(p=>p.startupMs)),peakRssMb:Math.max(...parts.map(p=>p.peakRssMb)),maxRssMb:Math.max(...parts.map(p=>p.maxRssMb)),results:parts.flatMap(p=>p.results)};
fs.writeFileSync('.data/results/$T.json',JSON.stringify(out));console.log('$T',out.results.length)"
