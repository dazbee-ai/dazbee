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
    expect(deltaE(whole.fill, [0xf4, 0xc4, 0x30])).toBeLessThanOrEqual(2)
    expect(whole.outline).not.toBeNull()
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
    expect(deltaE(whole.fill, [0x2b, 0x2b, 0x2b])).toBeLessThanOrEqual(2)
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
    expect(deltaE(work.fill, [0xc6, 0x28, 0x28])).toBeLessThanOrEqual(2)
  })
})
