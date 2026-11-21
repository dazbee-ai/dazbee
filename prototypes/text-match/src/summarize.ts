// PROTOTYPE. Turns evaluation results (.data/results/*.json) into the report's tables, in Markdown.
//   node src/summarize.ts testads-lib testads-cat synth-lib synth-cat
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DATA_DIR } from './catalogue.ts'
import { isHeldOut } from './testads.ts'

interface R {
  id: string
  ad?: string
  version: string
  keep: boolean
  same: boolean
  ssim: number
  deltaE: number
  ms: number
  draws: number
  lettering?: string
  look: { family: string; weight: number; style: string }
  familyOk?: boolean
  faceOk?: boolean
  inShortlist?: boolean
  sizeErr?: number
  spacingErr?: number
  lineHeightErr?: number | null
  colorDE?: number
  rotationErr?: number
  outlineFound?: boolean
  fontBound?: string | null
  colorBound?: string | null
  truth?: {
    family: string
    inSubset: boolean
    category: string
    script: string
    form: string
    degradation: string
    lowContrast: boolean
    brand: boolean
    kitHasFont?: boolean
    rotation: number
    look: { outline?: unknown }
  }
}

const pct = (v: number) => `${(100 * v).toFixed(1)}%`
const q = (v: number[], p: number) => {
  if (v.length === 0) return NaN
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}
const mean = (v: boolean[]) => (v.length ? v.filter(Boolean).length / v.length : NaN)
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–')
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '–')

const baseline = JSON.parse(readFileSync('C:\\Users\\imkes\\Desktop\\test-ad\\dx-stunnr-text-worker\\baseline.json', 'utf8')) as {
  ads: Record<string, { index: number; live: boolean; family: string; weight: number; style: string }[]>
}
const oldOf = (id: string) => {
  const [ad, index] = id.split('#')
  return baseline.ads[ad!]?.find((b) => b.index === Number(index))
}

for (const name of process.argv.slice(2)) {
  const path = join(DATA_DIR, 'results', `${name}.json`)
  if (!existsSync(path)) continue
  const file = JSON.parse(readFileSync(path, 'utf8')) as {
    set: string
    subset?: boolean
    startupMs: number
    peakRssMb: number
    maxRssMb: number
    sizes: Record<string, number>
    results: R[]
  }
  console.log(`\n### ${name} (${file.set}, ${file.subset ? "Dazbee's 321 families" : 'whole library'})\n`)
  console.log(`startup ${(file.startupMs / 1000).toFixed(1)} s · peak RSS ${file.peakRssMb.toFixed(0)} MB (max ${file.maxRssMb.toFixed(0)} MB) · model ${(file.sizes.modelBytes! / 1e6).toFixed(1)} MB · fingerprints ${(file.sizes.fingerprintsBytes! / 1e6).toFixed(1)} MB\n`)
  const versions = [...new Set(file.results.map((r) => r.version))]
  const rows: string[] = []
  if (file.set === 'testads') {
    rows.push('| version | blocks | looks the same | kept as picture | median SSIM | median ΔE | ms/block median | p95 | s/ad median | p95 | draws/block | same family as old worker | same face as old worker |')
    rows.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    const parts: [string, (r: R) => boolean][] = [
      ['all', () => true],
      ['held-out ads', (r) => isHeldOut(r.ad!)],
      ['development ads', (r) => !isHeldOut(r.ad!)],
    ]
    for (const [part, inPart] of parts)
    for (const v of versions) {
      const rs = file.results.filter((r) => r.version === v && inPart(r))
      const perAd = new Map<string, number>()
      for (const r of rs) perAd.set(r.ad!, (perAd.get(r.ad!) ?? 0) + r.ms)
      const withOld = rs.map((r) => ({ r, o: oldOf(r.id) })).filter((x) => x.o)
      rows.push(
        `| ${v}, ${part} | ${rs.length} | ${pct(mean(rs.map((r) => r.same)))} | ${pct(mean(rs.map((r) => r.keep)))} | ${f2(q(rs.map((r) => r.ssim), 0.5))} | ${f1(q(rs.map((r) => r.deltaE), 0.5))} | ${q(rs.map((r) => r.ms), 0.5).toFixed(0)} | ${q(rs.map((r) => r.ms), 0.95).toFixed(0)} | ${(q([...perAd.values()], 0.5) / 1000).toFixed(1)} | ${(q([...perAd.values()], 0.95) / 1000).toFixed(1)} | ${q(rs.map((r) => r.draws), 0.5)} | ${pct(mean(withOld.map((x) => x.o!.family === x.r.look.family)))} | ${pct(mean(withOld.map((x) => x.o!.family === x.r.look.family && x.o!.weight === x.r.look.weight && x.o!.style === x.r.look.style)))} |`,
      )
    }
  } else {
    rows.push('| version | blocks | looks the same | same family | exact face | family in shortlist | kept | size err (median) | spacing err, % pts | line height err | colour ΔE | tilt err ° | outline right | ms/block median | p95 |')
    rows.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const v of versions) {
      const rs = file.results.filter((r) => r.version === v)
      rows.push(line(v, rs))
    }
    for (const [label, key] of [
      ['in Dazbee’s catalogue', (r: R) => (r.truth!.inSubset ? 'in the 321' : 'outside the 321')],
      ['category', (r: R) => r.truth!.category],
      ['script', (r: R) => r.truth!.script],
      ['degradation', (r: R) => r.truth!.degradation],
      ['form', (r: R) => r.truth!.form],
      ['contrast', (r: R) => (r.truth!.lowContrast ? 'low contrast' : 'normal contrast')],
      ['tilt', (r: R) => (r.truth!.rotation ? 'tilted' : 'level')],
      ['brand', (r: R) => (r.truth!.brand ? (r.truth!.kitHasFont ? 'brand, kit has the font' : 'brand, kit lacks the font') : 'no brand')],
    ] as const) {
      rows.push(`| **by ${label}** |||||||||||||||`)
      for (const v of versions) {
        const rs = file.results.filter((r) => r.version === v)
        const groups = new Map<string, R[]>()
        for (const r of rs) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
        for (const [g, list] of [...groups].sort()) rows.push(line(`${v}: ${g}`, list))
      }
    }
    const brand = file.results.filter((r) => r.truth!.brand)
    if (brand.length) {
      console.log(rows.join('\n'))
      rows.length = 0
      console.log('\nBrand bindings (synthetic brand blocks):\n')
      console.log('| version | kit has the font: bound to brand:heading and right | kit lacks it: wrongly bound | colour bound to brand:primary |')
      console.log('|---|---|---|---|')
      for (const v of versions) {
        const b = brand.filter((r) => r.version === v)
        const has = b.filter((r) => r.truth!.kitHasFont)
        const lacks = b.filter((r) => !r.truth!.kitHasFont)
        console.log(
          `| ${v} | ${pct(mean(has.map((r) => r.fontBound === 'brand:heading' && !!r.familyOk)))} (${has.length}) | ${pct(mean(lacks.map((r) => !!r.fontBound)))} (${lacks.length}) | ${pct(mean(b.map((r) => r.colorBound === 'brand:primary')))} |`,
        )
      }
    }
  }
  if (rows.length) console.log(rows.join('\n'))
}

function line(label: string, rs: R[]) {
  return `| ${label} | ${rs.length} | ${pct(mean(rs.map((r) => r.same)))} | ${pct(mean(rs.map((r) => !!r.familyOk)))} | ${pct(mean(rs.map((r) => !!r.faceOk)))} | ${pct(mean(rs.map((r) => !!r.inShortlist)))} | ${pct(mean(rs.map((r) => r.keep)))} | ${pct(q(rs.map((r) => r.sizeErr!), 0.5))} | ${f1(q(rs.map((r) => r.spacingErr!), 0.5))} | ${f2(q(rs.filter((r) => r.lineHeightErr != null).map((r) => r.lineHeightErr!), 0.5))} | ${f1(q(rs.map((r) => r.colorDE!), 0.5))} | ${f1(q(rs.filter((r) => r.truth!.rotation).map((r) => r.rotationErr!), 0.5))} | ${pct(mean(rs.map((r) => !!r.outlineFound)))} | ${q(rs.map((r) => r.ms), 0.5).toFixed(0)} | ${q(rs.map((r) => r.ms), 0.95).toFixed(0)} |`
}
