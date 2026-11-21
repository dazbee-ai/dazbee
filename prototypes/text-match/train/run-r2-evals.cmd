@echo off
rem PROTOTYPE. Round 2 on the synthetic test part: the bigger model with the fingerprint's vote in the ranking and five finalists in Medium.
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
:wait
if not exist .data\results\dev-f1-n5.json (timeout /t 20 /nobreak >nul & goto wait)
set FUSE=
set FINALISTS=
set PART=
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 synth-lib-r2 > C:\dazbee-work\textmatch\r2-evals.log 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 synth-sub-r2 --subset >> C:\dazbee-work\textmatch\r2-evals.log 2>&1
