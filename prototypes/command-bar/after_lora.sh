#!/bin/bash
# PROTOTYPE, never merged. What follows a LoRA run, on the CPU (the GPU stays free for training):
# archives at every depth, the engine's calls the confidence head learns from, and test scores
# at every depth.  bash after_lora.sh r16   (run from the code folder, ../ holding runs/ models/ results/)
set -e
m=$1
export JAX_PLATFORMS=cpu
python export_cact.py --checkpoint ../checkpoints/needle3.safetensors --lora ../runs/$m/best.safetensors --out ../models/$m --depths 2-20
python score.py --weights ../models/$m/L20.cact --split validation --every-area --out ../results/$m-L20-validation-every.jsonl
python score.py --weights ../models/$m/L20.cact --split calib --every-area --out ../results/$m-L20-calib-every.jsonl
python score.py --weights ../models/$m/L20.cact --split train --limit 1200 --every-area --out ../results/$m-L20-train-every.jsonl
for d in 20 16 12 8 4 2 19 18 17 15 14 13 11 10 9 7 6 5 3; do
  dd=$(printf %02d $d)
  python score.py --weights ../models/$m/L$dd.cact --split test --out ../results/$m-L$dd-test.jsonl
done
python forget_set.py --score --weights ../models/$m/L20.cact --out ../results/forget-$m.jsonl
echo AFTER_LORA_DONE
