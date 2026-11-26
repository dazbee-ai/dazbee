import { describe, expect, it } from 'vitest'

import { callSize, IMAGE_SIZES, pictureLimits, shapeOf } from './call-size.ts'

describe('callSize', () => {
  it('makes a square frame a 1024 px square', () => {
    expect(callSize({ width: 1080, height: 1080 })).toEqual({ width: 1024, height: 1024 })
  })

  it('makes a 9:16 frame 768 × 1360, the size measured for GPT Image', () => {
    expect(callSize({ width: 1080, height: 1920 })).toEqual({ width: 768, height: 1360 })
  })

  it('makes a 3:1 frame exactly 3:1, and a wider one 3:1 too', () => {
    expect(callSize({ width: 1500, height: 500 })).toEqual({ width: 1776, height: 592 })
    expect(callSize({ width: 728, height: 90 })).toEqual({ width: 1776, height: 592 })
  })

  it('keeps every size within the model’s limits, sides multiples of 16, near the frame’s ratio', () => {
    const limits = pictureLimits('seedream-5.5')
    for (let width = 100; width <= 3000; width += 97) {
      for (const height of [100, 333, 1080, 2400]) {
        const size = callSize({ width, height }, limits)
        const ratio = Math.min(3, Math.max(1 / 3, width / height))
        expect(size.width % 16).toBe(0)
        expect(size.height % 16).toBe(0)
        expect(size.width * size.height).toBeGreaterThanOrEqual(limits.minPixels)
        expect(size.width * size.height).toBeLessThanOrEqual(limits.maxPixels)
        expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(limits.maxSide)
        expect(size.width / size.height).toBeLessThanOrEqual(3)
        expect(size.width / size.height).toBeGreaterThanOrEqual(1 / 3)
        expect(Math.abs(size.width / size.height / ratio - 1)).toBeLessThan(0.03)
      }
    }
  })

  it('raises a size to a model’s fewest pixels', () => {
    const limits = { minPixels: 2_000_000, maxPixels: 4_000_000, maxSide: 3840 }
    const size = callSize({ width: 1000, height: 1000 }, limits)
    expect(size.width * size.height).toBeGreaterThanOrEqual(2_000_000)
    expect(size.width).toBe(size.height)
  })
})

describe('pictureLimits', () => {
  it('gives GPT Image its own pixel range, and a model not listed the range every listed model takes', () => {
    expect(pictureLimits('gpt-image-2.5-sunburst')).toEqual({ minPixels: 655_360, maxPixels: 8_294_400, maxSide: 3840 })
    const unknown = pictureLimits('a-new-model')
    for (const model of ['gpt-image-2.5-sunburst', 'seedream-5.5', 'muse-image-1.0']) {
      expect(unknown.minPixels).toBeGreaterThanOrEqual(pictureLimits(model).minPixels)
      expect(unknown.maxPixels).toBeLessThanOrEqual(pictureLimits(model).maxPixels)
    }
  })
})

describe('shapeOf', () => {
  it('names a frame’s shape: square, or its side and its ratio', () => {
    expect(shapeOf({ width: 1080, height: 1080 })).toBe('square')
    expect(shapeOf({ width: 1080, height: 1350 })).toBe('portrait 4:5')
    expect(shapeOf({ width: 1920, height: 1080 })).toBe('landscape 16:9')
    expect(shapeOf({ width: 1200, height: 628 })).toBe('landscape 1.91:1')
    expect(shapeOf({ width: 628, height: 1200 })).toBe('portrait 1:1.91')
  })
})

describe('IMAGE_SIZES', () => {
  it('asks for a square at 1:1, a wide image at 3:2 and a tall one at 2:3', () => {
    const ratio = ({ width, height }: { width: number; height: number }) => width / height
    expect([IMAGE_SIZES.square, IMAGE_SIZES.wide, IMAGE_SIZES.tall].map(ratio)).toEqual([1, 3 / 2, 2 / 3])
  })
})
