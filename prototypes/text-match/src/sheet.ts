// PROTOTYPE. Side-by-side pictures: each RGBA put on the block's background, left to right, 8 px apart.
import type { Rgba } from './png.ts'

export function sideBySide(images: Rgba[], background: readonly number[]): Rgba {
  const gap = 8
  const width = images.reduce((s, i) => s + i.width, 0) + gap * (images.length + 1)
  const height = Math.max(...images.map((i) => i.height)) + 2 * gap
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([200, 200, 200, 255], i * 4)
  let x0 = gap
  for (const img of images) {
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4
        const a = img.data[s + 3]! / 255
        const d = ((y + gap) * width + x0 + x) * 4
        for (let c = 0; c < 3; c++) data[d + c] = Math.round(img.data[s + c]! * a + background[c]! * (1 - a))
        data[d + 3] = 255
      }
    x0 += img.width + gap
  }
  return { width, height, data }
}
