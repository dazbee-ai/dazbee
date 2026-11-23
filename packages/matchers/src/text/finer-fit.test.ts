import { afterAll, describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { textDrawer } from './draw-text.ts'
import { finerFit } from './finer-fit.ts'
import { fitFace } from './light/fit.ts'
import { NARROW_WORDS, narrowPiece, OVERLAP_FROM, WIDE_FACE, worstOverlap } from './light/test-letters.ts'
import { readPiece } from './read-piece.ts'

const ck = await loadCanvasKit()
const drawer = textDrawer(
  ck,
  loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
)
afterAll(() => drawer.delete())

describe('finerFit', () => {
  it('keeps the letters of a wide face fitted to a narrow piece apart', () => {
    const { work } = readPiece({ pixels: narrowPiece(ck), words: NARROW_WORDS })
    const fitted = fitFace(drawer, work, NARROW_WORDS, WIDE_FACE)
    if (!fitted) throw new Error('the wide face was not fitted')
    const finer = finerFit(drawer, work, NARROW_WORDS, fitted)
    expect(finer).not.toBe(fitted)
    expect(worstOverlap(drawer, NARROW_WORDS, finer.look)).toBeLessThanOrEqual(OVERLAP_FROM)
  })
})
