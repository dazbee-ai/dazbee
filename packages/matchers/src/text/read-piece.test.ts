import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Rgb } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { type PieceReading, type ReadPiece, readPiece, WORK_LINE_HEIGHT } from './read-piece.ts'
import { type DrawnText, drawText } from './test-text-pieces.ts'

const ck = await loadCanvasKit()

/** Two centred lines tilted 5° with an outline, as the reading test draws them on a colour and as a cut-out. */
const OUTLINED: Omit<DrawnText, 'background'> = {
  words: 'Big Summer Sale\nToday',
  family: 'Noto Sans',
  weight: 800,
  size: 96,
  colour: '#F4C430',
  outline: { width: 4, color: '#1B1464' },
  rotation: 5,
  align: 'center',
}

/** One line drawn hollow, as only a 4 px outline with no fill. */
const HOLLOW: Omit<DrawnText, 'background'> = {
  words: 'Big Sale',
  family: 'Noto Sans',
  weight: 800,
  size: 96,
  colour: '#FFFFFF',
  outline: { width: 4, color: '#FFFFFF' },
  hollow: true,
}

/** The ΔE00 between two colours. */
const deltaE = (a: Rgb, b: Rgb) => ciede2000(srgbToLab(...a), srgbToLab(...b))

/** A reading with its inks as hashes of their bytes, to compare two readings quickly. */
const digest = ({ whole, work, scale }: ReadPiece) => {
  const of = ({ ink, level, ...rest }: PieceReading) => ({
    ...rest,
    ink: createHash('sha256').update(ink.data).digest('hex'),
    level: createHash('sha256').update(level.data).digest('hex'),
  })
  return { whole: of(whole), work: of(work), scale }
}

/** The sum of an ink's pixels. */
const inkSum = ({ data }: PieceReading['ink']) => data.reduce((sum, v) => sum + v, 0)

/** A piece read twice, which must give the same reading. */
const readTwice = (...args: Parameters<typeof readPiece>) => {
  const reading = readPiece(...args)
  expect(digest(readPiece(...args))).toEqual(digest(reading))
  return reading
}

describe('readPiece', () => {
  it.each([
    ['on a flat colour', '#E8F1F8' as const],
    ['as a cut-out', null],
  ])('reads text tilted 5° with an outline %s: tilt, lines, alignment, fill and outline', (_, background) => {
    const pixels = drawText(ck, { ...OUTLINED, background })
    const { whole, work, scale } = readTwice({ pixels, words: OUTLINED.words })
    expect(scale).toBe(1)
    expect(work).toBe(whole)
    expect(Math.abs(whole.angle - 5)).toBeLessThanOrEqual(0.5)
    expect(whole.lines).toHaveLength(2)
    expect(whole.align).toBe('center')
    expect(deltaE(whole.fill ?? [0, 0, 0], [0xf4, 0xc4, 0x30])).toBeLessThanOrEqual(2)
    expect(whole.outline).not.toBeNull()
    expect(whole.fill).not.toBeNull()
    expect(deltaE(whole.outline?.colour ?? [0, 0, 0], [0x1b, 0x14, 0x64])).toBeLessThanOrEqual(10)
    if (background) expect(deltaE(whole.background, [0xe8, 0xf1, 0xf8])).toBeLessThanOrEqual(1)
  })

  it('reads plain text with no outline, aligned to its end, at the tilt it is given', () => {
    const words = 'Fresh coffee\nevery morning\nfrom 7 am'
    const pixels = drawText(ck, {
      words,
      family: 'Noto Sans',
      weight: 400,
      size: 48,
      colour: '#2B2B2B',
      background: '#FFFFFF',
      align: 'end',
    })
    const { whole } = readTwice({ pixels, words, angle: 0 })
    expect(whole.angle).toBe(0)
    expect(whole.lines).toHaveLength(3)
    expect(whole.align).toBe('end')
    expect(whole.outline).toBeNull()
    expect(whole.fill).not.toBeNull()
    expect(deltaE(whole.fill ?? [0, 0, 0], [0x2b, 0x2b, 0x2b])).toBeLessThanOrEqual(2)
  })

  it.each([
    ['on a flat colour', '#1E3A8A' as const, 0],
    ['as a cut-out', null, 0],
    ['tilted 5° as a cut-out', null, 5],
  ])(
    'reads hollow letters %s as the filled letters they outline, with no fill and their line as the outline',
    (_, background, rotation) => {
      const pixels = drawText(ck, { ...HOLLOW, background, rotation })
      const { whole } = readTwice({ pixels, words: HOLLOW.words })
      expect(Math.abs(whole.angle - rotation)).toBeLessThanOrEqual(0.5)
      expect(whole.fill).toBeNull()
      expect(Math.abs((whole.outline?.width ?? 0) - 4)).toBeLessThanOrEqual(1)
      expect(deltaE(whole.outline?.colour ?? [0, 0, 0], [0xff, 0xff, 0xff])).toBeLessThanOrEqual(2)
      // The letters' insides are filled: the level ink holds far more than the line drawn.
      expect(inkSum(whole.level)).toBeGreaterThan(2 * inkSum(whole.ink))
      expect(whole.lines).toHaveLength(1)
    },
  )

  it('reads thin letters with counters in a drawn frame as not hollow', () => {
    const words = 'Day'
    const pixels = drawText(ck, {
      words,
      family: 'Noto Sans',
      weight: 400,
      size: 48,
      colour: '#2B2B2B',
      background: '#FFFFFF',
    })
    const { width, height } = pixels
    // A 2 px frame round the text, 3 px in from the piece's edge.
    for (let y = 3; y < height - 3; y++)
      for (let x = 3; x < width - 3; x++)
        if (x < 5 || y < 5 || x >= width - 5 || y >= height - 5)
          pixels.pixels.fill(0x2b, (y * width + x) * 4, (y * width + x) * 4 + 3)
    expect(readTwice({ pixels, words }).whole.fill).not.toBeNull()
  })

  it('reads a piece with lines over 160 px again shrunk so its lines are 160 px', () => {
    const words = 'Big'
    const pixels = drawText(ck, {
      words,
      family: 'Noto Sans',
      weight: 700,
      size: 400,
      colour: '#C62828',
      background: null,
    })
    const { whole, work, scale } = readTwice({ pixels, words })
    expect(scale).toBeLessThan(0.95)
    expect(whole.box.h).toBeGreaterThan(WORK_LINE_HEIGHT / 0.95)
    expect(work.box.h).toBeGreaterThanOrEqual(WORK_LINE_HEIGHT - 2)
    expect(work.box.h).toBeLessThanOrEqual(WORK_LINE_HEIGHT + 2)
    expect(work.lines).toHaveLength(1)
    expect(deltaE(work.fill ?? [0, 0, 0], [0xc6, 0x28, 0x28])).toBeLessThanOrEqual(2)
  })

  it('reads hollow letters over 160 px shrunk as hollow, their line shrunk alike', () => {
    const words = 'Big'
    const pixels = drawText(ck, {
      ...HOLLOW,
      words,
      size: 400,
      outline: { width: 12, color: '#FFFFFF' },
      background: null,
    })
    const { whole, work, scale } = readTwice({ pixels, words })
    expect(scale).toBeLessThan(0.95)
    expect(whole.fill).toBeNull()
    expect(work.fill).toBeNull()
    expect(Math.abs((whole.outline?.width ?? 0) - 12)).toBeLessThanOrEqual(1)
    expect(work.outline?.width).toBeCloseTo((whole.outline?.width ?? 0) * scale, 6)
    expect(inkSum(work.level)).toBeGreaterThan(2 * inkSum(work.ink))
  })
})
