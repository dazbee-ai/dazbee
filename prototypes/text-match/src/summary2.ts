// PROTOTYPE. One table row per stored result (.data/results/<tag>.json, rescored by every rule into
// <tag>-rules.json by rescore.ts): looks the same by the owner's rule with the colour guard, at the
// looser ink bar, by the rule alone, by v1 and by v2; family and exact face where the font is known,
// median SSIM and ΔE (v1's), time per block and peak memory. test-ad rows are split into all ads and the
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
  '| Run | Blocks | Looks the same: rule + colour guard (ink bar 0.12 / 0.20) | Rule alone | v1 / v2 | Family | Exact face | Family in shortlist | Median SSIM / ΔE (v1) | Per block, median (p95) | Peak RSS |',
)
console.log('|---|---|---|---|---|---|---|---|---|---|---|')
for (const tag of process.argv.slice(2)) {
  const file = JSON.parse(readFileSync(join(DATA_DIR, 'results', `${tag}.json`), 'utf8')) as {
    set: string
    peakRssMb: number
    results: R[]
  }
  const rulesFile = join(DATA_DIR, 'results', `${tag}-rules.json`)
  const rules = existsSync(rulesFile)
    ? new Map(
        (
          JSON.parse(readFileSync(rulesFile, 'utf8')) as {
            id: string
            version: string
            same: boolean
            v1: boolean
            v2: { same: boolean }
            owner: { rule: boolean; loose: boolean }
          }[]
        ).map((x) => [`${x.id}|${x.version}`, x]),
      )
    : null
  const groups: [string, R[]][] =
    file.set === 'testads'
      ? [
          ['all ads', file.results],
          ['development ads', file.results.filter((r) => !isHeldOut(r.ad!))],
          ['held-out ads', file.results.filter((r) => isHeldOut(r.ad!))],
        ]
      : [['', file.results]]
  for (const [label, all] of groups) {
    for (const version of [...new Set(all.map((r) => r.version))]) {
      const rs = all.filter((r) => r.version === version)
      const known = rs.filter((r) => r.faceOk !== null && r.faceOk !== undefined)
      const of = (r: R) => rules?.get(`${r.id}|${r.version}`)
      const count = (f: (x: NonNullable<ReturnType<typeof of>>) => boolean) =>
        rules ? pct(rs.filter((r) => of(r) && f(of(r)!)).length, rs.length) : '–'
      const ruleCols = `${count((x) => x.same)} / ${count((x) => x.owner.loose)} | ${count((x) => x.owner.rule)} | ${count((x) => x.v1)} / ${count((x) => x.v2.same)}`
      const fam = rs.filter((r) => r.familyOk !== undefined)
      console.log(
        `| ${tag}${label ? ` (${label})` : ''} ${version} | ${rs.length} | ${ruleCols} | ${fam.length ? pct(fam.filter((r) => r.familyOk).length, fam.length) : '–'} | ${known.length ? pct(known.filter((r) => r.faceOk).length, known.length) : '–'} | ${fam.length ? pct(rs.filter((r) => r.inShortlist).length, rs.length) : '–'} | ${q(
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
