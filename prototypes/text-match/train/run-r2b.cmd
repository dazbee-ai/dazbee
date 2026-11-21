@echo off
rem PROTOTYPE. Round 2 with the brand margin in the shape score: development part first, then the test part.
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
set PART=dev
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 dev-r2b > C:\dazbee-work\textmatch\r2b.log 2>&1
set PART=
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 synth-lib-r2b >> C:\dazbee-work\textmatch\r2b.log 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 synth-sub-r2b --subset >> C:\dazbee-work\textmatch\r2b.log 2>&1
