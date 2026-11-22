// PROTOTYPE. run-parts.sh in Node, for Windows machines without a POSIX shell (envy): one set's part
// matched in N shards side by side, merged into .data/results/<tag>.json. Extra arguments go to
// evaluate.ts. A shard counts as done when its result file is written; a process that then hangs on
// exit (seen on envy) is stopped.
//   node train/run-parts.mjs <set> <part> <model folder> <tag> <shards> [evaluate.ts arguments]
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [set, part, model, tag, n, ...extra] = process.argv.slice(2)
const dir = join(import.meta.dirname, '..')
const results = join(dir, '.data', 'results')
const shards = Number(n)
const file = (i, ext) => join(results, `${tag}-${i}${ext}`)
for (let i = 0; i < shards; i++) for (const ext of ['.json', '.log']) rmSync(file(i, ext), { force: true })
const children = Array.from({ length: shards }, (_, i) => {
  const out = openSync(file(i, '.log'), 'w')
  return spawn(
    process.execPath,
    [
      'src/evaluate.ts',
      '--set',
      set,
      '--part',
      part,
      '--model',
      model,
      '--shard',
      `${i}/${shards}`,
      '--out',
      `${tag}-${i}`,
      ...extra,
    ],
    {
      cwd: dir,
      stdio: ['ignore', out, out],
    },
  )
})
const exited = children.map((c) => new Promise((resolve) => c.on('exit', resolve)))
const finished = (i) => existsSync(file(i, '.json')) && /results; startup/.test(readFileSync(file(i, '.log'), 'utf8'))
await new Promise((resolve) => {
  const check = setInterval(() => {
    if (children.every((c, i) => c.exitCode !== null || finished(i))) {
      clearInterval(check)
      resolve()
    }
  }, 2000)
})
await new Promise((r) => setTimeout(r, 3000))
for (const c of children) if (c.exitCode === null) c.kill('SIGKILL')
await Promise.race([Promise.all(exited), new Promise((r) => setTimeout(r, 10000))])
const parts = Array.from({ length: shards }, (_, i) => JSON.parse(readFileSync(file(i, '.json'), 'utf8')))
const merged = {
  ...parts[0],
  startupMs: Math.max(...parts.map((p) => p.startupMs)),
  peakRssMb: Math.max(...parts.map((p) => p.peakRssMb)),
  maxRssMb: Math.max(...parts.map((p) => p.maxRssMb)),
  results: parts.flatMap((p) => p.results),
}
writeFileSync(join(results, `${tag}.json`), JSON.stringify(merged))
for (let i = 0; i < shards; i++)
  for (const ext of ['.json', '.log'])
    try {
      rmSync(file(i, ext), { force: true })
    } catch {}
console.log(tag, merged.results.length)
process.exit(0)
