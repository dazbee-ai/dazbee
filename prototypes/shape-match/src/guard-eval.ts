// PROTOTYPE. The photo guard, old against new, read from the runs (each answer carries its photo
// score): the ladder without block kinds, with and without the new guard (a shapes answer whose
// score is at or over the bar counts as a picture, and a guarded Light answer falls through to
// Medium). Per set and rule: photos wrongly made shapes, and shapes wrongly kept as pictures.
import { existsSync, readdirSync } from 'node:fs'

import { ADS, isFrozenAd } from './paths.ts'
import { type Features, loadGuard, photoScore } from './photo.ts'
import { load } from './summary.ts'

type Row = ReturnType<typeof load>[number]
const guard = loadGuard()
if (!guard) throw new Error('train the guard first: node src/train-photo.ts')
const allAds = readdirSync(ADS).sort()
const CONVERT = ['shape', 'graphic', 'background']
const PICTURE = ['photo', 'cutout']

// Each score is recomputed from the recorded measures with the trained guard, whatever guard file the run saw.
const shapesOK = (r: Row, guarded: boolean) =>
  r.decision === 'shapes' && (!guarded || !r.photoF || photoScore(r.photoF as Features, guard) < guard.threshold)

function ladder(l: Row, m: Row, guarded: boolean): Row {
  const lightOK = shapesOK(l, guarded)
  const mediumOK = shapesOK(m, guarded)
  const pick = lightOK && l.layers <= 2 ? l : mediumOK && (!lightOK || m.layers < l.layers) ? m : lightOK ? l : m
  return { ...pick, decision: shapesOK(pick, guarded) ? 'shapes' : 'picture' }
}

interface Set {
  name: string
  files: (rule: string, level: string) => string
  key: (r: Row) => string
  truth: (r: Row) => 'shapes' | 'picture' | null
  keep: (r: Row) => boolean
}
const v2 = (rule: string) => (rule === 'v2' ? '-v2' : '')
const sets: Set[] = [
  {
    name: 'DeltaX development ads (32)',
    files: (rule, lv) => `out/deltax-${lv}${v2(rule)}.jsonl`,
    key: (r) => `${r.ad}/${r.file}`,
    truth: (r) => (PICTURE.includes(String(r.kind)) ? 'picture' : CONVERT.includes(String(r.kind)) ? 'shapes' : null),
    keep: (r) => !isFrozenAd(allAds, String(r.ad)),
  },
  {
    name: 'DeltaX frozen ads (16)',
    files: (rule, lv) => `out/deltax-${lv}${v2(rule)}.jsonl`,
    key: (r) => `${r.ad}/${r.file}`,
    truth: (r) => (PICTURE.includes(String(r.kind)) ? 'picture' : CONVERT.includes(String(r.kind)) ? 'shapes' : null),
    keep: (r) => isFrozenAd(allAds, String(r.ad)),
  },
  {
    name: 'synthetic set 1, development third',
    files: (rule, lv) => `out/synth-${lv}${v2(rule)}-all.jsonl`,
    key: (r) => String(r.id),
    truth: (r) => r.truth as 'shapes' | 'picture',
    keep: (r) => Number(r.id) % 3 === 0,
  },
  {
    name: 'synthetic set 1, held-out part',
    files: (rule, lv) => `out/synth-${lv}${v2(rule)}-all.jsonl`,
    key: (r) => String(r.id),
    truth: (r) => r.truth as 'shapes' | 'picture',
    keep: (r) => Number(r.id) % 3 !== 0,
  },
  {
    name: 'synthetic set 2 (unseen)',
    files: (rule, lv) => `out/synth2-${lv}${v2(rule)}-all.jsonl`,
    key: (r) => String(r.id),
    truth: (r) => r.truth as 'shapes' | 'picture',
    keep: () => true,
  },
  {
    name: 'Crello sample, clean (image elements as pictures)',
    files: (rule, lv) => `out/crello-${lv}-clean${v2(rule)}.jsonl`,
    key: (r) => String(r.key),
    truth: (r) => (r.type === 'image element' ? 'picture' : 'shapes'),
    keep: () => true,
  },
]

console.log(`Bar: photo score ≥ ${guard.threshold.toFixed(4)}\n`)
console.log(
  '| Set | Rule | Photos made shapes, old guard | new guard | Shapes kept as pictures, old guard | new guard | Shapes that look the same, old | new |',
)
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const s of sets) {
  for (const rule of ['v1', 'v2']) {
    if (!existsSync(s.files(rule, 'light')) || !existsSync(s.files(rule, 'medium'))) continue
    const L = load(s.files(rule, 'light')).filter(s.keep)
    const M = new Map(
      load(s.files(rule, 'medium'))
        .filter(s.keep)
        .map((r) => [s.key(r), r]),
    )
    const count = (guarded: boolean) => {
      let photoShapes = 0
      let photos = 0
      let shapesLost = 0
      let shapes = 0
      for (const l of L) {
        const t = s.truth(l)
        if (!t) continue
        const d = ladder(l, M.get(s.key(l))!, guarded).decision
        if (t === 'picture') {
          photos++
          if (d === 'shapes') photoShapes++
        } else {
          shapes++
          if (d === 'picture') shapesLost++
        }
      }
      return { photoShapes, photos, shapesLost, shapes }
    }
    const a = count(false)
    const b = count(true)
    console.log(
      `| ${s.name} | ${rule} | ${a.photoShapes}/${a.photos} | ${b.photoShapes}/${b.photos} | ${a.shapesLost}/${a.shapes} | ${b.shapesLost}/${b.shapes} | ${a.shapes - a.shapesLost} | ${b.shapes - b.shapesLost} |`,
    )
  }
}
