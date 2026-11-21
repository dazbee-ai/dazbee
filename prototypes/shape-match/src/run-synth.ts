// PROTOTYPE. Runs Light or Medium over the synthetic set and measures against the ground truth:
// decision, looks-the-same, layers, each true shape's IoU with its best-matching layer, colour ΔE,
// and brand snaps. Usage: node src/run-synth.ts light|medium [dev|test|all] [snapΔE]
import { readFileSync, writeFileSync } from 'node:fs'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { deltaE00, parseHex, rgbToLab } from './colour.ts'
import { coverage, type OutLayer } from './draw.ts'
import { softIoU } from './fit.ts'
import { type Config, LIGHT, matchBlock, MEDIUM } from './match.ts'
import { decodeFile } from './pixels.ts'
import type { SynthBlock } from './synth.ts'

const ck = await loadCanvasKit()
const level = process.argv[2] === 'medium' ? 'medium' : 'light'
const part = process.argv[3] ?? 'test'
const snap = process.argv[4] ? Number(process.argv[4]) : undefined
const cfg: Config = { ...(level === 'medium' ? MEDIUM : LIGHT), ...(snap !== undefined ? { snapDeltaE: snap } : {}) }
const index = JSON.parse(readFileSync('data/synth/index.json', 'utf8')) as SynthBlock[]
const blocks = index.filter((b) => part === 'all' || (part === 'dev' ? b.dev : !b.dev))
const lines: string[] = []
for (const b of blocks) {
  const img = decodeFile(ck, `data/synth/${b.id}.png`)
  const r = matchBlock(ck, img, cfg, b.kit)
  const geo = geometry(b.layers, r.layers, img.w, img.h)
  const brand = brandCheck(b, r.layers, geo.pairs)
  const row = {
    id: b.id,
    family: b.family,
    degradation: b.degradation,
    brand: b.brand,
    truth: b.truth,
    decision: r.decision,
    why: r.why,
    ssim: r.score?.ssim ?? null,
    deltaE: r.score?.deltaE ?? null,
    same: r.score?.same ?? false,
    layers: r.layers.length,
    truthLayers: b.layers.length,
    iou: geo.meanIoU,
    colourDE: geo.colourDE,
    snapsRight: brand.right,
    snapsWanted: brand.wanted,
    snapsWrong: brand.wrong,
    ms: r.ms,
    renders: r.renders,
    kinds: r.layers.map((l) => (l.props.shape as { kind: string }).kind),
  }
  lines.push(JSON.stringify(row))
  console.log(
    `${String(b.id).padStart(3)} ${b.family.padEnd(11)} ${b.degradation.padEnd(8)} ${b.truth.padEnd(7)} → ${r.decision.padEnd(7)} iou ${geo.meanIoU?.toFixed(3) ?? '-'} L${r.layers.length}/${b.layers.length} ${r.ms.toFixed(0)}ms ${r.why}`,
  )
}
writeFileSync(`out/synth-${level}-${part}${snap !== undefined ? '-snap' + snap : ''}.jsonl`, lines.join('\n') + '\n')

/** A layer without its effects: its own shape, for geometry. */
function bare(l: OutLayer): OutLayer {
  const props = { ...l.props, effects: [] }
  const white = { type: 'solid', color: '#FFFFFFFF' }
  props.fills = ((props.fills as unknown[]) ?? []).length ? [white] : []
  props.strokes = ((props.strokes as { width: number }[]) ?? []).map((s) => ({ ...s, paint: white }))
  return { ...l, props }
}

/** The colour a layer shows: its topmost fill's first colour, or its stroke's. */
function colourOf(l: OutLayer): string | null {
  const fills = (l.props.fills as { type: string; color?: string; stops?: { color: string }[] }[]) ?? []
  const f = fills[fills.length - 1]
  if (f?.type === 'solid') return f.color!
  if (f?.stops) return null
  const s = (l.props.strokes as { paint: { color?: string } }[]) ?? []
  return s[0]?.paint.color ?? null
}

/** Each true layer matched greedily to the made layer it overlaps most. */
function geometry(truth: OutLayer[], made: OutLayer[], w: number, h: number) {
  if (truth.length === 0) return { meanIoU: null, colourDE: null, pairs: [] as [number, number][] }
  const tc = truth.map((l) => coverage(ck, bare(l), w, h, 1, w, h))
  const mc = made.map((l) => coverage(ck, bare(l), w, h, 1, w, h))
  const cand: { t: number; m: number; iou: number }[] = []
  tc.forEach((t, i) => mc.forEach((m, j) => cand.push({ t: i, m: j, iou: softIoU(t, m) })))
  cand.sort((a, b) => b.iou - a.iou)
  const usedT = new Set<number>()
  const usedM = new Set<number>()
  const pairs: [number, number][] = []
  const ious = new Array(truth.length).fill(0)
  for (const c of cand) {
    if (usedT.has(c.t) || usedM.has(c.m) || c.iou <= 0) continue
    usedT.add(c.t)
    usedM.add(c.m)
    ious[c.t] = c.iou
    pairs.push([c.t, c.m])
  }
  const des: number[] = []
  for (const [t, m] of pairs) {
    const a = colourOf(truth[t]!)
    const b = colourOf(made[m]!)
    if (a && b) des.push(deltaE00(rgbToLab(...parseHex(a).rgb), rgbToLab(...parseHex(b).rgb)))
  }
  return {
    meanIoU: ious.reduce((s, v) => s + v, 0) / ious.length,
    colourDE: des.length ? des.reduce((s, v) => s + v, 0) / des.length : null,
    pairs,
  }
}

/**
 * Brand: a true layer filled with a kit colour wants its matched layer bound to that token; a
 * binding anywhere else (or to another token) is wrong. Near-miss colours must not bind.
 */
function brandCheck(b: SynthBlock, made: OutLayer[], pairs: [number, number][]) {
  let wanted = 0
  let right = 0
  let wrong = 0
  const kitByColour = new Map(b.kit.map((k) => [k.value.slice(0, 7).toUpperCase(), k.token]))
  const matchOf = new Map(pairs.map(([t, m]) => [m, t]))
  b.layers.forEach((l, t) => {
    const fills = (l.props.fills as { type: string; color?: string }[]) ?? []
    const f = fills[fills.length - 1]
    if (f?.type === 'solid' && kitByColour.has(f.color!.slice(0, 7).toUpperCase())) {
      wanted++
      const m = pairs.find((p) => p[0] === t)?.[1]
      if (m !== undefined && made[m]!.bindings?.fill === `brand:${kitByColour.get(f.color!.slice(0, 7).toUpperCase())}`)
        right++
    }
  })
  made.forEach((l, m) => {
    if (!l.bindings?.fill) return
    const t = matchOf.get(m)
    const tl = t === undefined ? undefined : b.layers[t]
    const fills = (tl?.props.fills as { type: string; color?: string }[] | undefined) ?? []
    const strokes = (tl?.props.strokes as { paint: { type: string; color?: string } }[] | undefined) ?? []
    const f = fills[fills.length - 1] ?? strokes[0]?.paint
    // A binding to the colour the true layer shows, fill or stroke, is right.
    const want = f?.type === 'solid' ? kitByColour.get(f.color!.slice(0, 7).toUpperCase()) : undefined
    if (!want || l.bindings.fill !== `brand:${want}`) wrong++
  })
  return { wanted, right, wrong }
}
