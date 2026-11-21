@echo off
rem PROTOTYPE. The whole-library runs on a Windows machine with a CUDA card, from the folder holding samples\ and train\:
rem   train\library.cmd C:\dazbee-work\venv\Scripts\python.exe
rem Data per face at width 32, model widths at 48 a face, 12 epochs each; samples stay in main memory.
set PY=%1
if not exist models mkdir models
for %%R in ("48 32" "12 32" "24 32" "48 16" "48 48") do call :run %%~R
goto :eof
:run
%PY% train\train.py --data samples\lib-train48 --val samples\lib-val6 --proto samples\lib-proto8 --epochs 12 --per-face %1 --width %2 --gpu-data-gb 0 --out models\lib-w%2-p%1 > models\lib-w%2-p%1.log 2>&1
goto :eof
