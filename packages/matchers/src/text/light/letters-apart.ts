// How tight a face's letters may be spaced on a piece's words before they run into each other,
// measured from the face's own drawn letters: each line's graphemes are drawn in three sets, every
// third one, in place in the whole text, so kerning, ligatures and joining scripts shape as they do
// in it, each letter grown by a small gap. Letters run into each other at a spacing when the three
// sets overlap more there than with no letter spacing, so letters a script joins, or a face sets
// touching, may touch as they do unspaced but come no closer.

import { type TextDrawer, textLayerProps, type TextLook } from '../draw-text.ts'

/** Letters are kept this far apart at least, in % of the size, unless they are closer unspaced. */
const LETTER_GAP = 1
/** The size the letters are drawn at to be measured; letter spacing in % doesn't depend on it. */
const MEASURE_SIZE = 40
/** How much more the sets may overlap than unspaced, a share of the measuring size squared. */
const OVERLAP_ALLOWED = 0.0005
/** The overlap that allows, in measuring pixels. */
const ALLOWED = OVERLAP_ALLOWED * MEASURE_SIZE * MEASURE_SIZE
/** How close an outline is measured, a share of the size. */
const OUTLINE_STEP = 0.002
/** How close the tightest spacing is found, in points of %. */
const PRECISION = 0.25
/** How many sets the graphemes are drawn in: a grapheme and the next two are each in another. */
const SETS = 3
/** The line height lines are drawn at to be measured, so that no two lines' letters meet. */
const LINES_APART = 3
/** The share of the size drawn round the measured text. */
const MARGIN = 0.6
/** The colour the measured letters are drawn in, and the rest in. */
const DRAWN = '#000000FF'
const UNDRAWN = '#00000000'

/** What is known of a face's letters on some words. */
interface Known {
  /** The measuring text's box with no letter spacing, which holds it at any tighter spacing. */
  box: { width: number; height: number }
  /** How much the sets overlap with no letter spacing. */
  unspaced: number
  /** The tightest spacing at which the letters were found apart, and how far under the allowed overlap the sets are there. */
  apart: { at: number; over: number }
  /** The tightest spacing at which the letters stay apart, once found. */
  tightest?: number
}

/** What each drawer has measured, by face, outline and words. */
const measured = new WeakMap<TextDrawer, Map<string, Known>>()

/**
 * The look's letter spacing, or, when its letters would run into each other there, the tightest
 * spacing at which they stay apart: no two letters closer than `LETTER_GAP`, or than they are with
 * no letter spacing.
 */
export function spacingApart(drawer: TextDrawer, words: string, look: TextLook): number {
  const { spacing } = look
  if (!drawer.lettersApart || spacing >= 0 || !words.trim()) return spacing
  // The outline as a share of the size, to the nearest step, so near outlines share a measurement.
  const outline = look.outline ? Math.round(look.outline.width / look.size / OUTLINE_STEP) * OUTLINE_STEP : 0
  const known = knownOf(drawer, words, look, outline)
  if (known.tightest !== undefined) return Math.max(spacing, known.tightest)
  if (spacing >= known.apart.at) return spacing
  const allowed = known.unspaced + ALLOWED
  // How far past the allowed overlap the sets go at a spacing: apart at or under 0.
  const over = (at: number) => setsOverlap(drawer, words, look, outline, known.box, at) - allowed
  const atSpacing = over(spacing)
  if (atSpacing <= 0) {
    known.apart = { at: spacing, over: atSpacing }
    return spacing
  }
  known.tightest = tightestApart(over, { at: spacing, over: atSpacing }, known.apart)
  return known.tightest
}

/** What is known of the look's face on the words, measured with no letter spacing the first time. */
function knownOf(drawer: TextDrawer, words: string, look: TextLook, outline: number): Known {
  const key = `${look.family}|${look.weight}|${look.style}|${outline}|${words}`
  let byKey = measured.get(drawer)
  if (!byKey) {
    byKey = new Map()
    measured.set(drawer, byKey)
  }
  let known = byKey.get(key)
  if (!known) {
    const box = drawer.measure(words, measuringLook(look, words, 0))
    known = { box, unspaced: setsOverlap(drawer, words, look, outline, box, 0), apart: { at: 0, over: -ALLOWED } }
    byKey.set(key, known)
  }
  return known
}

/**
 * The tightest spacing between `close`, where the letters run into each other, and `apart`, where
 * they don't, at which `over` is at most 0, to within `PRECISION`: found by the Illinois method, a
 * false position that halves the weight of an end kept twice.
 */
function tightestApart(
  over: (at: number) => number,
  close: { at: number; over: number },
  apart: { at: number; over: number },
): number {
  let [c, a] = [close, apart]
  let kept: 'close' | 'apart' | undefined
  while (a.at - c.at > PRECISION) {
    const guess = c.at + ((a.at - c.at) * c.over) / (c.over - a.over)
    // Kept off the ends, so every step closes in by at least the precision's half.
    const at = Math.min(a.at - PRECISION / 2, Math.max(c.at + PRECISION / 2, guess))
    const value = over(at)
    if (value <= 0) {
      a = { at, over: value }
      if (kept === 'apart') c = { ...c, over: c.over / 2 }
      kept = 'apart'
    } else {
      c = { at, over: value }
      if (kept === 'close') a = { ...a, over: a.over / 2 }
      kept = 'close'
    }
  }
  return a.at
}

/** The look as its letters are measured: in black, at the measuring size, lines far apart, from the start. */
function measuringLook(look: TextLook, words: string, spacing: number): TextLook {
  return {
    family: look.family,
    weight: look.weight,
    style: look.style,
    size: MEASURE_SIZE,
    spacing,
    ...(words.includes('\n') ? { lineHeight: LINES_APART } : {}),
    align: 'start',
    color: UNDRAWN,
  }
}

/**
 * How much the sets of every third grapheme overlap, drawn at `spacing` in the look's face at the
 * measuring size, each letter grown by the letter gap and the look's outline: the sum over the
 * pixels and each two sets of the less inked of the two. The sets are drawn one under the other in
 * one frame.
 */
function setsOverlap(
  drawer: TextDrawer,
  words: string,
  look: TextLook,
  outline: number,
  box: Known['box'],
  spacing: number,
): number {
  const grown = { width: (LETTER_GAP / 100 + outline) * MEASURE_SIZE, color: DRAWN }
  const pad = Math.ceil(MEASURE_SIZE * MARGIN)
  const width = Math.ceil(box.width + 2 * pad)
  const band = Math.ceil(box.height + 2 * pad)
  const measuring = measuringLook(look, words, spacing)
  const layers = setRanges(words).map((ranges, i) => ({
    ...textLayerProps(words, measuring, { x: pad, y: pad + i * band, ...box, rotation: 0 }),
    runs: ranges.map(([start, end]) => ({ start, end, style: { color: DRAWN, outline: grown } })),
  }))
  const { pixels } = drawer.draw(width, band * SETS, ...layers)
  const step = width * band * 4
  let sum = 0
  for (let i = 3; i < step; i += 4) {
    const a = pixels[i] ?? 0
    const b = pixels[i + step] ?? 0
    const c = pixels[i + 2 * step] ?? 0
    sum += Math.min(a, b) + Math.min(b, c) + Math.min(a, c)
  }
  return sum / 255
}

/** Each set's graphemes as ranges of the words' UTF-16 units: every third grapheme of each line, from the set's. */
function setRanges(words: string): [number, number][][] {
  const sets: [number, number][][] = Array.from({ length: SETS }, () => [])
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let offset = 0
  for (const line of words.split('\n')) {
    let i = 0
    for (const { segment, index } of segmenter.segment(line)) {
      if (segment.trim()) sets[i % SETS]?.push([offset + index, offset + index + segment.length])
      i++
    }
    offset += line.length + 1
  }
  return sets
}
