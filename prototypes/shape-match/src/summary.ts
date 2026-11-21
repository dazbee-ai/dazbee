// PROTOTYPE. Tables from the result files. Usage:
//   node src/summary.ts synth out/synth-light-test.jsonl [group]   group: family|degradation|brand
//   node src/summary.ts deltax out/deltax-light.jsonl
import { readFileSync } from 'node:fs'

type Row = Record<string, unknown> & { ms: number; layers: number; decision: string }

export function load(path: string): Row[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Row)
}

export const q = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-')
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')

/** One line of synthetic measures for a set of rows. */
export function synthLine(rows: Row[]) {
  const shapesTruth = rows.filter((r) => r.truth === 'shapes')
  const picTruth = rows.filter((r) => r.truth === 'picture')
  const asShapes = rows.filter((r) => r.decision === 'shapes')
  const keptWrong = shapesTruth.filter((r) => r.decision === 'picture').length
  const shapedWrong = picTruth.filter((r) => r.decision === 'shapes').length
  const ious = shapesTruth.filter((r) => r.decision === 'shapes').map((r) => r.iou as number)
  const des = asShapes.map((r) => r.colourDE as number).filter((v) => v !== null)
  return {
    n: rows.length,
    lookSame: pct(shapesTruth.filter((r) => r.decision === 'shapes').length, shapesTruth.length),
    keptWrong: `${keptWrong}/${shapesTruth.length}`,
    shapedWrong: `${shapedWrong}/${picTruth.length}`,
    iou: f(mean(ious), 3),
    iouP10: f(q(ious, 0.1), 3),
    layers: f(mean(asShapes.map((r) => r.layers)), 2),
    truthLayers: f(mean(asShapes.map((r) => r.truthLayers as number)), 2),
    colourDE: f(mean(des), 2),
    ssim: f(mean(asShapes.map((r) => r.ssim as number)), 3),
    meanDE: f(mean(asShapes.map((r) => r.deltaE as number)), 2),
    msMedian: f(
      q(
        rows.map((r) => r.ms),
        0.5,
      ),
      0,
    ),
    msP95: f(
      q(
        rows.map((r) => r.ms),
        0.95,
      ),
      0,
    ),
    snaps: `${rows.reduce((a, r) => a + (r.snapsRight as number), 0)}/${rows.reduce((a, r) => a + (r.snapsWanted as number), 0)}`,
    wrongSnaps: rows.reduce((a, r) => a + (r.snapsWrong as number), 0),
  }
}

export function deltaxLine(rows: Row[]) {
  const asShapes = rows.filter((r) => r.decision === 'shapes')
  return {
    n: rows.length,
    shapes: `${asShapes.length} (${pct(asShapes.length, rows.length)})`,
    layers: f(mean(asShapes.map((r) => r.layers)), 2),
    ssim: f(mean(asShapes.map((r) => r.ssim as number)), 3),
    meanDE: f(mean(asShapes.map((r) => r.deltaE as number)), 2),
    msMedian: f(
      q(
        rows.map((r) => r.ms),
        0.5,
      ),
      0,
    ),
    msP95: f(
      q(
        rows.map((r) => r.ms),
        0.95,
      ),
      0,
    ),
  }
}

function table(groups: [string, Record<string, unknown>][]) {
  const cols = Object.keys(groups[0]![1])
  console.log(['group', ...cols].join(' | '))
  for (const [g, line] of groups) console.log([g, ...cols.map((c) => String(line[c]))].join(' | '))
}

if (import.meta.url === `file:///${process.argv[1]!.replace(/\\/g, '/')}`) {
  const [kind, path, group] = process.argv.slice(2)
  const rows = load(path!)
  if (kind === 'synth') {
    const key = group ?? 'family'
    const names = [...new Set(rows.map((r) => String(r[key])))]
    table([
      ['all', synthLine(rows)],
      ...names.map(
        (n) => [n, synthLine(rows.filter((r) => String(r[key]) === n))] as [string, Record<string, unknown>],
      ),
    ])
  } else {
    const names = [...new Set(rows.map((r) => String(r.kind)))]
    table([...names.map((n) => [n, deltaxLine(rows.filter((r) => r.kind === n))] as [string, Record<string, unknown>])])
  }
}
