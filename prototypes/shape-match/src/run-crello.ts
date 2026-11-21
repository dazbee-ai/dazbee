// PROTOTYPE. The Crello outside benchmark: each picked element (shape elements and coloured
// backgrounds should become shapes; image elements must stay pictures) matched by Light or Medium,
// clean or with the synthetic set's all-at-once AI degradation. Scored by the active rule (RULE=v1|v2),
// with both rules' numbers kept; IoU of the drawn layers' alpha against the clean element's alpha;
// colour error of the layers' colours against the element's palette. Nothing here is tuned on Crello.
// Usage: node src/run-crello.ts light|medium clean|ai   → out/crello-<level>-<clean|ai>[-v2].jsonl
import { readFileSync, writeFileSync } from 'node:fs'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { deltaE00, type Lab, rgbToLab } from './colour.ts'
import { drawLayers, type OutLayer } from './draw.ts'
import { softIoU } from './fit.ts'
import { LIGHT, matchBlock, MEDIUM } from './match.ts'
import { decodeFile } from './pixels.ts'
import { degrade } from './synth.ts'

const ck = await loadCanvasKit()
const level = process.argv[2] === 'medium' ? 'medium' : 'light'
const variant = process.argv[3] === 'ai' ? 'ai' : 'clean'
const cfg = level === 'medium' ? MEDIUM : LIGHT
const index = JSON.parse(readFileSync('data/crello/index.json', 'utf8')) as {
  key: string
  type: string
  palette: string[]
  file: string
}[]
const lines: string[] = []
for (const e of index) {
  const clean = decodeFile(ck, `data/crello/${e.file}`)
  const img = variant === 'ai' ? degrade(ck, clean, 'ai') : clean
  const r = matchBlock(ck, img, cfg)
  let iou: number | null = null
  let paletteDE: number | null = null
  if (r.layers.length) {
    const made = drawLayers(ck, r.layers, img.w, img.h)
    const a = new Float32Array(img.w * img.h)
    const b = new Float32Array(img.w * img.h)
    for (let i = 0; i < a.length; i++) {
      a[i] = clean.d[i * 4 + 3]!
      b[i] = made.d[i * 4 + 3]!
    }
    iou = softIoU(a, b)
    const pal = e.palette.map(parseRgba).filter((c): c is Lab => c !== null)
    const cols = r.layers.flatMap(coloursOf)
    if (pal.length && cols.length)
      paletteDE = cols.reduce((s, c) => s + Math.min(...pal.map((p) => deltaE00(c, p))), 0) / cols.length
  }
  lines.push(
    JSON.stringify({
      key: e.key,
      type: e.type,
      truth: e.type === 'image element' ? 'picture' : 'shapes',
      w: img.w,
      h: img.h,
      decision: r.decision,
      why: r.why,
      ssim: r.score?.ssim ?? null,
      deltaE: r.score?.deltaE ?? null,
      ssimV2: r.score?.v2?.ssim ?? null,
      deltaEV2: r.score?.v2?.deltaE ?? null,
      lostV2: r.score?.v2?.lost ?? null,
      layers: r.layers.length,
      kinds: r.layers.map((l) => (l.props.shape as { kind: string }).kind),
      iou,
      paletteDE,
      ms: r.ms,
      photoP: r.photo?.p ?? null,
      photoF: r.photo?.features ?? null,
    }),
  )
  ;(globalThis as { gc?: () => void }).gc?.()
}
writeFileSync(`out/crello-${level}-${variant}${process.env.RULE === 'v2' ? '-v2' : ''}.jsonl`, lines.join('\n') + '\n')
console.log('elements', lines.length)

/** rgba(r, g, b, a) or #rrggbb as Lab; null when unreadable. */
function parseRgba(c: string): Lab | null {
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  if (m) return rgbToLab(Number(m[1]), Number(m[2]), Number(m[3]))
  const h = c.match(/^#([0-9a-f]{6})/i)
  return h
    ? rgbToLab(parseInt(h[1]!.slice(0, 2), 16), parseInt(h[1]!.slice(2, 4), 16), parseInt(h[1]!.slice(4, 6), 16))
    : null
}

/** The colours a layer paints: solid fills, gradient stops and stroke colours. */
function coloursOf(l: OutLayer): Lab[] {
  const out: Lab[] = []
  const add = (hex?: string) =>
    hex &&
    out.push(rgbToLab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)))
  for (const f of (l.props.fills as { color?: string; stops?: { color: string }[] }[]) ?? []) {
    add(f.color)
    for (const s of f.stops ?? []) add(s.color)
  }
  for (const s of (l.props.strokes as { paint: { color?: string } }[]) ?? []) add(s.paint.color)
  for (const c of l.children ?? []) out.push(...coloursOf(c))
  return out
}
