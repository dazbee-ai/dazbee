// PROTOTYPE. The Crello tables: per element type, Light, Medium and the ladder, clean and with the
// AI degradation, under the shared rule (v1) and rule v2. For shape elements and coloured
// backgrounds: made shapes that look the same, IoU against the clean alpha, colour ΔE to the
// palette, layers. For image elements: how many were wrongly made shapes.
import { existsSync } from 'node:fs'

import { load, q } from './summary.ts'

type Row = ReturnType<typeof load>[number]
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '-')

function ladder(L: Row[], M: Map<string, Row>): Row[] {
  return L.map((l) => {
    const m = M.get(String(l.key))!
    const lightDone = l.decision === 'shapes' && l.layers <= 2
    const mediumBetter = m.decision === 'shapes' && (l.decision !== 'shapes' || m.layers < l.layers)
    const pick = lightDone || !mediumBetter ? l : m
    return { ...pick, ms: l.ms + (lightDone ? 0 : m.ms) }
  })
}

console.log(
  '| Input | Rule | Element type | Light | Medium | Ladder | Ladder IoU mean (p10) | Ladder palette ΔE | Ladder layers | Ladder time median / p95 |',
)
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const variant of ['clean', 'ai']) {
  for (const rule of ['v1', 'v2']) {
    const suffix = rule === 'v2' ? '-v2' : ''
    const fl = `out/crello-light-${variant}${suffix}.jsonl`
    const fm = `out/crello-medium-${variant}${suffix}.jsonl`
    if (!existsSync(fl) || !existsSync(fm)) continue
    const L = load(fl)
    const M = load(fm)
    const D = ladder(L, new Map(M.map((r) => [String(r.key), r])))
    for (const type of ['shape element', 'coloured background', 'image element']) {
      const pick = (rows: Row[]) => rows.filter((r) => r.type === type)
      const count = (rows: Row[]) => {
        const p = pick(rows)
        const s = p.filter((r) => r.decision === 'shapes').length
        return `${s}/${p.length} (${Math.round((100 * s) / p.length)} %)`
      }
      const kept = pick(D).filter((r) => r.decision === 'shapes')
      const ious = kept.map((r) => r.iou as number).filter((v) => v !== null)
      const des = kept.map((r) => r.paletteDE as number).filter((v) => v !== null)
      const ms = pick(D).map((r) => r.ms)
      const label = type === 'image element' ? `${type} (wrongly made shapes)` : type
      console.log(
        `| ${variant === 'ai' ? 'AI-degraded' : 'clean'} | ${rule} | ${label} | ${count(L)} | ${count(M)} | ${count(D)} | ${type === 'image element' ? '-' : `${f(mean(ious))} (${f(q(ious, 0.1))})`} | ${type === 'image element' ? '-' : f(mean(des), 2)} | ${type === 'image element' ? '-' : f(mean(kept.map((r) => r.layers)), 2)} | ${(q(ms, 0.5) / 1000).toFixed(2)} s / ${(q(ms, 0.95) / 1000).toFixed(1)} s |`,
      )
    }
  }
}
