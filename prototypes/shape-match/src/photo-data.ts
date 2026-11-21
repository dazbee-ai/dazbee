// PROTOTYPE. More photos for training the photo guard, made from development data only: every photo
// and cutout block of the 32 development DeltaX ads placed small on a white canvas, on a flat colour,
// and cropped, at sizes and places from a seeded generator. Written as a synthetic-style set
// (truth: picture) to data/phototrain, so run-synth.ts runs it like any synthetic set.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { ADS, isFrozenAd } from './paths.ts'
import { decodeFile, type Img, makeImg, resize, savePng } from './pixels.ts'

const OUT = 'data/phototrain'
const ck = await loadCanvasKit()
let seed = 777
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
mkdirSync(OUT, { recursive: true })
const allAds = readdirSync(ADS).sort()
const index: unknown[] = []
let id = 0
const write = (img: Img) => {
  savePng(ck, img, `${OUT}/${id}.png`)
  index.push({
    id,
    family: 'photo-aug',
    degradation: 'clean',
    brand: 'none',
    kit: [],
    truth: 'picture',
    layers: [],
    tokens: [],
    w: img.w,
    h: img.h,
    dev: true,
  })
  id++
}
for (const ad of allAds.filter((a) => !isFrozenAd(allAds, a))) {
  const meta = JSON.parse(readFileSync(`${ADS}/${ad}/blocks.json`, 'utf8')) as {
    blocks: { file: string; kind: string }[]
  }
  for (const b of meta.blocks.filter((x) => ['photo', 'cutout'].includes(x.kind))) {
    const src = decodeFile(ck, `${ADS}/${ad}/${b.file}`)
    // Small on a canvas: the canvas 1.5 to 3 times the product, white or a flat colour.
    for (const bg of [
      [255, 255, 255],
      [Math.floor(rand() * 255), Math.floor(rand() * 255), Math.floor(rand() * 255)],
    ] as [number, number, number][]) {
      const scale = Math.min(1, 320 / Math.max(src.w, src.h))
      const p = resize(src, Math.max(8, Math.round(src.w * scale)), Math.max(8, Math.round(src.h * scale)))
      const f = 1.5 + rand() * 1.5
      const canvas = makeImg(Math.round(p.w * f), Math.round(p.h * f))
      for (let i = 0; i < canvas.w * canvas.h; i++) canvas.d.set([...bg, 1], i * 4)
      const ox = Math.floor(rand() * (canvas.w - p.w))
      const oy = Math.floor(rand() * (canvas.h - p.h))
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++) {
          const s = (y * p.w + x) * 4
          const o = ((y + oy) * canvas.w + x + ox) * 4
          const a = p.d[s + 3]!
          for (let c = 0; c < 3; c++) canvas.d[o + c] = p.d[s + c]! * a + canvas.d[o + c]! * (1 - a)
        }
      write(canvas)
    }
    // A crop of 40 to 70 % of each side, at most 320 px on its long side.
    const cw = Math.round(src.w * (0.4 + rand() * 0.3))
    const chh = Math.round(src.h * (0.4 + rand() * 0.3))
    const cx = Math.floor(rand() * (src.w - cw))
    const cy = Math.floor(rand() * (src.h - chh))
    const crop = makeImg(cw, chh)
    for (let y = 0; y < chh; y++)
      crop.d.set(src.d.subarray(((y + cy) * src.w + cx) * 4, ((y + cy) * src.w + cx + cw) * 4), y * cw * 4)
    const k = Math.min(1, 320 / Math.max(cw, chh))
    write(resize(crop, Math.max(8, Math.round(cw * k)), Math.max(8, Math.round(chh * k))))
  }
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index))
console.log('photo training blocks', id)
