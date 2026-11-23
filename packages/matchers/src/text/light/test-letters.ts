// Letters checked for running into each other, for the tests: each grapheme of a text drawn alone in
// place in the whole text, and every two of a line at most three apart compared; a shipped face's
// look; and a piece drawn in a thin face and spaced tight, for fitting a wider face to.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'

import { type TextDrawer, textLayerProps, type TextLook } from '../draw-text.ts'
import { drawText } from '../test-text-pieces.ts'

/** Two letters run into each other when their inks share more than this many pixels' worth more than unspaced. */
export const OVERLAP_FROM = 1
/** The words of the narrow piece. */
export const NARROW_WORDS = 'MAXIMUM'
/** A wider face than the narrow piece's, of the shipped faces. */
export const WIDE_FACE = { key: 'Noto Sans|800|normal', family: 'Noto Sans', weight: 800, style: 'normal' as const }

/** A look in a shipped face at a size, black. */
export function lookOf(family: string, weight: number, size: number, spacing: number): TextLook {
  return { family, weight, style: 'normal', size, spacing, align: 'start', color: '#000000FF' }
}

/** `NARROW_WORDS` drawn thin and spaced tight on white, in Noto Sans 400. */
export function narrowPiece(ck: CanvasKit): Pixels {
  return drawText(ck, {
    words: NARROW_WORDS,
    family: 'Noto Sans',
    weight: 400,
    size: 60,
    spacing: -6,
    colour: '#000000',
    background: '#FFFFFF',
  })
}

/**
 * The most two letters of a line, at most three graphemes apart, share of each other's ink beyond
 * what they share with no letter spacing.
 */
export function worstOverlap(drawer: TextDrawer, words: string, look: TextLook): number {
  const unspaced = sharedInks(drawer, words, { ...look, spacing: 0 })
  return Math.max(0, ...sharedInks(drawer, words, look).map((sum, i) => sum - (unspaced[i] ?? 0)))
}

/** How many separate parts the words' ink is in, its pixels joined to their 8 neighbours. */
export function inkParts(drawer: TextDrawer, words: string, look: TextLook): number {
  const { width, height, alpha } = drawnAlpha(drawer, words, look)
  const seen = new Uint8Array(width * height)
  const inked = (at: number) => (alpha[at] ?? 0) >= 0.5
  let parts = 0
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !inked(start)) continue
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
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !inked(next)) continue
          seen[next] = 1
          stack.push(next)
        }
    }
  }
  return parts
}

/** For every two graphemes of a line at most three apart, in order, how much ink they share. */
function sharedInks(drawer: TextDrawer, words: string, look: TextLook): number[] {
  const inks = graphemes(words).map(({ start, end, line }) => {
    const run = { start, end, style: { color: look.color, outline: { width: 0, color: look.color } } }
    return { line, alpha: drawnAlpha(drawer, words, { ...look, color: '#00000000' }, run).alpha }
  })
  const shared: number[] = []
  for (let i = 0; i < inks.length; i++)
    for (let j = i + 1; j <= i + 3 && j < inks.length; j++) {
      const [a, b] = [inks[i], inks[j]]
      if (!a || !b || a.line !== b.line) continue
      let sum = 0
      for (let k = 0; k < a.alpha.length; k++) sum += Math.min(a.alpha[k] ?? 0, b.alpha[k] ?? 0)
      shared.push(sum)
    }
  return shared
}

/** The words drawn in the look with a margin of its size, one run in its own colour when given, as alpha 0 to 1. */
function drawnAlpha(
  drawer: TextDrawer,
  words: string,
  look: TextLook,
  run?: NonNullable<ReturnType<typeof textLayerProps>['runs']>[number],
): { width: number; height: number; alpha: Float32Array } {
  const box = drawer.measure(words, look)
  const pad = Math.ceil(look.size)
  const [width, height] = [Math.ceil(box.width + 2 * pad), Math.ceil(box.height + 2 * pad)]
  const props = textLayerProps(words, look, { x: pad, y: pad, ...box, rotation: 0 })
  const { pixels } = drawer.draw(width, height, run ? { ...props, runs: [run] } : props)
  return {
    width,
    height,
    alpha: Float32Array.from({ length: width * height }, (_, i) => (pixels[i * 4 + 3] ?? 0) / 255),
  }
}

/** Each grapheme of the words that draws ink, as its range in UTF-16 units and its line. */
function graphemes(words: string): { start: number; end: number; line: number }[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let offset = 0
  return words.split('\n').flatMap((text, line) => {
    const found = [...segmenter.segment(text)]
      .filter(({ segment }) => segment.trim())
      .map(({ segment, index }) => ({ start: offset + index, end: offset + index + segment.length, line }))
    offset += text.length + 1
    return found
  })
}
