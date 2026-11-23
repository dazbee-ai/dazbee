import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { type TextDrawer, textDrawer, textLayerProps, type TextLook } from '../draw-text.ts'
import { finerFit } from '../finer-fit.ts'
import { readPiece } from '../read-piece.ts'
import { drawText } from '../test-text-pieces.ts'
import { fitFace, SPACING_RANGE } from './fit.ts'
import { spacingApart } from './letters-apart.ts'

const ck = await loadCanvasKit()
const drawer = textDrawer(
  ck,
  loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
)

/** Two letters run into each other when their inks share more than this many pixels' worth more than unspaced. */
const OVERLAP_FROM = 1

/** A look in a shipped face at a size, black. */
function lookOf(family: string, weight: number, size: number, spacing: number): TextLook {
  return { family, weight, style: 'normal', size, spacing, align: 'start', color: '#000000FF' }
}

/**
 * The most two letters of a line, at most three graphemes apart, share of each other's ink beyond
 * what they share with no letter spacing: each grapheme drawn alone in place in the whole text.
 */
function worstOverlap(on: TextDrawer, words: string, look: TextLook): number {
  const inks = (spacing: number) => {
    const set = { ...look, spacing }
    const box = on.measure(words, set)
    const pad = Math.ceil(look.size)
    const [width, height] = [Math.ceil(box.width + 2 * pad), Math.ceil(box.height + 2 * pad)]
    const props = textLayerProps(words, { ...set, color: '#00000000' }, { x: pad, y: pad, ...box, rotation: 0 })
    return graphemes(words).map(({ start, end, line }) => {
      const style = { color: look.color, outline: { width: 0, color: look.color } }
      const { pixels } = on.draw(width, height, { ...props, runs: [{ start, end, style }] })
      return { line, alpha: Float32Array.from({ length: width * height }, (_, i) => (pixels[i * 4 + 3] ?? 0) / 255) }
    })
  }
  const shared = (spacing: number) => {
    const drawn = inks(spacing)
    const out: number[] = []
    for (let i = 0; i < drawn.length; i++)
      for (let j = i + 1; j <= i + 3 && j < drawn.length; j++) {
        const [a, b] = [drawn[i], drawn[j]]
        if (!a || !b || a.line !== b.line) continue
        let sum = 0
        for (let k = 0; k < a.alpha.length; k++) sum += Math.min(a.alpha[k] ?? 0, b.alpha[k] ?? 0)
        out.push(sum)
      }
    return out
  }
  const unspaced = shared(0)
  return Math.max(0, ...shared(look.spacing).map((sum, i) => sum - (unspaced[i] ?? 0)))
}

/** Each grapheme of the words that draws ink, as its range in UTF-16 units and its line. */
function graphemes(words: string): { start: number; end: number; line: number }[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let offset = 0
  return words.split('\n').flatMap((text, line) => {
    const out = [...segmenter.segment(text)]
      .filter(({ segment }) => segment.trim())
      .map(({ segment, index }) => ({ start: offset + index, end: offset + index + segment.length, line }))
    offset += text.length + 1
    return out
  })
}

/** How many separate parts the words' ink is in, its pixels joined to their 8 neighbours. */
function inkParts(on: TextDrawer, words: string, look: TextLook): number {
  const box = on.measure(words, look)
  const pad = Math.ceil(look.size)
  const [width, height] = [Math.ceil(box.width + 2 * pad), Math.ceil(box.height + 2 * pad)]
  const { pixels } = on.draw(width, height, textLayerProps(words, look, { x: pad, y: pad, ...box, rotation: 0 }))
  const seen = new Uint8Array(width * height)
  let parts = 0
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || (pixels[start * 4 + 3] ?? 0) < 128) continue
    parts++
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const at = stack.pop() ?? 0
      const [x, y] = [at % width, Math.floor(at / width)]
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy]
          const next = ny * width + nx
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next]) continue
          if ((pixels[next * 4 + 3] ?? 0) < 128) continue
          seen[next] = 1
          stack.push(next)
        }
    }
  }
  return parts
}

describe('spacingApart', () => {
  it('keeps a spacing at or above no letter spacing', () => {
    for (const spacing of [0, 4, 30])
      expect(spacingApart(drawer, 'WAVE', lookOf('Noto Sans', 800, 60, spacing))).toBe(spacing)
  })

  it("gives a heavy face's tightest spacing at which its letters don't overlap, and a spacing above it as it is", () => {
    const words = 'WAVE minimum'
    const squeezed = lookOf('Noto Sans', 800, 60, SPACING_RANGE.min)
    expect(worstOverlap(drawer, words, squeezed)).toBeGreaterThan(OVERLAP_FROM)
    const tightest = spacingApart(drawer, words, squeezed)
    expect(tightest).toBeGreaterThan(SPACING_RANGE.min)
    expect(tightest).toBeLessThan(0)
    expect(worstOverlap(drawer, words, { ...squeezed, spacing: tightest })).toBeLessThanOrEqual(OVERLAP_FROM)
    expect(spacingApart(drawer, words, { ...squeezed, spacing: tightest + 1 })).toBe(tightest + 1)
    expect(spacingApart(drawer, words, { ...squeezed, spacing: tightest - 1 })).toBe(tightest)
  })

  it('keeps letters an outline grows apart too', () => {
    const words = 'WAVE'
    const plain = spacingApart(drawer, words, lookOf('Noto Sans', 800, 60, SPACING_RANGE.min))
    const outlined = { ...lookOf('Noto Sans', 800, 60, SPACING_RANGE.min), outline: { width: 6, color: '#000000FF' } }
    expect(spacingApart(drawer, words, outlined)).toBeGreaterThan(plain)
  })

  it("lets a joining script's letters touch as they do unspaced, still joined", () => {
    const words = 'تخفيضات الصيف'
    const squeezed = lookOf('Noto Naskh Arabic', 700, 60, SPACING_RANGE.min)
    const tightest = spacingApart(drawer, words, squeezed)
    const apart = { ...squeezed, spacing: tightest }
    expect(worstOverlap(drawer, words, apart)).toBeLessThanOrEqual(OVERLAP_FROM)
    expect(inkParts(drawer, words, apart)).toBe(inkParts(drawer, words, { ...squeezed, spacing: 0 }))
  })
})

describe("Light's fit and Hybrid's finer fit", () => {
  it('fit a wide face to a narrow piece with its letters apart, wider than the piece', () => {
    const words = 'MAXIMUM'
    const pixels = drawText(ck, {
      words,
      family: 'Noto Sans',
      weight: 400,
      size: 60,
      spacing: -6,
      colour: '#000000',
      background: '#FFFFFF',
    })
    const { work } = readPiece({ pixels, words })
    const wide = { key: 'Noto Sans|800|normal', family: 'Noto Sans', weight: 800, style: 'normal' as const }
    const fitted = fitFace(drawer, work, words, wide)
    if (!fitted) throw new Error('Noto Sans 800 was not fitted')
    const finer = finerFit(drawer, work, words, fitted)
    for (const { look } of [fitted, finer]) {
      expect(look.spacing).toBeGreaterThan(SPACING_RANGE.min)
      expect(worstOverlap(drawer, words, look)).toBeLessThanOrEqual(OVERLAP_FROM)
    }
  })
})
