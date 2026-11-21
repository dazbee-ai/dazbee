// PROTOTYPE. Hand-judging sheets: block | Medium rebuilt, no numbers on them, so the judgement is
// blind; the scores go to out/judge/scores.json to be compared after.
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { drawLayers } from './draw.ts'
import { matchBlock, MEDIUM } from './match.ts'
import { decodeFile, makeImg, savePng, sheet } from './pixels.ts'
const ck = await loadCanvasKit()
const ADS = 'C:/Users/imkes/Desktop/ming-setup/test_ads'
mkdirSync('out/judge', { recursive: true })
const scores: Record<string, unknown>[] = []
for (const [i, item] of process.argv.slice(2).entries()) {
  const img = decodeFile(ck, `${ADS}/${item}`)
  const r = matchBlock(ck, img, MEDIUM)
  const z = Math.max(1, Math.min(4, Math.floor(200 / Math.max(img.w, img.h))))
  const big = (src: typeof img) => {
    const o = makeImg(src.w * z, src.h * z)
    for (let y = 0; y < o.h; y++)
      for (let x = 0; x < o.w; x++)
        o.d.set(
          src.d.subarray(
            (Math.floor(y / z) * src.w + Math.floor(x / z)) * 4,
            (Math.floor(y / z) * src.w + Math.floor(x / z)) * 4 + 4,
          ),
          (y * o.w + x) * 4,
        )
    return o
  }
  savePng(
    ck,
    sheet([big(img), drawLayers(ck, r.layers, img.w, img.h, z)], 16),
    `out/judge/${String(i + 1).padStart(2, '0')}.png`,
  )
  scores.push({
    n: i + 1,
    item,
    layers: r.layers.length,
    ssim: r.score?.ssim,
    deltaE: r.score?.deltaE,
    deltaEContent: r.score?.deltaEContent,
    why: r.why,
  })
}
writeFileSync('out/judge/scores.json', JSON.stringify(scores, null, 1))
