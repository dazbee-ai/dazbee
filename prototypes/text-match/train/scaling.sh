#!/bin/sh
# PROTOTYPE. The scaling runs: training data per face at one model width, then model widths at the most data.
# Run from prototypes/text-match:  sh train/scaling.sh [python]
PY=${1:-.venv/Scripts/python}
S=.data/samples
run() { $PY train/train.py --data $S/train48 --val $S/val6 --proto $S/proto8 --epochs ${EPOCHS:-12} --per-face $1 --width $2 --out .data/models/w$2-p$1 > .data/models/w$2-p$1.log 2>&1; }
mkdir -p .data/models
run 48 32
run 6 32
run 12 32
run 24 32
run 48 16
run 48 48
