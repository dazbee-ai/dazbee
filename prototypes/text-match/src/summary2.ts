// PROTOTYPE. One table row per stored result (.data/results/<tag>.json): looks the same by the shared
// rule (and by every rescored rule beside it, <tag>-v2.json), family and exact face where the font is
// known, median SSIM and ΔE, time per block and peak memory. test-ad rows are split into all ads and the
// held-out ads.
//   node src/summary2.ts r2-own-dev r3-own-dev ...
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DATA_DIR } from './catalogue.ts'
import { isHeldOut } from './testads.ts'

interface R {
  id: string
  ad?: string
  version: string
  same: boolean
  ssim: number
  deltaE: number
  ms: number
  familyOk?: boolean
  faceOk?: boolean | null
  inShortlist?: boolean
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '–')
const q = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN
}

console.log(
  '| Run | Blocks | Looks the same (shared / v2) | Family | Exact face | Family in shortlist | Median SSIM / ΔE | Per block, median (p95) | Peak RSS |',
)
console.log('|---|---|---|---|---|---|---|---|---|')
for (const tag of process.argv.slice(2)) {
  const file = JSON.parse(readFileSync(join(DATA_DIR, 'results', `${tag}.json`), 'utf8')) as {
    set: string
    peakRssMb: number
    results: R[]
  }
  const v2File = join(DATA_DIR, 'results', `${tag}-v2.json`)
  const v2 = existsSync(v2File)
    ? new Map(
        (JSON.parse(readFileSync(v2File, 'utf8')) as { id: string; version: string; v2: { same: boolean } }[]).map(
          (x) => [`${x.id}|${x.version}`, x.v2.same],
        ),
      )
    : null
  const groups: [string, R[]][] =
    file.set === 'testads'
      ? [
          ['all ads', file.results],
          ['held-out ads', file.results.filter((r) => isHeldOut(r.ad!))],
        ]
      : [['', file.results]]
  for (const [label, all] of groups) {
    for (const version of [...new Set(all.map((r) => r.version))]) {
      const rs = all.filter((r) => r.version === version)
      const known = rs.filter((r) => r.faceOk !== null && r.faceOk !== undefined)
      const sameV2 = v2 ? pct(rs.filter((r) => v2.get(`${r.id}|${r.version}`)).length, rs.length) : '–'
      const fam = rs.filter((r) => r.familyOk !== undefined)
      console.log(
        `| ${tag}${label ? ` (${label})` : ''} ${version} | ${rs.length} | ${pct(rs.filter((r) => r.same).length, rs.length)} / ${sameV2} | ${fam.length ? pct(fam.filter((r) => r.familyOk).length, fam.length) : '–'} | ${known.length ? pct(known.filter((r) => r.faceOk).length, known.length) : '–'} | ${fam.length ? pct(rs.filter((r) => r.inShortlist).length, rs.length) : '–'} | ${q(
          rs.map((r) => r.ssim),
          0.5,
        ).toFixed(2)} / ${q(
          rs.map((r) => r.deltaE),
          0.5,
        ).toFixed(1)} | ${(
          q(
            rs.map((r) => r.ms),
            0.5,
          ) / 1000
        ).toFixed(2)} s (${(
          q(
            rs.map((r) => r.ms),
            0.95,
          ) / 1000
        ).toFixed(1)} s) | ${file.peakRssMb.toFixed(0)} MB |`,
      )
    }
  }
}
