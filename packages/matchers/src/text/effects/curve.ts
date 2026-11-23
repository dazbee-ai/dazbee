// The curve fit, tried only for a piece whose curve check fired: the letters' baseline fitted in closed
// form (circles about one centre through their feet for an arc or a circle, a sine for a wave), the
// piece turned so the curve stands upright and its pixels straightened along it (`straighten.ts`) for
// the matcher to read as straight letters; then the face picked on those drawn with each shape the
// fit allows, across the amounts, the closest by overlap kept, and its amount and the piece's turn
// refined by a step halved each round, as the finer fit steps, bounded by its rounds and reading no
// clock.

import type { Pixels } from '@dazbee/renderer'
import type { TextCurve } from '@dazbee/schema'

import { type CurveKind, letterBlobs } from '../curve-check.ts'
import {
  bestSine,
  type Circle,
  circleDistance,
  fitCircle,
  fitRings,
  fitSine,
  lineRings,
  type Point,
  reachRound,
  type Rings,
  type Sine,
  sineAt,
  sineDistance,
  trimmedFit,
  waveBands,
} from '../curve-fits.ts'
import type { TextDrawer, TextLook } from '../draw-text.ts'
import { borderColour, type Ink, inkBox, inkOf, rotateInk } from '../ink.ts'
import { type Fitted, placeByInk } from '../light/fit.ts'
import { closeness, finish, type Verified, type VerifyTarget } from '../light/verify.ts'
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
  /** Each line's wave's offset down, top line first, with the sine. */
  offsets?: number[]
  /** Whether the letters stand outwards from the circle's centre, as on an arc up or a circle. */
  up: boolean
  /** Each line's baseline radius about the circle's centre, top line first; none for a wave. */
  radii: number[]
  /** The piece's pixels straightened along the curve. */
  pixels: Pixels
}

/** What a curved answer is judged against: the piece turned upright, and the piece read whole. */
export interface CurveFitting {
  frame: CurveFrame
  /** The upright reading at the work size, with the job's backgrounds and kit, at the piece's scale. */
  target: VerifyTarget
  /** The piece read at its own size. */
  whole: PieceReading
}

/** The answers a curve gives: Light's face drawn curved, and in Hybrid that fitted finer. */
export interface CurvedAnswers {
  light: Verified
  finer?: Verified
}

/** A curve's amount is kept within these. */
export const CURVE_AMOUNTS = { min: 1, max: 100 }

/** The amounts each shape is tried at besides its first. */
const SPREAD_AMOUNTS = [20, 50, 80]

/** The amount's first step, halved each round, and how many rounds. */
const AMOUNT_STEP = 8

const AMOUNT_ROUNDS = 4

/** A drawn wave's length, in its text's size. */
const WAVE_LENGTH = 6
/** The fewest letters a wave's height is fitted again through. */
const WAVE_LETTERS = 4

/** Ink past this is part of a letter the piece is straightened about. */
const LETTER_INK = 0.2

/** The first step, in degrees, the piece is turned by as its curve is refined, halved with the amount's. */
const TURN_STEP = 2

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

/**
 * Fits on the straightened piece drawn with their curve on the upright piece, finished and judged
 * there, in order until one looks the same: the one that looks the same, else the closest; in Hybrid,
 * when it doesn't look the same, also that curved fit fitted finer by `finer`.
 */
export function curvedAnswers(
  drawer: TextDrawer,
  fitting: CurveFitting,
  words: string,
  straight: readonly Fitted[],
  finer: ((fit: Fitted, reading: PieceReading) => Fitted) | null,
): CurvedAnswers | null {
  let best: { light: Verified; fit: Fitted; reading: PieceReading } | null = null
  for (const fit of straight) {
    if (best?.light.same) break
    const curved = fitCurve(drawer, fitting.frame, words, fit)
    if (!curved) continue
    const light = finish(drawer, { ...fitting.target, reading: curved.reading }, curved.fit)
    const closer = !best || (light.same && !best.light.same) || closeness(light.scores) > closeness(best.light.scores)
    if (closer) best = { light, fit: curved.fit, reading: curved.reading }
  }
  if (!best) return null
  // A curved answer that already looks the same is kept as it is: Hybrid would keep it either way.
  const finerFitted = best.light.same ? null : finer?.(best.fit, best.reading)
  const target = { ...fitting.target, reading: best.reading }
  return {
    light: best.light,
    ...(finerFitted && finerFitted !== best.fit ? { finer: finish(drawer, target, finerFitted) } : {}),
  }
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

/** Whether an arc's circle is below its letters, so its middle is highest. */
function isArcUp(circle: { cy: number }, centres: readonly Point[]): boolean {
  const meanY = centres.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, centres.length)
  return circle.cy > meanY
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
  const centres = letterBlobs(level, undefined, labels, LETTER_INK).map((b): Point => [b.x, b.y])
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
    ...(waves ? { sine: waves.sine, offsets: waves.offsets } : {}),
    pixels,
  }
}

/** A reading turned on by `degrees`, clockwise, its level ink, box and lines read again. */
function turnedBy(reading: PieceReading, degrees: number): PieceReading {
  const level = rotateInk(reading.level, -degrees)
  const box = inkBox(level) ?? { x: 0, y: 0, w: level.width, h: level.height }
  return { ...reading, level, angle: reading.angle + degrees, box, lines: findLines(level, box, reading.lines.length) }
}

/** A circle as rings of one. */
function oneRing(circle: Circle | undefined): Rings | null {
  return circle ? { cx: circle.cx, cy: circle.cy, radii: [circle.radius], rings: [] } : null
}

/**
 * The rings of the lines' baselines: through each letter's foot, its pixel nearest the centre of the
 * rings through their centres (`up`) or furthest from it, each in its letter's ring; for one line, a
 * descender's foot trimmed off.
 */
function baselineRings(level: Ink, rough: Rings, up: boolean, count: number): Rings {
  const radius = (x: number, y: number) => Math.hypot(x - rough.cx, y - rough.cy)
  const feet = letterBlobs(level, up ? (x, y) => -radius(x, y) : radius).map((b) => b.foot)
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
    const feet = letterBlobs(reading.level, (x, y) => sineDistance(rough, [x, y]))
      .filter((b) => b.y >= top.y && b.y < top.y + top.h)
      .map((b) => b.foot)
    const sine = trimmedFit(feet, (kept) => fitSine(kept, rough.wavelength), sineDistance)?.model ?? rough
    return { sine, offsets: [sine.c], lines: centres.map(() => 0) }
  }
  const rough = waveBands(centres, count, letterHeight)
  if (!rough) return null
  // The letters' blobs come in the same order, so each foot takes its letter's line.
  const below = (x: number, y: number) => y - sineAt(rough.sine, x) + rough.sine.c
  const feet = letterBlobs(reading.level, below).map((b) => b.foot)
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
 * How tall a straightened piece's lines stand together, in pixels: the curve that straightens its
 * letters truest leaves each line its own height, and a curve off it makes the lines taller.
 */
function straightness(frame: CurveFrame): number {
  const ink = inkOf(frame.pixels, borderColour(frame.pixels))
  const box = inkBox(ink)
  if (!box) return Infinity
  return findLines(ink, box, frame.reading.lines.length).reduce((sum, line) => sum + line.h, 0)
}

/**
 * The straight fit's face and look drawn with each curve the frame allows over the upright piece, at
 * its first amount and across the amounts, the closest by overlap kept; then its amount, and the turn
 * of the piece it is drawn over, refined. The fit and the reading it was fitted over; null when none
 * draws ink.
 */
function fitCurve(
  drawer: TextDrawer,
  frame: CurveFrame,
  words: string,
  straight: Fitted,
): { fit: Fitted; reading: PieceReading } | null {
  let { reading } = frame
  // Drawn only to be compared by overlap, so the straight fit's letter shape is kept.
  const place = (on: PieceReading, look: TextLook) =>
    placeByInk(drawer, on, words, straight.face, look, undefined, straight.shape)
  // Each shape at its first amount and across the amounts, as a curve's ink moves as it bends.
  const tried = firstLooks(drawer, frame, words, straight.look)
    .flatMap((look) => [
      look,
      ...SPREAD_AMOUNTS.map((amount) => ({ ...look, curve: { ...(look.curve as TextCurve), amount } })),
    ])
    .map((look) => place(reading, look))
    .filter((fit) => fit !== null)
  let best = tried.sort((a, b) => b.overlap - a.overlap)[0]
  if (!best) return null
  let step = AMOUNT_STEP
  let turnStep = TURN_STEP
  for (let round = 0; round < AMOUNT_ROUNDS; round++) {
    for (const sign of [1, -1]) {
      const curve = best.look.curve as TextCurve
      const amount = clampAmount(curve.amount + sign * step)
      if (amount === curve.amount) continue
      const fit = place(reading, { ...best.look, curve: { ...curve, amount } })
      if (fit && fit.overlap > best.overlap) {
        best = fit
        break
      }
    }
    for (const sign of [1, -1]) {
      const turned = turnedBy(reading, sign * turnStep)
      const fit = place(turned, best.look)
      if (fit && fit.overlap > best.overlap) {
        best = fit
        reading = turned
        break
      }
    }
    step /= 2
    turnStep /= 2
  }
  return { fit: { ...best, lineGaps: straight.lineGaps }, reading }
}

/**
 * The looks to try first, each curved by the amount its geometry gives, the line's length drawn
 * straight in the look: an arc by that length over its baseline's radius, with a wave beside it when
 * the trace allows one; a circle by its baseline's length over that length; a wave by its height over
 * the look's size.
 */
function firstLooks(drawer: TextDrawer, frame: CurveFrame, words: string, look: TextLook): TextLook[] {
  const { circle, sine, up, radii } = frame
  // The longest line's length drawn straight, as a curve's sizes are shares of it, and its baseline's radius.
  const longest = (spacing: number) => {
    const straight: TextLook = { ...look, spacing }
    delete straight.curve
    delete straight.lineHeight
    const lengths = words.split('\n').map((line) => drawer.measure(line, straight).width)
    const length = Math.max(...lengths)
    return { length, radius: Math.max(1, radii[lengths.indexOf(length)] ?? circle?.radius ?? 1) }
  }
  const looks: TextLook[] = []
  if (frame.kind === 'circle' && circle) {
    // A circle spreads its letters to close it, which the straightened letters read as spacing: the
    // look is tried with the spacing found, and with none and the spread the circle's own.
    for (const spacing of new Set([look.spacing, 0])) {
      const { length, radius } = longest(spacing)
      const amount = clampAmount((2 - (2 * Math.PI * radius) / length) * 100)
      looks.push({ ...look, spacing, curve: { shape: 'circle', amount } })
    }
    return looks
  }
  if (circle) {
    const { length, radius } = longest(look.spacing)
    const amount = clampAmount((length / radius / Math.PI) * 100)
    looks.push({ ...look, curve: { shape: up ? 'arcUp' : 'arcDown', amount } })
  }
  if (sine) {
    // A wave's length is six of its text's size, so its height is fitted again at that length.
    const along = waveOfLook(frame, sine, look.size) ?? sine
    const amount = clampAmount((Math.hypot(along.p, along.q) / look.size) * 100)
    looks.push({ ...look, curve: { shape: 'wave', amount } })
  }
  return looks
}

/**
 * The sine through the top line's letters' feet at the wavelength a wave drawn at `size` has: six
 * of the size; null when too few letters stand on the top line.
 */
function waveOfLook(frame: CurveFrame, sine: Sine, size: number): Sine | null {
  const { level } = frame.reading
  const reach = frame.reading.curve?.letterHeight ?? size / 2
  const feet = letterBlobs(level, (x, y) => sineDistance(sine, [x, y]))
    .map((b) => b.foot)
    .filter((foot) => Math.abs(sineDistance(sine, foot)) <= reach)
  if (feet.length < WAVE_LETTERS) return null
  return trimmedFit(feet, (kept) => fitSine(kept, WAVE_LENGTH * size), sineDistance)?.model ?? null
}

/** An amount rounded to a hundredth and kept within `CURVE_AMOUNTS`. */
function clampAmount(amount: number): number {
  const rounded = Math.round(amount * 100) / 100
  const { min, max } = CURVE_AMOUNTS
  return Math.min(max, Math.max(min, Number.isFinite(rounded) ? rounded : min))
}
