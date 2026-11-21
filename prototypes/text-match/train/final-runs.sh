#!/bin/sh
# PROTOTYPE. The measured runs: each evaluation alone on its own core (Windows affinity), so every
# time is one core's. Run from prototypes/text-match with the model folder as $1 and a tag as $2.
M=$1
T=$2
run() { cmd //c "start /affinity $1 /wait /b node src/evaluate.ts $3 --model $M --out $2" > .data/results/$2.log 2>&1; }
run 1 testads-lib-$T "--set testads" &
run 2 testads-sub-$T "--set testads --subset" &
run 4 synth-lib-$T "--set synthetic --part test" &
run 8 synth-sub-$T "--set synthetic --part test --subset" &
wait
