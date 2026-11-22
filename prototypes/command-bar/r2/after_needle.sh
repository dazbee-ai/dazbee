#!/bin/bash
# PROTOTYPE, never merged. After a round 2 Needle LoRA run and its epoch scores (pick_epochs.sh):
# the epoch with the best engine exact on validation is exported at 4 bits and scored on both
# frozen test sets, then timed natively and in Node through Cactus's WebAssembly engine.
#   bash after_needle.sh <run name> <schema>      (from code/r2)
set -eu
run=$1; schema=$2
O=../../results/r2/$run; M=../../models/$run/best
export JAX_PLATFORMS=cpu
best=$(python - "$O" <<'PY'
import glob, json, os, sys
scores = {}
for p in sorted(glob.glob(os.path.join(sys.argv[1], "epoch-*-val.jsonl"))):
    rows = [json.loads(l) for l in open(p)]
    scores[os.path.basename(p)[:8]] = sum(r["exact"] for r in rows) / len(rows)
print(json.dumps(scores), file=sys.stderr)
print(max(scores, key=scores.get))
PY
)
echo "best epoch $best"
python ../export_cact.py --checkpoint ../../checkpoints/needle3.safetensors --lora ../../runs/$run/$best.safetensors --out $M --depths 20
python score_needle.py --weights $M/L20.cact --schema $schema --out $O/best-test.jsonl
python score_needle.py --weights $M/L20.cact --schema $schema --queries data/test2.frozen.txt --out $O/best-test2.jsonl
python summarise.py $O/best-test.jsonl $O/best-test2.jsonl
python bench_needle.py --weights $M/L20.cact --schema $schema --threads 4 --n 100
ls -la $M/L20.cact
echo AFTER_NEEDLE_DONE
