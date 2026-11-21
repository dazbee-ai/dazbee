// PROTOTYPE. The timing runs' figures (train/timing.ps1, or train/timing3.ps1 when tags are given): for
// each mode (or tag) and version, the median of the three runs and their spread (lowest–highest) for
// time per block and per ad (median and p95), and for startup and peak memory.
//   node src/timing-summary.ts [tag ...]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DATA_DIR } from './catalogue.ts'

const q = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))]!
const mid = (v: number[]) => q(v, 0.5)
const fmt = (v: number[], d = 0, k = 1) =>
  `${(mid(v) / k).toFixed(d)} (${(Math.min(...v) / k).toFixed(d)}–${(Math.max(...v) / k).toFixed(d)})`
console.log(
  '| mode | version | blocks | ms/block median | ms/block p95 | s/ad median | s/ad p95 | startup s | peak RSS MB |',
)
console.log('|---|---|---|---|---|---|---|---|---|')
const tags = process.argv.slice(2)
for (const mode of tags.length ? tags : ['sub', 'lib']) {
  const prefix = tags.length ? `timing3-${mode}` : `timing-${mode}`
  const runs = [1, 2, 3]
    .map((r) => join(DATA_DIR, 'results', `${prefix}-${r}.json`))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, 'utf8')))
  if (!runs.length) continue
  for (const v of ['light', 'medium']) {
    if (!runs[0].results.some((r: { version: string }) => r.version === v)) continue
    const stats = runs.map(
      (run: { results: { version: string; ms: number; ad: string }[]; startupMs: number; peakRssMb: number }) => {
        const rs = run.results.filter((r) => r.version === v)
        const perAd = new Map<string, number>()
        for (const r of rs) perAd.set(r.ad, (perAd.get(r.ad) ?? 0) + r.ms)
        return {
          n: rs.length,
          p50: q(
            rs.map((r) => r.ms),
            0.5,
          ),
          p95: q(
            rs.map((r) => r.ms),
            0.95,
          ),
          ad50: q([...perAd.values()], 0.5),
          ad95: q([...perAd.values()], 0.95),
          start: run.startupMs,
          rss: run.peakRssMb,
        }
      },
    )
    console.log(
      `| ${tags.length ? mode : mode === 'sub' ? "Dazbee's 321" : 'whole library'} | ${v} | ${stats[0]!.n} × ${stats.length} runs | ${fmt(stats.map((s) => s.p50))} | ${fmt(stats.map((s) => s.p95))} | ${fmt(
        stats.map((s) => s.ad50),
        1,
        1000,
      )} | ${fmt(
        stats.map((s) => s.ad95),
        1,
        1000,
      )} | ${fmt(
        stats.map((s) => s.start),
        1,
        1000,
      )} | ${fmt(stats.map((s) => s.rss))} |`,
    )
  }
}
