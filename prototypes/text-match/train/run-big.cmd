@echo off
rem PROTOTYPE. The bigger run: the whole library at 96 samples a face, width 48, 12 epochs; then its fingerprints.
cd /d C:\dazbee-work\textmatch
C:\dazbee-work\venv\Scripts\python.exe train\train.py --data samples\lib-train48,samples\lib-train48b --val samples\lib-val6 --proto samples\lib-proto8 --epochs 12 --width 48 --gpu-data-gb 0 --out models\big-w48-p96 > models\big-w48-p96.log 2>&1
C:\dazbee-work\venv\Scripts\python.exe train\fingerprints.py --model models\big-w48-p96 --proto samples\lib-proto8 > models\big-fp.log 2>&1
