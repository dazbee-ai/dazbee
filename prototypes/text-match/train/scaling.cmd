@echo off
rem PROTOTYPE. The scaling runs on a Windows machine with a CUDA card, from the folder holding samples\ and train\:
rem   train\scaling.cmd .venv\Scripts\python.exe samples\train48 cat
rem Data per face at width 32, then model widths at 48 samples a face; 12 epochs each.
set PY=%1
set DATA=%2
set TAG=%3
if not exist models mkdir models
for %%R in ("48 32" "6 32" "12 32" "24 32" "48 16" "48 48") do call :run %%~R
goto :eof
:run
%PY% train\train.py --data %DATA% --val samples\val6 --proto samples\proto8 --epochs 12 --per-face %1 --width %2 --out models\%TAG%-w%2-p%1 > models\%TAG%-w%2-p%1.log 2>&1
goto :eof
