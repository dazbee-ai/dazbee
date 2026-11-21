@echo off
rem PROTOTYPE. Two more training sets of the whole library (48 a face each, new seeds), drawn with Dazbee's renderer on 12 threads.
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
node src/make-samples.ts --faces .data/fonts/library.json --per-face 48 --seed 5 --out lib-train48c --threads 12 > C:\dazbee-work\textmatch\samples-c.log 2>&1
move .data\samples\lib-train48c C:\dazbee-work\textmatch\samples\ >> C:\dazbee-work\textmatch\samples-c.log 2>&1
node src/make-samples.ts --faces .data/fonts/library.json --per-face 48 --seed 6 --out lib-train48d --threads 12 > C:\dazbee-work\textmatch\samples-d.log 2>&1
move .data\samples\lib-train48d C:\dazbee-work\textmatch\samples\ >> C:\dazbee-work\textmatch\samples-d.log 2>&1
