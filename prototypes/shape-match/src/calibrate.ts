// PROTOTYPE. Rule v2 on the 20 blind-judged blocks: Medium's answer scored with the blur, full-size
// SSIM and the lost share at several ΔE bars, against the hand judgement.
import { loadCanvasKit } from '@dazbee/renderer/node'
import { drawLayers } from './draw.ts'
import { matchBlock, MEDIUM } from './match.ts'
import { ADS } from './paths.ts'
import { decodeFile, over } from './pixels.ts'
import { blur1, pairDeltaE, score, scoreV2 } from './score.ts'
const ck = await loadCanvasKit()
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
const judged = 'YYYYYNYYNYNNNYYNNNYY'
for (const [i, item] of items.entries()) {
  const img = decodeFile(ck, `${ADS}/${item}`)
  const r = matchBlock(ck, img, MEDIUM)
  const made = drawLayers(ck, r.layers, img.w, img.h)
  const v1 = score(img, made)
  const v2 = scoreV2(img, made)
  const shares = [8, 10, 15, 20, 25].map((t) => {
    let worst = 0
    for (const bg of [
      [255, 255, 255],
      [0, 0, 0],
    ] as [number, number, number][]) {
      const a = blur1(over(img, bg), img.w, img.h)
      const b = blur1(over(made, bg), img.w, img.h)
      let far = 0
      for (let p = 0; p < img.w * img.h; p++)
        if (pairDeltaE(a[p * 3]!, a[p * 3 + 1]!, a[p * 3 + 2]!, b[p * 3]!, b[p * 3 + 1]!, b[p * 3 + 2]!) > t) far++
      worst = Math.max(worst, far / (img.w * img.h))
    }
    return worst
  })
  console.log(
    JSON.stringify({
      n: i + 1,
      item,
      eye: judged[i],
      v1: [+v1.ssim.toFixed(3), +v1.deltaE.toFixed(2)],
      v2: [+v2.ssim.toFixed(3), +v2.deltaE.toFixed(2)],
      lostShare_8_10_15_20_25: shares.map((s) => +(100 * s).toFixed(2)),
    }),
  )
}
