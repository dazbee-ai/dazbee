// PROTOTYPE. timing3.ps1 in Node, for envy (no PowerShell 7): the same 12 test ads matched three
// times, one process at a time, pinned to one logical CPU (CPU 4) right after it starts. A run counts
// as done when its result file is written (a process that then hangs on exit is stopped).
//   node train/timing3.mjs <model folder> <tag> [evaluate.ts arguments]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [model, tag, ...extra] = process.argv.slice(2)
const dir = join(import.meta.dirname, '..')
const ads =
  'beauty_olea,fashion_maison,fresh_coffee_brio,fresh_kids_brightminds,fresh_wine_vinea,home_nook,juice_squeeze,morrowmere,qsr_burgerhaus,sneaker_volt,tech_soniq,velofern'
for (const rep of [1, 2, 3]) {
  const name = `timing3-${tag}-${rep}`
  const json = join(dir, '.data', 'results', `${name}.json`)
  const log = join(dir, '.data', 'results', `${name}.log`)
  rmSync(json, { force: true })
  const out = openSync(log, 'w')
  const child = spawn(
    process.execPath,
    ['src/evaluate.ts', '--set', 'testads', '--ads', ads, '--model', model, ...extra, '--out', name],
    { cwd: dir, stdio: ['ignore', out, out] },
  )
  execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).ProcessorAffinity = 16`])
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (child.exitCode !== null || (existsSync(json) && /results; startup/.test(readFileSync(log, 'utf8')))) {
        clearInterval(t)
        resolve()
      }
    }, 1000)
  })
  if (child.exitCode === null) child.kill('SIGKILL')
  console.log(name, 'done')
}
process.exit(0)
