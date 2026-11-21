@echo off
rem PROTOTYPE. The bigger model on the synthetic test set, whole library then Dazbee's 321 families.
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 synth-lib-big > C:\dazbee-work\textmatch\big-evals.log 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File train\run-synth-parts.ps1 .data/models/big-w48-p96 synth-sub-big --subset >> C:\dazbee-work\textmatch\big-evals.log 2>&1
