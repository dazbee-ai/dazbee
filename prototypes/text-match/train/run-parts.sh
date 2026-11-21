#!/bin/sh
# PROTOTYPE. One set's part matched in N shards side by side, for accuracy (not timing), merged into
# .data/results/<tag>.json. Extra arguments go to evaluate.ts (--versions, --onnx, --fp, --subset).
#   sh train/run-parts.sh <set> <part> <model folder> <tag> <shards> [evaluate.ts arguments]
# <set> is testads (its part is ignored), synthetic, own or lica.
cd "$(dirname "$0")/.."
SET=$1; PART=$2; M=$3; T=$4; N=$5
shift 5
i=0
while [ $i -lt $N ]; do
  node src/evaluate.ts --set $SET --part $PART --model $M --shard $i/$N --out $T-$i "$@" > .data/results/$T-$i.log 2>&1 &
  i=$((i+1))
done
wait
node -e "
const fs=require('fs');const parts=[];for(let i=0;i<$N;i++)parts.push(JSON.parse(fs.readFileSync('.data/results/$T-'+i+'.json')));
const out={...parts[0],startupMs:Math.max(...parts.map(p=>p.startupMs)),peakRssMb:Math.max(...parts.map(p=>p.peakRssMb)),maxRssMb:Math.max(...parts.map(p=>p.maxRssMb)),results:parts.flatMap(p=>p.results)};
fs.writeFileSync('.data/results/$T.json',JSON.stringify(out));for(let i=0;i<$N;i++){fs.rmSync('.data/results/$T-'+i+'.json');fs.rmSync('.data/results/$T-'+i+'.log')}console.log('$T',out.results.length)"
