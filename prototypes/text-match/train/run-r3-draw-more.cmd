@echo off
rem PROTOTYPE. Two more realistic 64-px training sets of the whole library, drawn on 8 threads beside the training runs.
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
set MING_DIR=C:\dazbee-work\textmatch\ming
:wait
if not exist C:\dazbee-work\textmatch\samples\lib64-r2\meta.json (timeout /t 60 /nobreak >nul & goto wait)
for %%s in ("lib64-r3 64 23" "lib64-r4 64 24") do call :one %%~s
echo all done >> C:\dazbee-work\textmatch\draw64b.log
goto :eof
:one
if exist C:\dazbee-work\textmatch\samples\%1\meta.json goto :eof
echo %date% %time% start %1 >> C:\dazbee-work\textmatch\draw64b.log
node src/make-samples.ts --faces .data/fonts/library.json --per-face %2 --seed %3 --out %1 --threads 8 --height 64 --width 384 --realistic >> C:\dazbee-work\textmatch\draw64b.log 2>&1
move .data\samples\%1 C:\dazbee-work\textmatch\samples\ >> C:\dazbee-work\textmatch\draw64b.log 2>&1
goto :eof
