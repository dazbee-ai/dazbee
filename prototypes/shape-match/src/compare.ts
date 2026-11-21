// PROTOTYPE. Light and Medium against the old worker's shapes-or-picture answers
// (shapes_baseline.json, read as data), and per-ad times: ours summed over each ad's convert blocks,
// the old worker's as its shapes regression printed them on one core.
import { readFileSync } from 'node:fs'

import { load, q } from './summary.ts'

const BASE = process.env.OLD_WORKER_BASELINE ?? '../../../dx-stunnr-text-worker/shapes_baseline.json'
const baseline = JSON.parse(readFileSync(BASE, 'utf8')) as {
  ads: Record<string, { element: string; shapes: boolean; names: string[]; why: string }[]>
}
const CONVERT = ['shape', 'graphic', 'background']

for (const level of ['light', 'medium']) {
  const rows = load(`out/testads-${level}.jsonl`).filter((r) => CONVERT.includes(r.kind as string))
  let both = 0,
    agree = 0,
    oldShapesWePicture = 0,
    oldPictureWeShapes = 0,
    oldShapes = 0,
    weShapes = 0
  const oldLayers: number[] = []
  const ourLayers: number[] = []
  for (const [ad, blocks] of Object.entries(baseline.ads)) {
    for (const b of blocks) {
      const r = rows.find((x) => x.ad === ad && x.element === b.element)
      if (!r) continue
      both++
      const ours = r.decision === 'shapes'
      if (b.shapes) oldShapes++
      if (ours) weShapes++
      if (ours === b.shapes) agree++
      else if (b.shapes) oldShapesWePicture++
      else oldPictureWeShapes++
      if (ours && b.shapes) {
        oldLayers.push(b.names.length)
        ourLayers.push(r.layers)
      }
    }
  }
  const perAd = new Map<string, number>()
  for (const r of rows) perAd.set(r.ad as string, (perAd.get(r.ad as string) ?? 0) + r.ms)
  const ads = [...perAd.values()]
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
  console.log(
    JSON.stringify({
      level,
      blocks: both,
      agree: `${agree}/${both}`,
      oldShapes,
      weShapes,
      oldShapesWePicture,
      oldPictureWeShapes,
      layersWhereBothShapes: { old: mean(oldLayers).toFixed(2), ours: mean(ourLayers).toFixed(2), n: oldLayers.length },
      perAdMs: { median: q(ads, 0.5).toFixed(0), p95: q(ads, 0.95).toFixed(0), max: Math.max(...ads).toFixed(0) },
      perBlockMs: {
        median: q(
          rows.map((r) => r.ms),
          0.5,
        ).toFixed(0),
        p95: q(
          rows.map((r) => r.ms),
          0.95,
        ).toFixed(0),
      },
    }),
  )
}

// The old worker's own per-ad times, from its regression's output.
try {
  const out = readFileSync('out/old-worker/stdout.txt', 'utf8')
  const secs = [...out.matchAll(/blocks became shapes, \d+ layers, ([\d.]+) s/g)].map((m) => Number(m[1]))
  console.log(
    JSON.stringify({
      old: { ads: secs.length, perAdS: { median: q(secs, 0.5), p95: q(secs, 0.95), max: Math.max(...secs) } },
    }),
  )
} catch {
  console.log('no old worker run')
}
