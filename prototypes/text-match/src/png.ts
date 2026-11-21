// PROTOTYPE. PNG files in and out as RGBA, 8 bits a channel.
import { readFileSync, writeFileSync } from 'node:fs'

import { decode, encode } from 'fast-png'

export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

export function readPng(path: string): Rgba {
  const png = decode(readFileSync(path))
  const { width, height } = png
  const src = png.data
  const data = new Uint8Array(width * height * 4)
  const ch = png.channels
  const scale = png.depth === 16 ? 1 / 257 : 1
  for (let i = 0; i < width * height; i++) {
    const g = (k: number) => Math.round(Number(src[i * ch + k]) * scale)
    if (ch >= 3) {
      data[i * 4] = g(0)
      data[i * 4 + 1] = g(1)
      data[i * 4 + 2] = g(2)
      data[i * 4 + 3] = ch === 4 ? g(3) : 255
    } else {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g(0)
      data[i * 4 + 3] = ch === 2 ? g(1) : 255
    }
  }
  return { width, height, data }
}

export function writePng(path: string, img: Rgba) {
  writeFileSync(path, encode({ width: img.width, height: img.height, data: img.data, channels: 4, depth: 8 }))
}
