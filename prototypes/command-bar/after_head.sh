#!/bin/bash
# PROTOTYPE, never merged. What follows the confidence head's training: the archive with the
# head, its scores on validation and test (turn two in every area too, for the fallback), the
# threshold, and the head checked against the engine.  bash after_head.sh r16 head-r16
set -e
m=$1; h=$2
export JAX_PLATFORMS=cpu
python export_cact.py --checkpoint ../checkpoints/needle3.safetensors --lora ../runs/$m/best.safetensors \
  --head ../runs/$h/head_platt.safetensors --out ../models/$m-head --depths 20
python score.py --weights ../models/$m-head/L20.cact --split validation --every-area --out ../results/$m-head-L20-validation-every.jsonl
python score.py --weights ../models/$m-head/L20.cact --split test --every-area --out ../results/$m-head-L20-test-every.jsonl
python score.py --weights ../models/$m/L20.cact --split test --every-area --out ../results/$m-L20-test-every.jsonl
mkdir -p ../reports
python confidence_report.py --val ../results/$m-head-L20-validation-every.jsonl --test ../results/$m-head-L20-test-every.jsonl --out ../reports/confidence-$m-head.json
python confidence_report.py --val ../results/$m-L20-validation-every.jsonl --test ../results/$m-L20-test-every.jsonl --out ../reports/confidence-$m-nohead.json
echo AFTER_HEAD_DONE
