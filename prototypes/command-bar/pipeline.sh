#!/bin/bash
# PROTOTYPE, never merged. The whole run on the training machine, in order, resumable: a step
# whose output exists is skipped. GPU steps (training) run one at a time; CPU steps (the engine)
# run beside them.  bash pipeline.sh   (from the code folder)
set -u
log() { echo "[$(date +%T)] $*"; }
train() {  # rank
  local r=$1
  if [ -f ../runs/r$r/log.jsonl ] && grep -q '"done"' ../runs/r$r/log.jsonl; then log "r$r trained"; return; fi
  log "train r$r"
  local init=""
  [ -f ../runs/r$r-init.safetensors ] && init="--init-from ../runs/r$r-init.safetensors"
  python train_lora.py $init --rank $r --alpha $((2 * r)) --epochs 12 --patience 4 --max-len 544 --batch 8 --out ../runs/r$r
}
stage() {  # model stage marker
  local m=$1 s=$2 mark=../results/.done-$1-$2
  [ -f $mark ] && { log "$m $s done before"; return; }
  log "start $m $s"
  bash after_lora.sh $m $s && touch $mark
}
exact() {  # validation exact share of a model's two-turn run
  python -c "import sys; from metrics import evaluate, load; print(evaluate(load(sys.argv[1]))['exact'])" ../results/$1-L20-validation-every.jsonl
}

train 16
stage r16 val & p16=$!
train 32
wait $p16
stage r32 val
e16=$(exact r16); e32=$(exact r32)
log "validation exact r16 $e16 r32 $e32"
w=r16
python -c "import sys; sys.exit(0 if float(sys.argv[2]) > float(sys.argv[1]) else 1)" $e16 $e32 && w=r32
echo $w > ../results/winner
log "winner $w"
stage $w headdata
stage $w sweep & psweep=$!
if [ ! -f ../runs/head-$w/head_platt.safetensors ]; then
  log "train head $w"
  python train_head.py --lora ../runs/$w/best.safetensors \
    --engine ../results/$w-L20-calib-every.jsonl ../results/$w-L20-train-every.jsonl \
    --val ../results/$w-L20-validation-every.jsonl --out ../runs/head-$w
fi
log "after head $w"
JAX_PLATFORMS=cpu bash after_head.sh $w head-$w
JAX_PLATFORMS=cpu python head_verify.py --lora ../runs/$w/best.safetensors --head ../runs/head-$w/head_platt.safetensors \
  --results ../results/$w-head-L20-validation-every.jsonl > ../reports/head-verify-$w.json
wait $psweep
log "PIPELINE DONE"
