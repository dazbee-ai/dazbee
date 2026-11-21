// PROTOTYPE. Trains the photo guard on development data only: the 32 development test ads (their
// photo and cutout blocks against their shape, graphic and background blocks, labelled by the ads'
// own kinds), the same ads' photos and cutouts placed small on canvases and cropped
// (src/photo-data.ts), and the synthetic set's development third (its photo-like and render blocks against its
// shape blocks), from the shared-rule runs of both Light and Medium. Logistic regression on the
// standardised measures, classes weighted equally; the bar is the highest score among development
// shape answers that looked the same, so none of them is lost. Writes src/photo-guard.json.
import { readdirSync, writeFileSync } from 'node:fs'

import { ADS, isFrozenAd } from './paths.ts'
import { FEATURES, type Features, type Guard, photoScore } from './photo.ts'
import { load } from './summary.ts'

type Row = ReturnType<typeof load>[number]
const allAds = readdirSync(ADS).sort()
const samples: { x: number[]; y: number; accepted: boolean }[] = []
const add = (r: Row, y: number) => {
  const f = r.photoF as Features | null
  if (!f) return
  samples.push({ x: FEATURES.map((k) => f[k]), y, accepted: r.decision === 'shapes' })
}
for (const level of ['light', 'medium']) {
  for (const r of load(`out/testads-${level}.jsonl`)) {
    if (isFrozenAd(allAds, String(r.ad))) continue
    if (['photo', 'cutout'].includes(String(r.kind))) add(r, 1)
    else if (['shape', 'graphic', 'background'].includes(String(r.kind))) add(r, 0)
  }
  // Development photos and cutouts placed small on canvases and cropped (src/photo-data.ts).
  for (const r of load(`out/phototrain-${level}-all.jsonl`)) add(r, 1)
  for (const r of load(`out/synth-${level}-all.jsonl`)) {
    if (Number(r.id) % 3 !== 0) continue
    add(r, r.truth === 'picture' ? 1 : 0)
  }
}
const d = FEATURES.length
const mean = FEATURES.map((_, i) => samples.reduce((a, s) => a + s.x[i]!, 0) / samples.length)
const std = FEATURES.map(
  (_, i) => Math.sqrt(samples.reduce((a, s) => a + (s.x[i]! - mean[i]!) ** 2, 0) / samples.length) || 1,
)
const z = samples.map((s) => s.x.map((v, i) => (v - mean[i]!) / std[i]!))
const pos = samples.filter((s) => s.y === 1).length
const neg = samples.length - pos
const weight = (y: number) => (y === 1 ? samples.length / (2 * pos) : samples.length / (2 * neg))
let w = new Array(d).fill(0)
let b = 0
for (let it = 0; it < 4000; it++) {
  const gw = new Array(d).fill(0)
  let gb = 0
  samples.forEach((s, j) => {
    const p = 1 / (1 + Math.exp(-(b + z[j]!.reduce((a, v, i) => a + v * w[i]!, 0))))
    const e = (p - s.y) * weight(s.y)
    z[j]!.forEach((v, i) => (gw[i] += e * v))
    gb += e
  })
  w = w.map((v, i) => v - 0.1 * (gw[i]! / samples.length + 0.01 * v))
  b -= 0.1 * (gb / samples.length)
}
const guard: Guard = { mean, std, weights: w, bias: b, threshold: 1 }
const scores = samples.map((s) =>
  photoScore(Object.fromEntries(FEATURES.map((k, i) => [k, s.x[i]!])) as Features, guard),
)
const keep = samples.map((s, j) => ({ ...s, p: scores[j]! }))
guard.threshold = Math.max(...keep.filter((s) => s.y === 0 && s.accepted).map((s) => s.p)) + 1e-6
const caught = keep.filter((s) => s.y === 1 && s.accepted && s.p >= guard.threshold).length
const shapedPhotos = keep.filter((s) => s.y === 1 && s.accepted).length
// What other bars would cost and catch on development data (reported, not used).
const good = keep
  .filter((s) => s.y === 0 && s.accepted)
  .map((s) => s.p)
  .sort((a, b) => a - b)
for (const share of [0.99, 0.98, 0.95]) {
  const t = good[Math.floor(share * (good.length - 1))]! + 1e-6
  console.log(
    `bar at the ${share * 100}th percentile of good shape answers (${t.toFixed(4)}): loses ${good.filter((p) => p >= t).length}/${good.length} shape answers, stops ${keep.filter((s) => s.y === 1 && s.accepted && s.p >= t).length}/${shapedPhotos} photo answers`,
  )
}
writeFileSync('src/photo-guard.json', JSON.stringify(guard, null, 1))
console.log(
  `samples ${samples.length} (photos ${pos}, shapes ${neg}); weights ${FEATURES.map((k, i) => `${k} ${w[i]!.toFixed(2)}`).join(', ')}; threshold ${guard.threshold.toFixed(4)}; development photo answers that passed the rule and the guard now stops: ${caught}/${shapedPhotos}`,
)
