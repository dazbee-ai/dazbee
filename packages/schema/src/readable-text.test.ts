import { describe, expect, it } from 'vitest'

import { TextProps } from './layers.ts'
import { PHONE_WIDTH, READABLE_TEXT_PX, readableTextSize, shownScale, smallestLetters } from './readable-text.ts'
import { SIZE_PRESETS } from './sizes.ts'

describe('shownScale', () => {
  it('shows a Google Display size at its own pixels, however wide', () => {
    expect([shownScale(300, 250), shownScale(728, 90), shownScale(970, 250)]).toEqual([1, 1, 1])
  })

  it('fits any other frame wider than a phone to the phone’s width, and leaves a narrower one at its own pixels', () => {
    expect(shownScale(1080, 1080)).toBe(1080 / PHONE_WIDTH)
    expect(shownScale(1080, 1920)).toBe(1080 / PHONE_WIDTH)
    expect(shownScale(1200, 628)).toBe(1200 / PHONE_WIDTH)
    expect(shownScale(PHONE_WIDTH, 640)).toBe(1)
    expect(shownScale(200, 200)).toBe(1)
  })
})

describe('readableTextSize', () => {
  it('is the smallest readable size where the frame is shown, in the frame’s pixels', () => {
    expect(readableTextSize(300, 250)).toBe(READABLE_TEXT_PX)
    expect(readableTextSize(1080, 1080)).toBe(33)
    expect(readableTextSize(1280, 720)).toBeCloseTo(39.11, 2)
  })

  it('gives a size for every offered size', () => {
    for (const { width, height } of SIZE_PRESETS) {
      expect(readableTextSize(width, height)).toBeGreaterThanOrEqual(READABLE_TEXT_PX)
    }
  })
})

describe('smallestLetters', () => {
  const text = (words: string, runs: object[]) =>
    TextProps.parse({
      ...{ x: 0, y: 0, width: 300, height: 100, text: words, runs },
      style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#111111FF' },
    })

  it('gives the size, at the scale given, and weight of the smallest letters, a run over only spaces left out', () => {
    const props = text('Sale ends soon', [
      { start: 4, end: 5, style: { fontSize: 8 } },
      { start: 5, end: 9, style: { fontSize: 20, fontWeight: 400 } },
    ])
    expect(smallestLetters(props, 0.5)).toEqual({ size: 10, weight: 400 })
  })

  it('gives nothing for a text of only spaces', () => {
    expect(smallestLetters(text('   ', []), 1)).toBeUndefined()
  })
})
