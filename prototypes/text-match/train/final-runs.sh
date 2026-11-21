#!/bin/sh
# PROTOTYPE. The measured runs: each evaluation alone on its own physical core (Windows affinity to
# logical CPUs 4, 6, 8 and 10, whose hyperthread siblings stay idle), so every time is one core's. Run from prototypes/text-match with the model folder as $1 and a tag as $2.
M=$1
T=$2
run() { cmd //c "start /affinity $1 /wait /b node src/evaluate.ts $3 --model $M --out $2" > .data/results/$2.log 2>&1; }
run 10 deltax-lib-$T "--set deltax" &
run 40 deltax-sub-$T "--set deltax --subset" &
run 100 synth-lib-$T "--set synthetic --part test" &
run 400 synth-sub-$T "--set synthetic --part test --subset" &
wait
