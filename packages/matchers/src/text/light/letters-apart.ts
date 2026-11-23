// How tight a face's letters may be spaced on a piece's words before they run into each other,
// measured from the face's own drawn letters: each line's graphemes are drawn in three sets, every
// third one, in place in the whole text, so kerning, ligatures and joining scripts shape as they do
// in it, each letter grown by a small gap. Letters run into each other at a spacing when the sets
// overlap more there than with no letter spacing, so letters a script joins, or a face sets touching,
// may touch as they do unspaced but come no closer.

import { type TextDrawer, textLayerProps, type TextLook } from '../draw-text.ts'

/** A letter spacing tried, and how far past the allowed overlap the sets go there: apart at or under 0. */
interface Probe {
  at: number
  over: number
}

/** What is known of a face's letters on some words. */
interface Known {
  /** The measuring text's box with no letter spacing, which holds it at any tighter spacing. */
  box: { width: number; height: number }
  /** How much the sets overlap with no letter spacing. */
  unspaced: number
  /** The tightest spacing at which the letters were found apart, and how far under the allowed overlap the sets are there. */
  apart: Probe
  /** The tightest spacing at which the letters stay apart, once found. */
  tightest?: number
}

/** Letters are kept this far apart at least, in % of the size, unless they are closer unspaced. */
const LETTER_GAP = 1
/** The size the letters are drawn at to be measured; letter spacing in % doesn't depend on it. */
const MEASURE_SIZE = 40
/** How much more the sets may overlap than unspaced, a share of the measuring size squared. */
const OVERLAP_ALLOWED = 0.0005
/** `OVERLAP_ALLOWED` in pixels at the measuring size. */
const OVERLAP_ALLOWED_PIXELS = OVERLAP_ALLOWED * MEASURE_SIZE * MEASURE_SIZE
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
/** The colour a set's letters are drawn in. */
const INKED = '#000000FF'
/** The colour the letters of the other sets are drawn in. */
const CLEAR = '#00000000'

/** What each drawer has measured, by face, outline and words. */
const measured = new WeakMap<TextDrawer, Map<string, Known>>()

/**
 * The look with its letter spacing raised, when its letters would run into each other there, to the
 * tightest spacing at which they stay apart: no two letters closer than `LETTER_GAP`, or than they
 * are with no letter spacing. A drawer that doesn't keep letters apart leaves it as it is.
 */
export function spacedApart<T extends TextLook>(drawer: TextDrawer, words: string, look: T): T {
  const spacing = tightestFrom(drawer, words, look)
  return spacing === look.spacing ? look : { ...look, spacing }
}

/** The look's letter spacing, or the tightest above it at which its letters stay apart. */
function tightestFrom(drawer: TextDrawer, words: string, look: TextLook): number {
  const { spacing } = look
  if (!drawer.lettersApart || spacing >= 0 || !words.trim()) return spacing
  // The outline as a share of the size, to the nearest step, so near outlines share a measurement.
  const outline = look.outline ? Math.round(look.outline.width / look.size / OUTLINE_STEP) * OUTLINE_STEP : 0
  const known = knownOf(drawer, words, look, outline)
  if (known.tightest !== undefined) return Math.max(spacing, known.tightest)
  if (spacing >= known.apart.at) return spacing
  const allowed = known.unspaced + OVERLAP_ALLOWED_PIXELS
  const over = (at: number) => setsOverlap(drawer, words, look, outline, known.box, at) - allowed
  const tried = { at: spacing, over: over(spacing) }
  if (tried.over <= 0) {
    known.apart = tried
    return spacing
  }
  known.tightest = tightestApart(over, tried, known.apart)
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
    const unspaced = setsOverlap(drawer, words, look, outline, box, 0)
    known = { box, unspaced, apart: { at: 0, over: -OVERLAP_ALLOWED_PIXELS } }
    byKey.set(key, known)
  }
  return known
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
  const grown = { width: (LETTER_GAP / 100 + outline) * MEASURE_SIZE, color: INKED }
  const pad = Math.ceil(MEASURE_SIZE * MARGIN)
  const width = Math.ceil(box.width + 2 * pad)
  const band = Math.ceil(box.height + 2 * pad)
  const measuring = measuringLook(look, words, spacing)
  const layers = setRanges(words).map((ranges, i) => ({
    ...textLayerProps(words, measuring, { x: pad, y: pad + i * band, ...box, rotation: 0 }),
    runs: ranges.map(([start, end]) => ({ start, end, style: { color: INKED, outline: grown } })),
  }))
  const { pixels } = drawer.draw(width, band * SETS, ...layers)
  const bandBytes = width * band * 4
  let sum = 0
  for (let i = 3; i < bandBytes; i += 4)
    for (let first = 0; first < SETS; first++)
      for (let second = first + 1; second < SETS; second++)
        sum += Math.min(pixels[i + first * bandBytes] ?? 0, pixels[i + second * bandBytes] ?? 0)
  return sum / 255
}

/**
 * The tightest spacing between `close`, where the letters run into each other, and `apart`, where
 * they don't, at which `over` is at most 0, to within `PRECISION`: found by the Illinois method, a
 * false position that halves the weight of an end kept twice.
 */
function tightestApart(over: (at: number) => number, close: Probe, apart: Probe): number {
  let [closest, farthest] = [close, apart]
  let kept: 'close' | 'apart' | undefined
  while (farthest.at - closest.at > PRECISION) {
    const guess = closest.at + ((farthest.at - closest.at) * closest.over) / (closest.over - farthest.over)
    // Kept off the ends, so every step closes in by at least the precision's half.
    const at = Math.min(farthest.at - PRECISION / 2, Math.max(closest.at + PRECISION / 2, guess))
    const probe = { at, over: over(at) }
    if (probe.over <= 0) {
      farthest = probe
      if (kept === 'apart') closest = { ...closest, over: closest.over / 2 }
      kept = 'apart'
    } else {
      closest = probe
      if (kept === 'close') farthest = { ...farthest, over: farthest.over / 2 }
      kept = 'close'
    }
  }
  return farthest.at
}

/** The look as its letters are measured: clear, at the measuring size, lines far apart, from the start. */
function measuringLook(look: TextLook, words: string, spacing: number): TextLook {
  return {
    family: look.family,
    weight: look.weight,
    style: look.style,
    size: MEASURE_SIZE,
    spacing,
    ...(words.includes('\n') ? { lineHeight: LINES_APART } : {}),
    align: 'start',
    color: CLEAR,
  }
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
