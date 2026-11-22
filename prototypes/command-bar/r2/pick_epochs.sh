#!/bin/bash
# PROTOTYPE, never merged. Beside a LoRA run, on the CPU: every epoch's adapter as soon as it is
# written is exported at 4 bits (the archive we would ship) and its validation requests scored by
# the engine, so the epoch is picked by engine exact, not loss.
#   bash pick_epochs.sh <run name> <schema>      (from code/r2; runs in ../../runs/<run>)
set -u
run=$1; schema=$2
R=../../runs/$run; M=../../models/$run; O=../../results/r2/$run
mkdir -p $M $O
export JAX_PLATFORMS=cpu
while true; do
  for a in $R/epoch-*.safetensors; do
    [ -f "$a" ] || continue
    e=$(basename $a .safetensors)
    [ -f $O/$e-val.jsonl ] && continue
    python ../export_cact.py --checkpoint ../../checkpoints/needle3.safetensors --lora $a --out $M/$e --depths 20 > /dev/null
    python score_needle.py --weights $M/$e/L20.cact --schema $schema --queries data/val-queries.jsonl \
      --out $O/$e-val.jsonl --procs 3 --threads 2
    rm -rf $M/$e
  done
  if grep -q '"done"' $R/log.jsonl 2>/dev/null; then
    left=0
    for a in $R/epoch-*.safetensors; do e=$(basename $a .safetensors); [ -f $O/$e-val.jsonl ] || left=1; done
    [ $left = 0 ] && break
  fi
  sleep 60
done
echo PICK_DONE
