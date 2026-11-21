// PROTOTYPE. Scores the old worker's own answers with the shared rule: each answer's layers (its
// shapes regression's output, read as data) turned into Dazbee graphics, drawn by Dazbee's renderer
// at the block's size and scored exactly as ours are. Where the old format is unclear (a layer
// blur's radius; a gradient angle's zero), the reading that scores better for the old worker wins.
// Writes out/testads-old.jsonl. Usage: node src/score-old.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawLayers, type OutLayer } from './draw.ts'
import { decodeFile } from './pixels.ts'
import { ADS } from './paths.ts'
import { score, scoreV2 } from './score.ts'

interface OldLayer {
  name: string
  path: string
  left: number
  top: number
  width: number
  height: number
  angle: number
  fill: string
  fillGradient: { type: 'linear'; angle: number; colors: { offset: number; color: string }[] } | null
  fillOpacity: number
  stroke: string
  strokeWidth: number
  strokeLineCap: string
  strokeLineJoin: string
  strokeDashArray: string
  opacity: number
  shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null
  layerBlur: number | null
}

const RESULTS = 'out/old-worker/res/results'
const CONVERT = ['shape', 'graphic', 'background']

/** #rgb, #rrggbb or #rrggbbaa as #RRGGBBAA. */
const colour = (c: string) => {
  const h = c.replace('#', '')
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h
  return `#${(full.length === 6 ? full + 'ff' : full).toUpperCase()}`
}

/** One old layer as a Dazbee graphic in the block's pixels: ad pixels scaled to the bucket, less the block's corner. */
export function toDazbee(l: OldLayer, sx: number, sy: number, ox: number, oy: number, blurTimes: number): OutLayer {
  const w = l.width * sx
  const h = l.height * sy
  const x = l.left * sx - ox - w / 2
  const y = l.top * sy - oy - h / 2
  const fills: Record<string, unknown>[] = []
  if (l.fillGradient) {
    // CSS angles: 0° points up, turning clockwise; the line spans the box's corners.
    const a = (l.fillGradient.angle * Math.PI) / 180
    const d = [Math.sin(a), -Math.cos(a)]
    const L = Math.abs(w * d[0]!) + Math.abs(h * d[1]!)
    const gx = (w * d[0]!) / L
    const gy = (h * d[1]!) / L
    const g2 = gx * gx + gy * gy
    const from = { x: 0.5 - gx / g2 / 2, y: 0.5 - gy / g2 / 2 }
    fills.push({
      type: 'linear',
      from,
      to: { x: from.x + gx / g2, y: from.y + gy / g2 },
      stops: l.fillGradient.colors.map((c) => ({ offset: c.offset, color: colour(c.color) })),
      ...(l.fillOpacity < 1 ? { opacity: l.fillOpacity } : {}),
    })
  } else if (l.fill)
    fills.push({ type: 'solid', color: colour(l.fill), ...(l.fillOpacity < 1 ? { opacity: l.fillOpacity } : {}) })
  const scale = (sx + sy) / 2
  const strokes =
    l.stroke && l.strokeWidth > 0
      ? [
          {
            paint: { type: 'solid', color: colour(l.stroke) },
            width: l.strokeWidth * scale,
            align: 'center',
            cap: l.strokeLineCap === 'round' ? 'round' : 'butt',
            join: l.strokeLineJoin === 'round' ? 'round' : 'miter',
            ...(l.strokeDashArray
              ? {
                  dashes: l.strokeDashArray
                    .split(/[ ,]+/)
                    .map(Number)
                    .map((v) => v * scale),
                }
              : {}),
          },
        ]
      : []
  const effects: Record<string, unknown>[] = []
  if (l.shadow)
    effects.push({
      type: 'dropShadow',
      x: l.shadow.offsetX * sx,
      y: l.shadow.offsetY * sy,
      blur: l.shadow.blur * scale,
      spread: 0,
      color: colour(l.shadow.color),
    })
  if (l.layerBlur) effects.push({ type: 'layerBlur', radius: l.layerBlur * scale * blurTimes })
  return {
    type: 'graphic',
    name: l.name,
    props: {
      x,
      y,
      width: w,
      height: h,
      rotation: l.angle,
      opacity: l.opacity,
      shape: { kind: 'path', d: l.path, fillRule: 'evenodd', drawnIn: { width: l.width, height: l.height } },
      fills,
      strokes,
      effects,
    },
  }
}

if (import.meta.url === `file:///${process.argv[1]!.replace(/\\/g, '/')}`) {
  const ck = await loadCanvasKit()
  const lines: string[] = []
  for (const file of readdirSync(RESULTS).sort()) {
    const ad = file.replace('.json', '')
    const answer = JSON.parse(readFileSync(`${RESULTS}/${file}`, 'utf8')) as {
      blocks: { index: number; element: string; keep_as_image: boolean; why: string; layers: OldLayer[] }[]
    }
    const meta = JSON.parse(readFileSync(`${ADS}/${ad}/blocks.json`, 'utf8')) as {
      bucket: number[]
      source_size: number[]
      blocks: { file: string; kind: string; rect: number[]; element: string }[]
    }
    const sx = meta.bucket[0]! / meta.source_size[0]!
    const sy = meta.bucket[1]! / meta.source_size[1]!
    for (const b of answer.blocks) {
      const mb = meta.blocks[b.index]!
      if (!CONVERT.includes(mb.kind)) continue
      const img = decodeFile(ck, `${ADS}/${ad}/${mb.file}`)
      const t0 = performance.now()
      let best: { v1: ReturnType<typeof score>; v2: ReturnType<typeof scoreV2>; blurTimes: number } | null = null
      if (!b.keep_as_image) {
        for (const blurTimes of [1, 2]) {
          const layers = b.layers.map((l) => toDazbee(l, sx, sy, mb.rect[0]!, mb.rect[1]!, blurTimes))
          const made = drawLayers(ck, layers, img.w, img.h)
          const v1 = score(img, made)
          const v2 = scoreV2(img, made)
          if (!best || v1.ssim - v1.deltaE / 50 > best.v1.ssim - best.v1.deltaE / 50) best = { v1, v2, blurTimes }
          if (!b.layers.some((l) => l.layerBlur)) break
        }
      }
      lines.push(
        JSON.stringify({
          ad,
          element: b.element,
          file: mb.file,
          kind: mb.kind,
          oldDecision: b.keep_as_image ? 'picture' : 'shapes',
          why: b.why,
          decision: best?.v1.same ? 'shapes' : 'picture',
          decisionV2: best?.v2.same ? 'shapes' : 'picture',
          ssim: best?.v1.ssim ?? null,
          deltaE: best?.v1.deltaE ?? null,
          ssimV2: best?.v2.ssim ?? null,
          deltaEV2: best?.v2.deltaE ?? null,
          lostV2: best?.v2.lost ?? null,
          layers: b.layers.length,
          ms: performance.now() - t0,
          blurTimes: best?.blurTimes ?? null,
        }),
      )
    }
  }
  writeFileSync('out/testads-old.jsonl', lines.join('\n') + '\n')
  console.log('blocks', lines.length)
}
