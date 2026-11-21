@echo off
cd /d C:\dazbee-work\textmatch\code\prototypes\text-match
node src/lica.ts --root C:\dazbee-work\textmatch\lica\data\lica-data --out C:\dazbee-work\textmatch\lica\blocks --per-family 20 > C:\dazbee-work\textmatch\lica\blocks.log 2>&1
echo done >> C:\dazbee-work\textmatch\lica\blocks.log
