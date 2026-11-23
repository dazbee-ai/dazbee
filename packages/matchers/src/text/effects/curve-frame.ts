// A curved piece's frame, read only for a piece whose curve check fired: the piece turned so its curve
// stands upright, the lines' baselines fitted there in closed form through the letters' feet (circles
// about one centre for an arc or a circle, one wave moved down a line at a time for a wave), and its
// pixels straightened along them (`straighten.ts`) for the matcher to read as straight letters.

import type { Pixels } from '@dazbee/renderer'

import { type CurveKind, letterBlobs } from '../curve-check.ts'
import {
  bestSine,
  type Circle,
  circleDistance,
  fitCircle,
  fitSine,
  type Point,
  reachRound,
  type Sine,
  sineAt,
  sineDistance,
  trimmedFit,
} from '../curve-fits.ts'
import { borderColour, type Ink, inkBox, inkOf, rotateInk } from '../ink.ts'
import { fitRings, lineRings, type Rings, waveBands } from '../line-fits.ts'
import { findLines, type PieceReading } from '../read-piece.ts'
import { straightened, type StraightenedLetter } from './straighten.ts'

/** A piece's curve as fitted: its shape's geometry in the piece turned upright, and that reading. */
export interface CurveFrame {
  kind: CurveKind
  /** The piece read turned so its curve stands upright: an arc's middle at the top or the bottom, a wave level. */
  reading: PieceReading
  /** The circle the letters' baseline runs round, for an arc or a circle. */
  circle?: Circle
  /** The sine the top line's baseline follows, for a wave or an arc that may be one. */
  sine?: Sine
  /** Whether the letters stand outwards from the circle's centre, as on an arc up or a circle. */
  up: boolean
  /** Each line's baseline radius about the circle's centre, top line first; none for a wave. */
  radii: number[]
  /** The piece's pixels straightened along the curve. */
  pixels: Pixels
}

/** Ink past this is part of a letter the piece is straightened about. */
export const LETTER_INK = 0.2

/**
 * The curve of a reading whose check fired, the reading turned so it stands upright, and its pixels
 * straightened along it. An arc stands about the circle through its letters; a wave and a circle as
 * the piece is given (`given` degrees, 0 when unknown), a circle's seam at the bottom. A piece read
 * as an arc or a wave is straightened both ways, and the way whose letters then stand most nearly in
 * a line is kept. The shape is the check's, `fired`, which may have been read at another size. Null
 * when the letters can't be fitted.
 */
export function curveFrame(
  reading: PieceReading,
  given: number | undefined,
  fired: CurveKind | null = reading.curve?.fired ?? null,
): CurveFrame | null {
  if (!fired || !reading.curve) return null
  const { blobs } = reading.curve
  const asGiven = (given ?? 0) - reading.angle
  if (fired === 'circle') return frameAt(reading, 'circle', asGiven)
  const centres = blobs.map((b): Point => [b.x, b.y])
  const circle = trimmedFit(centres, fitCircle, circleDistance)?.model
  const frames = [circle ? frameAt(reading, 'arc', apexTilt(circle, centres)) : null, frameAt(reading, 'wave', asGiven)]
    .filter((frame) => frame !== null)
    .map((frame) => ({ frame, off: straightness(frame) }))
  return frames.sort((a, b) => a.off - b.off)[0]?.frame ?? null
}

/** A reading turned on by `degrees`, clockwise, its level ink, box and lines read again. */
export function turnedBy(reading: PieceReading, degrees: number): PieceReading {
  const level = rotateInk(reading.level, -degrees)
  const box = inkBox(level) ?? { x: 0, y: 0, w: level.width, h: level.height }
  return { ...reading, level, angle: reading.angle + degrees, box, lines: findLines(level, box, reading.lines.length) }
}

/**
 * The reading turned by `turn` degrees so its curve stands upright, its letters' baseline fitted there
 * through their feet (a circle through all of them, and for an arc or a wave a sine through its top
 * line's), and its pixels straightened along the curve of `kind`: an arc or a circle unrolled about
 * its centre (a circle from the bottom, clockwise), a wave along its length, each line of the output
 * a curve parallel to the letters'. Null when that curve can't be fitted.
 */
function frameAt(reading: PieceReading, kind: CurveKind, turn: number): CurveFrame | null {
  const letterHeight = reading.curve?.letterHeight ?? 1
  const upright = turnedBy(reading, turn)
  const { level } = upright
  const labels = new Int32Array(level.width * level.height)
  // Read down to faint ink, so a thin letter's strokes hold together as one letter.
  const centres = letterBlobs(level, { labels, inkFrom: LETTER_INK }).map((b): Point => [b.x, b.y])
  const count = upright.lines.length
  const rough =
    count > 1
      ? (lineRings(centres, count)?.rings ?? null)
      : oneRing(trimmedFit(centres, fitCircle, circleDistance)?.model)
  const up = kind === 'circle' || !rough || isArcUp(rough, centres)
  const rings = rough && baselineRings(level, rough, up, count)
  // Each line's baseline radius, top line first: outermost first when the letters stand outwards.
  const radii = rings ? (up ? [...rings.radii].reverse() : rings.radii) : []
  const circle = rings && { cx: rings.cx, cy: rings.cy, radius: radii[0] ?? 0 }
  const waves = kind === 'circle' ? null : baselineWaves(upright, centres, letterHeight)
  const sine = waves?.sine
  // Each line's letters, top line first, by the ring or the wave each stands on.
  const lineOf = (i: number): number => {
    if (kind === 'wave') return waves?.lines[i] ?? 0
    const ring = rings?.rings[i] ?? 0
    return up ? radii.length - 1 - ring : ring
  }
  const letters = Array.from({ length: Math.max(1, count) }, (): StraightenedLetter[] => [])
  centres.forEach(([x, y], blob) =>
    letters[Math.min(letters.length - 1, Math.max(0, lineOf(blob)))]?.push({ x, y, blob }),
  )
  const pixels = straightened(upright, kind, {
    circle: circle ?? undefined,
    radii,
    sine,
    offsets: waves?.offsets,
    up,
    letters,
    labels,
  })
  if (!pixels) return null
  return {
    kind,
    reading: upright,
    up,
    radii,
    ...(circle ? { circle } : {}),
    ...(waves ? { sine: waves.sine } : {}),
    pixels,
  }
}

/** A circle as rings of one. */
function oneRing(circle: Circle | undefined): Rings | null {
  return circle ? { cx: circle.cx, cy: circle.cy, radii: [circle.radius], rings: [] } : null
}

/** Whether an arc's circle is below its letters, so its middle is highest. */
function isArcUp(circle: { cy: number }, centres: readonly Point[]): boolean {
  const meanY = centres.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, centres.length)
  return circle.cy > meanY
}

/**
 * The rings of the lines' baselines: through each letter's foot, its pixel nearest the centre of the
 * rings through their centres (`up`) or furthest from it, each in its letter's ring; for one line, a
 * descender's foot trimmed off.
 */
function baselineRings(level: Ink, rough: Rings, up: boolean, count: number): Rings {
  const radius = (x: number, y: number) => Math.hypot(x - rough.cx, y - rough.cy)
  const feet = letterBlobs(level, { down: up ? (x, y) => -radius(x, y) : radius, inkFrom: LETTER_INK }).map(
    (b) => b.foot,
  )
  if (count > 1) return fitRings(feet, count, { start: rough.rings, fixed: true }) ?? rough
  return oneRing(trimmedFit(feet, fitCircle, circleDistance)?.model) ?? rough
}

/**
 * The wave of the lines' baselines: one sine moved down a line at a time, through each letter's foot,
 * its pixel lowest below the waves through the letters' centres, each in its letter's line, at that
 * wave's wavelength; for one line, through its band's letters, a descender's foot trimmed off. Null
 * when the letters span too little for a wave.
 */
function baselineWaves(
  reading: PieceReading,
  centres: readonly Point[],
  letterHeight: number,
): { sine: Sine; offsets: number[]; lines: number[] } | null {
  const count = reading.lines.length
  if (count <= 1) {
    const rough = bestSine(topBand(reading, centres), letterHeight)?.model
    if (!rough) return null
    const top = reading.lines[0] ?? reading.box
    const feet = letterBlobs(reading.level, { down: (x, y) => sineDistance(rough, [x, y]), inkFrom: LETTER_INK })
      .filter((b) => b.y >= top.y && b.y < top.y + top.h)
      .map((b) => b.foot)
    const sine = trimmedFit(feet, (kept) => fitSine(kept, rough.wavelength), sineDistance)?.model ?? rough
    return { sine, offsets: [sine.c], lines: centres.map(() => 0) }
  }
  const rough = waveBands(centres, count, letterHeight)
  if (!rough) return null
  // The letters' blobs, read at the same ink, come in the same order, so each foot takes its letter's line.
  const below = (x: number, y: number) => y - sineAt(rough.sine, x) + rough.sine.c
  const feet = letterBlobs(reading.level, { down: below, inkFrom: LETTER_INK }).map((b) => b.foot)
  const fitted = waveBands(feet, count, letterHeight, { lines: rough.lines, wavelength: rough.sine.wavelength })
  const lines = rough.lines
  return fitted
    ? { sine: fitted.sine, offsets: fitted.offsets, lines }
    : { sine: rough.sine, offsets: rough.offsets, lines }
}

/** The points of a reading's topmost line band. */
function topBand(reading: PieceReading, points: readonly Point[]): Point[] {
  const top = reading.lines[0] ?? reading.box
  return points.filter(([, y]) => y >= top.y && y < top.y + top.h)
}

/**
 * The degrees an arc's piece is turned by, clockwise: the middle of its letters' reach round the
 * circle off straight up from its centre (an arc up) or straight down (an arc down).
 */
function apexTilt(circle: Circle, centres: readonly Point[]): number {
  const mean = reachMiddle(circle, centres)
  // The middle's direction from the centre, as an angle off up (an arc up) or off down (an arc down).
  const off = isArcUp(circle, centres)
    ? Math.atan2(Math.sin(mean), Math.cos(mean))
    : Math.atan2(-Math.sin(mean), -Math.cos(mean))
  return (off * 180) / Math.PI
}

/**
 * The direction, as an angle clockwise from up (`sin`, `−cos`), of the middle of the points' reach
 * round the circle's centre.
 */
function reachMiddle(circle: Circle, points: readonly Point[]): number {
  const { from, to } = reachRound(circle, points)
  return (from + to) / 2
}

/**
 * How tall a straightened piece's lines stand together, in pixels: the curve that straightens its
 * letters truest leaves each line its own height, and a curve off it makes the lines taller.
 */
function straightness(frame: CurveFrame): number {
  const ink = inkOf(frame.pixels, borderColour(frame.pixels))
  const box = inkBox(ink)
  if (!box) return Infinity
  return findLines(ink, box, frame.reading.lines.length).reduce((sum, line) => sum + line.h, 0)
}
