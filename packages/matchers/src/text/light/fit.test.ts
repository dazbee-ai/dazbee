import { afterAll, describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { textDrawer } from '../draw-text.ts'
import { readPiece } from '../read-piece.ts'
import { fitFace, SPACING_RANGE } from './fit.ts'
import { NARROW_WORDS, narrowPiece, OVERLAP_FROM, WIDE_FACE, worstOverlap } from './test-letters.ts'

const ck = await loadCanvasKit()
const faces = loadFontFiles().map(({ family, bytes }) => ({ family, bytes }))
const drawer = textDrawer(ck, faces)
/** A drawer whose fits space letters as tight as the piece asks. */
const squeezing = textDrawer(ck, faces, { lettersApart: false })
afterAll(() => {
  drawer.delete()
  squeezing.delete()
})

describe('fitFace', () => {
  it("fits a wide face to a narrow piece with its letters apart, where the piece's width would run them together", () => {
    const { work } = readPiece({ pixels: narrowPiece(ck), words: NARROW_WORDS })
    const fitted = fitFace(drawer, work, NARROW_WORDS, WIDE_FACE)
    if (!fitted) throw new Error('the wide face was not fitted')
    expect(fitted.look.spacing).toBeGreaterThan(SPACING_RANGE.min)
    expect(worstOverlap(drawer, NARROW_WORDS, fitted.look)).toBeLessThanOrEqual(OVERLAP_FROM)
    const squeezed = fitFace(squeezing, work, NARROW_WORDS, WIDE_FACE)
    expect(squeezed && worstOverlap(drawer, NARROW_WORDS, squeezed.look)).toBeGreaterThan(OVERLAP_FROM)
  })
})
