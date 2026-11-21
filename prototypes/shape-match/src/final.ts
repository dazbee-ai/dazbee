// PROTOTYPE. The comparison tables: Light, Medium, the ladder and the old worker, per block kind,
// under the shared rule (v1) and rule v2, on the test-ad development ads, the frozen ads, and both
// synthetic sets. The old worker's answers are scored by score-old.ts with both rules. The ladder
// is put together block by block from the Light and Medium runs: a block the layering job marks a
// photo or cutout stays a picture untouched; otherwise Light first, and Medium too when Light needs
// more than two layers or fails; the answer that looks the same in fewer layers wins.
import { existsSync, readdirSync } from 'node:fs'

import { ADS, isFrozenAd } from './paths.ts'
import { load, q } from './summary.ts'

type Row = ReturnType<typeof load>[number]
const CONVERT = ['shape', 'graphic', 'background']
const PICTURE = ['photo', 'cutout']
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const allAds = readdirSync(ADS).sort()
const frozen = (r: Row) => isFrozenAd(allAds, String(r.ad))

function ladder(L: Row[], M: Map<string, Row>, key: (r: Row) => string, useKinds: boolean): Row[] {
  return L.map((l) => {
    if (useKinds && PICTURE.includes(String(l.kind))) return { ...l, decision: 'picture', layers: 0, ms: 0 }
    const m = M.get(key(l))!
    const lightDone = l.decision === 'shapes' && l.layers <= 2
    const mediumBetter = m.decision === 'shapes' && (l.decision !== 'shapes' || m.layers < l.layers)
    const pick = lightDone || !mediumBetter ? l : m
    return { ...pick, ms: l.ms + (lightDone ? 0 : m.ms) }
  })
}

const testadsKey = (r: Row) => `${r.ad}/${r.file}`
const old = load('out/testads-old.jsonl')
const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / b)} %)`

for (const part of ['development (32 ads)', 'frozen (16 ads)', 'all 48 ads']) {
  const inPart = (r: Row) => (part.startsWith('dev') ? !frozen(r) : part.startsWith('frozen') ? frozen(r) : true)
  console.log(`\n## test-ad, ${part}: shape blocks that look the same\n`)
  console.log('| Kind | Rule | Light | Medium | Ladder | Old worker |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const kind of [...CONVERT, 'all shape blocks', 'photos and cutouts made shapes (no kinds)']) {
    for (const rule of ['v1', 'v2']) {
      const suffix = rule === 'v2' ? '-v2' : ''
      if (!existsSync(`out/testads-light${suffix}.jsonl`) || !existsSync(`out/testads-medium${suffix}.jsonl`)) continue
      const L = load(`out/testads-light${suffix}.jsonl`).filter(inPart)
      const M = new Map(
        load(`out/testads-medium${suffix}.jsonl`)
          .filter(inPart)
          .map((r) => [testadsKey(r), r]),
      )
      const D = ladder(L, M, testadsKey, false)
      const pick = (rows: Row[]) =>
        kind === 'all shape blocks'
          ? rows.filter((r) => CONVERT.includes(String(r.kind)))
          : kind.startsWith('photos')
            ? rows.filter((r) => PICTURE.includes(String(r.kind)))
            : rows.filter((r) => r.kind === kind)
      const count = (rows: Row[]) => {
        const p = pick(rows)
        return pct(p.filter((r) => r.decision === 'shapes').length, p.length)
      }
      const o = kind.startsWith('photos')
        ? null
        : old.filter(inPart).filter((r) => kind === 'all shape blocks' || r.kind === kind)
      const oldCount = o
        ? pct(o.filter((r) => (rule === 'v2' ? r.decisionV2 : r.decision) === 'shapes').length, o.length)
        : 'not sent'
      console.log(`| ${kind} | ${rule} | ${count(L)} | ${count([...M.values()])} | ${count(D)} | ${oldCount} |`)
    }
  }
}

console.log("\n## test-ad time and layers (all 48 ads; the ladder uses the job's kinds)\n")
for (const rule of ['v1', 'v2']) {
  const suffix = rule === 'v2' ? '-v2' : ''
  if (!existsSync(`out/testads-medium${suffix}.jsonl`)) continue
  const L = load(`out/testads-light${suffix}.jsonl`)
  const M = load(`out/testads-medium${suffix}.jsonl`)
  const D = ladder(L, new Map(M.map((r) => [testadsKey(r), r])), testadsKey, true)
  const perAd = (rows: Row[]) => {
    const ads = new Map<string, number>()
    for (const r of rows.filter((r) => [...CONVERT, ...PICTURE].includes(String(r.kind))))
      ads.set(String(r.ad), (ads.get(String(r.ad)) ?? 0) + r.ms)
    const a = [...ads.values()]
    return `${(q(a, 0.5) / 1000).toFixed(1)} s / ${(q(a, 0.95) / 1000).toFixed(1)} s / ${(Math.max(...a) / 1000).toFixed(1)} s`
  }
  const block = (rows: Row[]) => {
    const ms = rows.filter((r) => CONVERT.includes(String(r.kind))).map((r) => r.ms)
    return `${(q(ms, 0.5) / 1000).toFixed(2)} s / ${(q(ms, 0.95) / 1000).toFixed(1)} s`
  }
  const layers = (rows: Row[]) =>
    mean(rows.filter((r) => CONVERT.includes(String(r.kind)) && r.decision === 'shapes').map((r) => r.layers)).toFixed(
      2,
    )
  console.log(
    `${rule}: per ad (shape, graphic, background, photo and cutout blocks) median / p95 / slowest — Light ${perAd(L)}, Medium ${perAd(M)}, ladder ${perAd(D)}; per shape block median / p95 — Light ${block(L)}, Medium ${block(M)}, ladder ${block(D)}; layers per block made shapes — ladder ${layers(D)}`,
  )
}

for (const [label, prefix, part] of [
  ['synthetic held-out (208, seen in round 1 summaries)', 'synth', 'test'],
  ['synthetic set 2 (312, new seed, never looked at before this run)', 'synth2', 'all'],
] as const) {
  console.log(`\n## ${label}\n`)
  console.log(
    '| Rule | Version | Look the same | Pictures made shapes | IoU mean (p10) | Layers | Time median / p95 | Brand snaps right / wrong |',
  )
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const rule of ['v1', 'v2']) {
    const suffix = rule === 'v2' ? '-v2' : ''
    const fl = `out/${prefix}-light${suffix}-${part}.jsonl`
    const fm = `out/${prefix}-medium${suffix}-${part}.jsonl`
    if (!existsSync(fl) || !existsSync(fm)) continue
    const L = load(fl)
    const M = load(fm)
    const D = ladder(L, new Map(M.map((r) => [String(r.id), r])), (r) => String(r.id), false)
    for (const [name, rows] of [
      ['Light', L],
      ['Medium', M],
      ['Ladder', D],
    ] as const) {
      const t = rows.filter((r) => r.truth === 'shapes')
      const kept = t.filter((r) => r.decision === 'shapes')
      const ious = kept.map((r) => r.iou as number)
      const pics = rows.filter((r) => r.truth === 'picture')
      console.log(
        `| ${rule} | ${name} | ${pct(kept.length, t.length)} | ${pics.filter((r) => r.decision === 'shapes').length}/${pics.length} | ${mean(ious).toFixed(3)} (${q(ious, 0.1).toFixed(3)}) | ${mean(rows.filter((r) => r.decision === 'shapes').map((r) => r.layers)).toFixed(2)} | ${(
          q(
            rows.map((r) => r.ms),
            0.5,
          ) / 1000
        ).toFixed(2)} s / ${(
          q(
            rows.map((r) => r.ms),
            0.95,
          ) / 1000
        ).toFixed(
          1,
        )} s | ${rows.reduce((a, r) => a + (r.snapsRight as number), 0)} of ${rows.reduce((a, r) => a + (r.snapsWanted as number), 0)} / ${rows.reduce((a, r) => a + (r.snapsWrong as number), 0)} |`,
      )
    }
    const groups = [...new Set(D.map((r) => String(r.degradation)))]
    console.log(
      `\n${rule} ladder by degradation: ` +
        groups
          .map((g) => {
            const t = D.filter((r) => r.degradation === g && r.truth === 'shapes')
            return `${g} ${Math.round((100 * t.filter((r) => r.decision === 'shapes').length) / t.length)} %`
          })
          .join(', ') +
        '\n',
    )
  }
}
