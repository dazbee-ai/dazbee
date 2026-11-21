@echo off
rem PROTOTYPE. Draws the 64-px sample sets of the whole library on envy: galleries, a realistic validation set and realistic training sets.
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
set MING_DIR=C:\dazbee-work\textmatch\ming
for %%s in ("lib64-proto8 8 11 plain" "lib64-proto8r 8 12 realistic" "lib64-val4r 4 13 realistic" "lib64-r1 64 21 realistic" "lib64-r2 64 22 realistic") do call :one %%~s
echo all done >> C:\dazbee-work\textmatch\draw64.log
goto :eof
:one
if exist C:\dazbee-work\textmatch\samples\%1\meta.json goto :eof
set R=
if "%4"=="realistic" set R=--realistic
echo %date% %time% start %1 >> C:\dazbee-work\textmatch\draw64.log
node src/make-samples.ts --faces .data/fonts/library.json --per-face %2 --seed %3 --out %1 --threads 15 --height 64 --width 384 %R% >> C:\dazbee-work\textmatch\draw64.log 2>&1
move .data\samples\%1 C:\dazbee-work\textmatch\samples\ >> C:\dazbee-work\textmatch\draw64.log 2>&1
goto :eof
