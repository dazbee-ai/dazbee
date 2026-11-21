@echo off
rem PROTOTYPE. Round 2: --arch resnet18 --aug strong, on the whole library at 96 samples a face, 12 epochs; then its fingerprints.
cd /d C:\dazbee-work\textmatch
C:\dazbee-work\venv\Scripts\python.exe train\train.py --data samples\lib-train48,samples\lib-train48b --val samples\lib-val6 --proto samples\lib-proto8 --epochs 12 --arch resnet18 --aug strong --batch 128 --gpu-memory-gb 1.2 --out models\r2-r18-strong > models\r2-r18-strong.log 2>&1
C:\dazbee-work\venv\Scripts\python.exe train\fingerprints.py --model models\r2-r18-strong --proto samples\lib-proto8 > models\r2-r18-strong-fp.log 2>&1
