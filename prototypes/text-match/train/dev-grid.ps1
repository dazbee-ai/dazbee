# PROTOTYPE. Chooses how candidates are ranked and how many reach the final check, on the synthetic
# development part only (never the test part): each setting over the 120 development blocks.
$dir = Split-Path $PSScriptRoot -Parent
Set-Location $dir
$env:PART = 'dev'
foreach ($fuse in @('0', '0.25', '0.5', '1')) {
  foreach ($fin in @('2', '5')) {
    $env:FUSE = $fuse; $env:FINALISTS = $fin
    & "$PSScriptRoot/run-synth-parts.ps1" .data/models/big-w48-p96 "dev-f$fuse-n$fin"
  }
}
