// PROTOTYPE. Reads the DeltaX test ads: each ad's text blocks with their cut-out, reading, tilt and
// the ad's pixels behind them. The ads are data outside the repo and never committed.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Block } from './measure.ts'
import { type Rgba, readPng } from './png.ts'

export const TEST_ADS = 'C:\\Users\\imkes\\Desktop\\ming-setup\\test_ads'

export interface AdBlock {
  ad: string
  index: number
  element: string
  file: string
  /** x, y, width, height in the bucket's pixels, as the cutting step gives them. */
  rect: [number, number, number, number]
  /** The ad's pixels per bucket pixel. */
  scale: number
  lettering: string
  block: Block
}

export function adNames(): string[] {
  return readdirSync(TEST_ADS).sort()
}

export function loadAd(name: string): { blocks: AdBlock[]; ad: Rgba } {
  const dir = join(TEST_ADS, name)
  const meta = JSON.parse(readFileSync(join(dir, 'blocks.json'), 'utf8')) as {
    bucket: [number, number]
    source_size: [number, number]
    blocks: { file: string; rect: [number, number, number, number]; rotated_box: { angle: number } | null; element: string; kind: string }[]
  }
  const readings = JSON.parse(readFileSync(join(dir, 'readings.json'), 'utf8')) as Record<string, { text: string; lettering: string }>
  const ad = readPng(join(dir, 'ad.png'))
  const scale = meta.source_size[0] / meta.bucket[0]
  const blocks: AdBlock[] = []
  meta.blocks.forEach((b, index) => {
    if (b.kind !== 'text' || !readings[b.element]) return
    const rgba = readPng(join(dir, b.file))
    blocks.push({
      ad: name,
      index,
      element: b.element,
      file: b.file,
      rect: b.rect,
      scale,
      lettering: readings[b.element]!.lettering,
      block: {
        rgba,
        text: readings[b.element]!.text,
        angle: b.rotated_box?.angle ?? 0,
        behind: behind(ad, b.rect, scale, rgba.width, rgba.height),
      },
    })
  })
  return { blocks, ad }
}

/** The ad's pixels under a block, sampled at the block's own pixels. */
function behind(ad: Rgba, rect: [number, number, number, number], scale: number, width: number, height: number): Rgba {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(ad.width - 1, Math.max(0, Math.floor((rect[0] + x + 0.5) * scale)))
      const sy = Math.min(ad.height - 1, Math.max(0, Math.floor((rect[1] + y + 0.5) * scale)))
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = ad.data[(sy * ad.width + sx) * 4 + c]!
    }
  return { width, height, data }
}
