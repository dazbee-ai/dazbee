import { describe, expect, it } from 'vitest'

import { scaled, scaleText, smallestSize } from './text-scale.ts'

const style = {
  fontFamily: 'Noto Sans',
  fontSize: 64,
  fontWeight: 800,
  fontStyle: 'normal' as const,
  color: '#111111FF',
  letterSpacing: { unit: 'px' as const, value: 2 },
  lineHeight: 1.2,
  outline: { width: 3, color: '#000000FF' },
}

describe('scaling text', () => {
  it("scales a style's font size, letter spacing and outline width, and leaves line height, a multiple of the size", () => {
    expect(scaled(style, 1.5)).toMatchObject({
      fontSize: 96,
      letterSpacing: { unit: 'px', value: 3 },
      lineHeight: 1.2,
      outline: { width: 4.5 },
    })
    expect(scaled(style, 1)).toBe(style)
  })

  it('leaves letter spacing as a percentage, which follows the font size already', () => {
    const percent = { ...style, letterSpacing: { unit: 'percent' as const, value: 4 } }
    expect(scaled(percent, 1.5)).toMatchObject({ fontSize: 96, letterSpacing: { unit: 'percent', value: 4 } })
  })

  it("scales the style, each run, paragraph spacing and shrink to fit's sizes, each to the nearest 0.1", () => {
    const props = {
      style,
      runs: [
        { start: 0, end: 6, style: { fontSize: 120 } },
        { start: 7, end: 11, style: { color: '#FF3D6EFF' } },
      ],
      paragraphSpacing: 10,
      shrinkToFit: { min: 12, max: 64 },
    }
    expect(scaleText(props, 1.25)).toEqual({
      style: {
        ...style,
        fontSize: 80,
        letterSpacing: { unit: 'px', value: 2.5 },
        outline: { width: 3.8, color: '#000000FF' },
      },
      runs: [
        { start: 0, end: 6, style: { fontSize: 150 } },
        { start: 7, end: 11, style: { color: '#FF3D6EFF' } },
      ],
      paragraphSpacing: 12.5,
      shrinkToFit: { min: 15, max: 80 },
    })
    // Without paragraph spacing or shrink to fit, none is added.
    expect(scaleText({ style, runs: [] }, 0.5)).toEqual({
      style: {
        ...style,
        fontSize: 32,
        letterSpacing: { unit: 'px', value: 1 },
        outline: { width: 1.5, color: '#000000FF' },
      },
      runs: [],
    })
  })

  it('leaves a curve as it is: its sizes are shares of the font size and the line, so it scales with the text', () => {
    const curve = { shape: 'arcUp' as const, amount: 50 }
    const scaledText = scaleText({ style, runs: [], curve } as Parameters<typeof scaleText>[0], 2)
    expect(scaledText).not.toHaveProperty('curve')
    expect(scaledText.style.fontSize).toBe(128)
  })

  it("finds the smallest size the text has: its own, a run's or shrink to fit's smallest", () => {
    expect(smallestSize({ style, runs: [] })).toBe(64)
    expect(smallestSize({ style, runs: [{ start: 0, end: 2, style: { fontSize: 20 } }] })).toBe(20)
    expect(smallestSize({ style, runs: [], shrinkToFit: { min: 8, max: 64 } })).toBe(8)
  })
})

describe('scaledTiles', () => {
  it('scales a tiled image’s tile scale with the text, to hundredths inside TILE_SCALE, and leaves other images', () => {
    const tile = (tileScale?: number) => ({
      type: 'image' as const,
      assetId: 'marble',
      fit: 'tile' as const,
      opacity: 1,
      ...(tileScale === undefined ? {} : { tileScale }),
    })
    const fill = { ...tile(), fit: 'fill' as const }
    const runs = [
      { start: 0, end: 1, style: { image: tile(0.37) } },
      { start: 1, end: 2, style: { image: fill } },
      { start: 2, end: 3, style: { image: tile(9) } },
      { start: 3, end: 4, style: { image: tile() } },
    ]
    const out = scaleText({ style: { ...style, image: tile(0.5) }, runs }, 2.5)
    expect(out.style.image).toEqual(tile(1.25))
    expect(out.runs.map((run) => run.style.image)).toEqual([tile(0.93), fill, tile(10), tile()])
    expect(scaleText({ style: { ...style, image: tile(0.02) }, runs: [] }, 0.1).style.image).toEqual(tile(0.01))
  })
})
