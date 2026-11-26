import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { readImageHeader } from '@dazbee/schema'

import { pngOf } from '../test-ai.ts'
import { patchesOf, REFERENCE_PATCHES, referenceSize, sizedReference } from './reference-size.ts'

describe('patchesOf', () => {
  it('counts the patches OpenAI billed for each size measured', () => {
    // 1536 × 860 was billed 1,296 image tokens, 1024 × 573 billed 576 and 1024 × 1024 billed 1,024.
    expect(patchesOf({ width: 1536, height: 860 })).toBe(1296)
    expect(patchesOf({ width: 1024, height: 573 })).toBe(576)
    expect(patchesOf({ width: 1024, height: 1024 })).toBe(1024)
  })
})

describe('referenceSize', () => {
  it('leaves a picture of at most 576 patches as it is', () => {
    for (const size of [
      { width: 1024, height: 573 },
      { width: 768, height: 768 },
      { width: 400, height: 200 },
    ]) {
      expect(referenceSize(size)).toEqual(size)
    }
  })

  it('scales a bigger picture down to the largest size of its ratio within 576 patches', () => {
    for (const size of [
      { width: 2400, height: 1343 },
      { width: 1536, height: 860 },
      { width: 1024, height: 1024 },
      { width: 1080, height: 1920 },
      { width: 6000, height: 400 },
    ]) {
      const fitted = referenceSize(size)
      expect(patchesOf(fitted), `${size.width} × ${size.height}`).toBeLessThanOrEqual(REFERENCE_PATCHES)
      // No more than a patch a side is given away, and the ratio stays within a pixel's rounding.
      expect(patchesOf({ width: fitted.width + 32, height: fitted.height + 32 })).toBeGreaterThan(REFERENCE_PATCHES)
      expect(Math.abs(fitted.width / fitted.height / (size.width / size.height) - 1)).toBeLessThan(0.02)
    }
    expect(referenceSize({ width: 1024, height: 1024 })).toEqual({ width: 768, height: 768 })
  })
})

describe('sizedReference', () => {
  it('sends a small picture as the bytes it is', async () => {
    const small = await pngOf(640, 360, [200, 120, 40, 255])
    expect(await sizedReference(small)).toBe(small)
    const unread = new Uint8Array([1, 2, 3])
    expect(await sizedReference(unread)).toBe(unread)
  })

  it('sends a big picture as a PNG copy within 576 patches, with its transparency', async () => {
    const big = await pngOf(2400, 1344, [200, 120, 40, 255], { quarter: true })
    const sent = await sizedReference(big)
    const header = readImageHeader(sent)
    expect(header).toMatchObject({ contentType: 'image/png' })
    expect(header && patchesOf(header)).toBeLessThanOrEqual(REFERENCE_PATCHES)
    expect(header && header.width / header.height).toBeCloseTo(2400 / 1344, 1)
    // The quarter that was drawn stays opaque and the rest stays clear.
    const ck = await loadCanvasKit()
    const image = ck.MakeImageFromEncoded(sent)
    if (!image) throw new Error('the copy is not a picture')
    const info = {
      width: image.width(),
      height: image.height(),
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    }
    const pixels = image.readPixels(0, 0, info) as Uint8Array
    const alphaAt = (x: number, y: number) => pixels[(y * info.width + x) * 4 + 3]
    expect([alphaAt(10, 10), alphaAt(info.width - 10, info.height - 10)]).toEqual([255, 0])
    image.delete()
    // A copy is within the patches, so it is sent as it is.
    expect(await sizedReference(sent)).toBe(sent)
  })
})
