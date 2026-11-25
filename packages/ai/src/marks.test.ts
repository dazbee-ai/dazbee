// Marks drawn over a copy of the first reference picture, with our CanvasKit build.
import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawMarks, MARKED_SIDE } from './marks.ts'
import { pngOf } from './test-ai.ts'

/** The RGBA of the pixel at `x`, `y` of a PNG, and its size. */
async function readPng(png: Uint8Array) {
  const ck = await loadCanvasKit()
  const image = ck.MakeImageFromEncoded(png)
  if (!image) throw new Error('not a picture')
  const width = image.width()
  const height = image.height()
  const info = {
    width,
    height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }
  const pixels = image.readPixels(0, 0, info) as Uint8Array
  image.delete()
  return {
    width,
    height,
    at: (x: number, y: number) => [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)],
  }
}

describe('drawMarks', () => {
  it('draws the marks over a copy of the picture, stretched to its size', async () => {
    const picture = await pngOf(64, 32, [255, 0, 0, 255])
    // Marks drawn at half the picture's size: a blue square over their top-left quarter.
    const marks = await pngOf(32, 16, [0, 0, 255, 255], { quarter: true })
    const marked = await readPng(await drawMarks(picture, marks))
    expect([marked.width, marked.height]).toEqual([64, 32])
    expect(marked.at(4, 4)).toEqual([0, 0, 255, 255])
    expect(marked.at(48, 24)).toEqual([255, 0, 0, 255])
  })

  it('scales a picture bigger than the marked side down to fit it', async () => {
    const picture = await pngOf(4096, 2048, [255, 0, 0, 255])
    const marks = await pngOf(64, 64, [0, 0, 255, 255], { quarter: true })
    const marked = await readPng(await drawMarks(picture, marks))
    expect([marked.width, marked.height]).toEqual([MARKED_SIDE, MARKED_SIDE / 2])
  })

  it('fails on marks that are not a picture', async () => {
    await expect(drawMarks(await pngOf(8, 8, [255, 0, 0, 255]), new Uint8Array(8))).rejects.toThrow(
      'the marks are not a picture',
    )
  })
})
