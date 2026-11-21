// PROTOTYPE. Side-by-side sheets: block | Light rebuilt | Medium rebuilt, each captioned with its
// decision, layers and score, drawn by Dazbee's renderer (captions in the Noto Sans Dazbee ships).
// Usage: node src/examples.ts <outdir> ad/block_NN.png ...   (or synth:<id>)
import { mkdirSync } from 'node:fs'

import { loadFontFiles } from '@dazbee/fonts/node'
import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawLayers } from './draw.ts'
import { LIGHT, matchBlock, MEDIUM, type Result } from './match.ts'
import { decodeFile, fromBytes, type Img, makeImg, savePng, sheet } from './pixels.ts'

const ck = await loadCanvasKit()
const fonts = loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes }))
const ADS = process.env.DELTAX_ADS ?? '../../../../ming-setup/test_ads'

export function caption(text: string, width: number): Img {
  const w = Math.max(60, Math.ceil(width))
  const design = {
    meta: { designId: 'c', name: 'c' },
    pages: { p: { name: 'p', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'f',
        width: w,
        height: 34,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFFFF' }],
        order: 'a0',
      },
    },
    nodes: {
      t: {
        type: 'text',
        parentId: 'f',
        link: 't',
        index: 'a0',
        name: 'caption',
        props: {
          x: 2,
          y: 2,
          width: w - 4,
          height: 30,
          text,
          boxMode: 'fixed',
          style: { fontFamily: 'Noto Sans', fontSize: 11, color: '#222222FF' },
        },
      },
    },
  }
  const px = renderPixels(ck, design, 'f', { fonts, fallbackFamilies: ['Noto Sans'], images: {} })
  return fromBytes(px.width, px.height, px.pixels)
}

/** Pictures stacked top to bottom, left aligned. */
export function stack(imgs: Img[]): Img {
  const w = Math.max(...imgs.map((i) => i.w))
  const h = imgs.reduce((s, i) => s + i.h, 0)
  const out = makeImg(w, h)
  for (let i = 0; i < w * h; i++) out.d.set([255, 255, 255, 1], i * 4)
  let oy = 0
  for (const img of imgs) {
    for (let y = 0; y < img.h; y++) out.d.set(img.d.subarray(y * img.w * 4, (y + 1) * img.w * 4), (oy + y) * w * 4)
    oy += img.h
  }
  return out
}

const describe = (name: string, r: Result) =>
  `${name}: ${r.decision === 'shapes' ? 'shapes' : 'picture'}, ${r.layers.length} layer${r.layers.length === 1 ? '' : 's'}` +
  (r.score ? `  SSIM ${r.score.ssim.toFixed(3)} ΔE ${r.score.deltaE.toFixed(2)}` : `  (${r.why})`)

export function exampleSheet(img: Img, label: string): Img {
  const light = matchBlock(ck, img, LIGHT)
  const medium = matchBlock(ck, img, MEDIUM)
  // Small blocks are shown three times larger, so their edges can be seen.
  const zoom = Math.max(1, Math.min(3, Math.floor(160 / Math.max(img.w, img.h))))
  const show = (layers: Result['layers'] | null) =>
    layers ? drawLayers(ck, layers, img.w, img.h, zoom) : zoomImg(img, zoom)
  const cols = [show(null), show(light.layers), show(medium.layers)]
  const colW = Math.max(cols[0]!.w, 230)
  const caps = [
    caption(`${label}  ${img.w}×${img.h}`, colW),
    caption(describe('Light', light), colW),
    caption(describe('Medium', medium), colW),
  ]
  const padded = cols.map((c, i) => stack([caps[i]!, c]))
  return sheet(padded, 12)
}

function zoomImg(img: Img, z: number): Img {
  if (z === 1) return img
  const out = makeImg(img.w * z, img.h * z)
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++)
      out.d.set(
        img.d.subarray(
          (Math.floor(y / z) * img.w + Math.floor(x / z)) * 4,
          (Math.floor(y / z) * img.w + Math.floor(x / z)) * 4 + 4,
        ),
        (y * out.w + x) * 4,
      )
  return out
}

if (import.meta.url === `file:///${process.argv[1]!.replace(/\\/g, '/')}`) {
  const [dir, ...items] = process.argv.slice(2)
  mkdirSync(dir!, { recursive: true })
  for (const [i, item] of items.entries()) {
    const synth = item.startsWith('synth:')
    const img = decodeFile(ck, synth ? `data/synth/${item.slice(6)}.png` : `${ADS}/${item}`)
    const name = synth ? `synth-${item.slice(6)}` : item.replace('/', '_').replace('.png', '')
    savePng(
      ck,
      exampleSheet(img, synth ? item : item.replace('.png', '')),
      `${dir}/${String(i + 1).padStart(2, '0')}-${name}.png`,
    )
    console.log('wrote', name)
  }
}
