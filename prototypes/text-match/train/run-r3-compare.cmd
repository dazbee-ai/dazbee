@echo off
rem PROTOTYPE. Round 3 backbone comparison: four runs one after another on the realistic 64-px sets; each resumes from its last.pt.
cd /d C:\dazbee-work\textmatch
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
:wait
if not exist samples\lib64-r2\meta.json (timeout /t 60 /nobreak >nul & goto wait)
for %%a in (ours convnext_atto resnet18 mobilenetv4_conv_small) do call :run %%a
echo all done >> models\r3-compare.log
goto :eof
:run
findstr /c:"\"done\": true" models\r3-%1.log >nul 2>&1 && goto :eof
echo %date% %time% start %1 >> models\r3-compare.log
C:\dazbee-work\venv\Scripts\python.exe train\train2.py --arch %1 --data samples\lib64-r1,samples\lib64-r2 --epochs 12 --out models\r3-%1 >> models\r3-%1.log 2>&1
goto :eof
