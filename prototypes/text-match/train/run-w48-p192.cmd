@echo off
rem PROTOTYPE. Round 2, more data: the whole library at 192 samples a face (four sets), width 48, base augmentation, 12 epochs; then its fingerprints.
cd /d C:\dazbee-work\textmatch
:wait
if not exist samples\lib-train48d\meta.json (timeout /t 30 /nobreak >nul & goto wait)
C:\dazbee-work\venv\Scripts\python.exe train\train.py --data samples\lib-train48,samples\lib-train48b,samples\lib-train48c,samples\lib-train48d --val samples\lib-val6 --proto samples\lib-proto8 --epochs 12 --width 48 --gpu-memory-gb 2.0 --out models\r2-w48-p192 > models\r2-w48-p192.log 2>&1
C:\dazbee-work\venv\Scripts\python.exe train\fingerprints.py --model models\r2-w48-p192 --proto samples\lib-proto8 > models\r2-w48-p192-fp.log 2>&1
