// PROTOTYPE. Agreement with the 20 blind hand judgements (round 1), read from the final runs:
// Medium's and the ladder's decisions under each rule.
import { load } from './summary.ts'

const items = [
  'roamwick/block_14.png',
  'fresh_realestate_haven/block_09.png',
  'fresh_diwali_mithaas/block_06.png',
  'fresh_festival_lumen/block_11.png',
  'car_vantra/block_06.png',
  'loomhaven/block_07.png',
  'pizza_napoli/block_06.png',
  'morrowmere/block_07.png',
  'skillgrove/block_18.png',
  'fresh_wine_vinea/block_08.png',
  'fresh_perfume_noir/block_06.png',
  'lipstick_rouge/block_07.png',
  'food_delivery/block_07.png',
  'bakery_crumb/block_06.png',
  'grocery_weekly/block_08.png',
  'fintech_coinly/block_11.png',
  'hushvale/block_13.png',
  'fresh_bank_nimbus/block_08.png',
  'toys_bloom/block_09.png',
  'fresh_kids_brightminds/block_09.png',
]
const eye = 'YYYYYNYYNYNNNYYNNNYY'
for (const rule of ['v1', 'v2']) {
  const suffix = rule === 'v2' ? '-v2' : ''
  const L = new Map(load(`out/deltax-light${suffix}.jsonl`).map((r) => [`${r.ad}/${r.file}`, r]))
  const M = new Map(load(`out/deltax-medium${suffix}.jsonl`).map((r) => [`${r.ad}/${r.file}`, r]))
  let med = 0
  let lad = 0
  const off: string[] = []
  items.forEach((k, i) => {
    const l = L.get(k)!
    const m = M.get(k)!
    const ladder = (l.decision === 'shapes' && l.layers <= 2) || m.decision === 'shapes' ? 'shapes' : 'picture'
    const want = eye[i] === 'Y' ? 'shapes' : 'picture'
    if (m.decision === want) med++
    if (ladder === want) lad++
    else off.push(`${i + 1} ${k} (eye ${want})`)
  })
  console.log(`${rule}: Medium agrees ${med}/20, ladder ${lad}/20; ladder differs on ${off.join('; ')}`)
}
