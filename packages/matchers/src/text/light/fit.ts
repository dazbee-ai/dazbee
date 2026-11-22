// Fitting a candidate face to a text piece from what the piece's reading measured: drawn alone at
// 100 px to read its lines, sized so its lines are as tall as the piece's, letter-spaced so they are
// as wide, line-spaced so they are as far apart, then drawn over the level piece and moved so the ink
// centres meet, and scored there.

import { type Placed, type TextDrawer, textLayerProps, type TextLook } from '../draw-text.ts'
import { type Box, type Ink, inkBox } from '../ink.ts'
import { findLines, type PieceReading } from '../read-piece.ts'
import type { Candidate } from '../shortlist.ts'
import { letterShape, overlap } from './rank.ts'

/** A candidate face fitted to a piece and placed over its level ink. */
export interface Fitted {
  face: Candidate
  look: TextLook
  /** The text layer in the level piece: before the tilt is put back. */
  place: Placed
  /** What candidates are ordered by: the letters' shape, plus the fingerprint's vote once ranked. */
  rank: number
  /** How well the drawn ink overlaps the piece's where it is placed. */
  overlap: number
  /** How well the letters' shapes match, each tile free to move a little. */
  shape: number
  /** The drawn text's lines, in the level piece once placed. */
  lines: Box[]
  /** How many places letter spacing goes in each line, measured from its layout. */
  lineGaps: number[]
}

/** Letter spacing is kept within these, in %. */
export const SPACING_RANGE = { min: -25, max: 120 }
/** Line height is kept within these, a multiple of the size. */
export const LINE_HEIGHT_RANGE = { min: 0.5, max: 3 }
/** The size faces are first drawn at to read their lines. */
const BASE_SIZE = 100
/** The line height faces are first drawn at, a multiple of the size, when the words have lines. */
const BASE_LINE_HEIGHT = 1.2
/** The letter spacing, in %, a line is laid out with to count the places spacing goes. */
const PROBE_SPACING = 20
/** A face whose size is outside this many times the piece's line height either way can't be it. */
const SIZE_RANGE = 4
/** Fitting draws in black; the piece's colours are put on at the end. */
const FIT_COLOUR = '#000000FF'
/** A face is drawn alone with this share of its size round it. */
const ALONE_MARGIN = 0.6
/** The least margin, in pixels, round the level piece a placed draw has. */
const MIN_PLACE_MARGIN = 16

/** A face fitted to the piece from the reading's measurements; null when it can't be the piece's font. */
export function fitFace(drawer: TextDrawer, reading: PieceReading, words: string, face: Candidate): Fitted | null {
  const lines = words.split('\n')
  const count = lines.length
  const base: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size: BASE_SIZE,
    spacing: 0,
    ...(count > 1 ? { lineHeight: BASE_LINE_HEIGHT } : {}),
    align: reading.align,
    color: FIT_COLOUR,
  }
  const alone = drawAlone(drawer, words, base)
  if (!alone) return null
  const baseLines = findLines(alone.ink, alone.box, count)
  const ratios = reading.lines
    .map((line, i) => line.h / Math.max(1, baseLines[i]?.h ?? 0))
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
  const size = BASE_SIZE * averagedMedian(ratios)
  if (!sizeFits(reading, count, size)) return null
  // A line is measured alone, in the font's own line height.
  const single: TextLook = { ...base }
  delete single.lineHeight
  const lineGaps = lines.map((line) => {
    if (!line.trim()) return 0
    const plain = drawer.measure(line, { ...single, spacing: 0 }).width
    const spaced = drawer.measure(line, { ...single, spacing: PROBE_SPACING }).width
    return Math.max(0, (spaced - plain) / PROBE_SPACING - 1)
  })
  let room = 0
  let gaps = 0
  reading.lines.forEach((line, i) => {
    const places = lineGaps[i] ?? 0
    if (places <= 0) return
    room += line.w - ((baseLines[i]?.w ?? 0) * size) / BASE_SIZE
    gaps += places
  })
  const spacing = gaps > 0 ? clamp(((room / gaps) * 100) / size, SPACING_RANGE.min, SPACING_RANGE.max) : 0
  let lineHeight: number | undefined
  if (count > 1) {
    let sum = 0
    for (let i = 0; i + 1 < count; i++) {
      const piecePitch = centre(reading.lines[i + 1]) - centre(reading.lines[i])
      const extra = centre(baseLines[i + 1]) - centre(baseLines[i]) - BASE_LINE_HEIGHT * BASE_SIZE
      sum += (piecePitch - (extra * size) / BASE_SIZE) / size
    }
    lineHeight = clamp(sum / (count - 1), LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max)
  }
  const look: TextLook = {
    ...base,
    size,
    spacing,
    ...(lineHeight ? { lineHeight } : {}),
    ...(reading.outline ? { outline: { width: reading.outline.width, color: FIT_COLOUR } } : {}),
  }
  const fitted = placeByInk(drawer, reading, words, face, look)
  return fitted ? { ...fitted, lineGaps } : null
}

/**
 * The look drawn over the level piece and moved so the ink boxes' centres meet, with its overlap and
 * letter shape there; null when it draws no ink.
 */
export function placeByInk(
  drawer: TextDrawer,
  reading: PieceReading,
  words: string,
  face: Candidate,
  look: TextLook,
): Omit<Fitted, 'lineGaps'> | null {
  const { box, level } = reading
  const natural = drawer.measure(words, look)
  // First guess: the layer's box where the ink box is, then corrected by where the ink lands.
  const guess = { x: box.x + box.w / 2 - natural.width / 2, y: box.y + box.h / 2 - natural.height / 2 }
  // Drawn with a margin round the piece, so ink that lands past its edge still counts.
  const pad = Math.ceil(Math.max(look.size, MIN_PLACE_MARGIN))
  const width = level.width + 2 * pad
  const height = level.height + 2 * pad
  const drawn = drawer.draw(
    width,
    height,
    textLayerProps(words, look, { x: guess.x + pad, y: guess.y + pad, ...natural, rotation: 0 }),
  )
  const ink = alphaInk(drawn.pixels, width, height)
  const inked = inkBox(ink)
  if (!inked) return null
  const dx = box.x + box.w / 2 - (inked.x - pad + inked.w / 2)
  const dy = box.y + box.h / 2 - (inked.y - pad + inked.h / 2)
  const shape = letterShape(level, ink, dx - pad, dy - pad, look.size)
  return {
    face,
    look,
    place: { x: guess.x + dx, y: guess.y + dy, ...natural, rotation: 0 },
    rank: shape,
    overlap: overlap(level, ink, dx - pad, dy - pad),
    shape,
    lines: findLines(ink, inked, reading.lines.length).map((line) => ({
      ...line,
      x: line.x - pad + dx,
      y: line.y - pad + dy,
    })),
  }
}

/** Whether a size is within `SIZE_RANGE` times the piece's line height either way. */
export function sizeFits(reading: PieceReading, lineCount: number, size: number): boolean {
  const perLine = reading.box.h / lineCount
  return size >= perLine / SIZE_RANGE && size <= perLine * SIZE_RANGE
}

/** The median of the values, the mean of the two middle ones for an even count; 1 for none. */
export function averagedMedian(values: readonly number[]): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[mid] ?? 1) : ((sorted[mid - 1] ?? 1) + (sorted[mid] ?? 1)) / 2
}

/** `value` kept within `min` and `max`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A box's vertical centre; 0 for none. */
export function centre(box: Box | undefined): number {
  return box ? box.y + box.h / 2 : 0
}

/** The words drawn alone at their natural size with a margin, as ink, and its ink box; null when nothing is drawn. */
function drawAlone(drawer: TextDrawer, words: string, look: TextLook): { ink: Ink; box: Box } | null {
  const natural = drawer.measure(words, look)
  const pad = Math.ceil(look.size * ALONE_MARGIN)
  const width = Math.ceil(natural.width + 2 * pad)
  const height = Math.ceil(natural.height + 2 * pad)
  const drawn = drawer.draw(width, height, textLayerProps(words, look, { x: pad, y: pad, ...natural, rotation: 0 }))
  const ink = alphaInk(drawn.pixels, width, height)
  const box = inkBox(ink)
  return box ? { ink, box } : null
}

/** A drawing's alpha as ink. */
function alphaInk(pixels: Uint8Array, width: number, height: number): Ink {
  const data = new Float32Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = (pixels[i * 4 + 3] ?? 0) / 255
  return { width, height, data }
}
