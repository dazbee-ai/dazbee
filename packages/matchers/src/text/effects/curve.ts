// The curve fit, tried only for a piece whose curve check fired: the letters' curve fitted in closed
// form (a circle through the blobs' centres for an arc or a circle, a sine for a wave), the piece
// turned so the curve stands upright and its pixels straightened along the curve (resampled along its
// normals) for the matcher to read as straight letters; then the face picked on those drawn with each
// shape the trace allows, the closest by overlap kept, and its amount refined up and down by a step
// halved each round, as the finer fit steps, bounded by its rounds and reading no clock.

import type { Pixels } from '@dazbee/renderer'
import type { TextCurve } from '@dazbee/schema'

import {
  bestSine,
  type Circle,
  circleDistance,
  type CurveKind,
  fitCircle,
  fitRings,
  fitSine,
  letterBlobs,
  type Point,
  type Rings,
  type Sine,
  sineDistance,
  trimmedFit,
} from '../curve-check.ts'
import type { TextDrawer, TextLook } from '../draw-text.ts'
import { borderColour, type Ink, inkBox, inkOf, isCutOut, rotateInk } from '../ink.ts'
import { type Fitted, placeByInk } from '../light/fit.ts'
import { finish, type Verified, type VerifyTarget } from '../light/verify.ts'
import { findLines, type PieceReading } from '../read-piece.ts'

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
  /** The letters' median height, in pixels. */
  letterHeight: number
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

/** The amounts each shape is tried at besides its first. */
const SPREAD_AMOUNTS = [15, 35, 55, 75, 95]
/** The amount's first step, halved each round, and how many rounds. */
const AMOUNT_STEP = 8
const AMOUNT_ROUNDS = 4
/** The first step, in degrees, the piece is turned by as its curve is refined, halved with the amount's. */
const TURN_STEP = 2
/** A curve's amount is kept within these. */
const AMOUNTS = { min: 1, max: 100 }
/** The pixels left round the ink when it is straightened. */
const STRAIGHT_MARGIN = 4
/** Ink over this counts when the ink's reach round its curve is measured. */
const REACH_INK = 0.5
/** The steps, in pixels, a wave is measured along. */
const WAVE_STEP = 0.5

/**
 * The curve of a reading whose check fired, the reading turned so it stands upright, and its pixels
 * straightened along it. An arc stands about the circle through its letters; a wave and a circle as
 * the piece is given (`given` degrees, 0 when unknown), a circle's seam at the bottom. A piece read
 * as an arc or a wave is straightened both ways, and the way whose letters then stand most nearly in
 * a line is kept. Null when the letters can't be fitted.
 */
export function curveFrame(reading: PieceReading, given: number | undefined): CurveFrame | null {
  const { fired, blobs } = reading.curve
  if (!fired) return null
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
 * Light's answer on the straightened piece drawn with its curve on the upright piece, finished and
 * judged there; in Hybrid also that curved fit fitted finer by `finer`.
 */
export function curvedAnswers(
  drawer: TextDrawer,
  fitting: CurveFitting,
  words: string,
  light: Verified,
  finer: ((fit: Fitted, reading: PieceReading) => Fitted) | null,
): CurvedAnswers | null {
  const curved = fitCurve(drawer, fitting.frame, words, light.fit)
  if (!curved) return null
  const target = { ...fitting.target, reading: curved.reading }
  const finerFitted = finer?.(curved.fit, curved.reading)
  return {
    light: finish(drawer, target, curved.fit),
    ...(finerFitted && finerFitted !== curved.fit ? { finer: finish(drawer, target, finerFitted) } : {}),
  }
}

/**
 * The straight fit's face and look drawn with each curve the frame allows over the upright piece, at
 * its first amount and across the amounts, the closest by overlap kept; then its amount, and the turn
 * of the piece it is drawn over, refined. The fit and the reading it was fitted over; null when none
 * draws ink.
 */
export function fitCurve(
  drawer: TextDrawer,
  frame: CurveFrame,
  words: string,
  straight: Fitted,
): { fit: Fitted; reading: PieceReading } | null {
  let { reading } = frame
  const place = (on: PieceReading, look: TextLook) => placeByInk(drawer, on, words, straight.face, look)
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

/** A reading turned on by `degrees`, clockwise, its level ink, box and lines read again. */
function turnedBy(reading: PieceReading, degrees: number): PieceReading {
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
  const { letterHeight } = reading.curve
  const level = rotateInk(reading.level, -turn)
  const box = inkBox(level) ?? { x: 0, y: 0, w: level.width, h: level.height }
  const upright: PieceReading = {
    ...reading,
    level,
    angle: reading.angle + turn,
    box,
    lines: findLines(level, box, reading.lines.length),
  }
  const centres = letterBlobs(level).map((b): Point => [b.x, b.y])
  const count = upright.lines.length
  const rough = count > 1 ? fitRings(centres, count) : oneRing(trimmedFit(centres, fitCircle, circleDistance)?.model)
  const up = kind === 'circle' || !rough || isArcUp(rough, centres)
  const rings = rough && baselineRings(level, rough, up, count)
  // Each line's baseline radius, top line first: outermost first when the letters stand outwards.
  const radii = rings ? (up ? [...rings.radii].reverse() : rings.radii) : []
  const circle = rings && { cx: rings.cx, cy: rings.cy, radius: radii[0] ?? 0 }
  const sine = kind === 'circle' ? null : baselineSine(upright, centres, letterHeight)
  const inked: Point[] = []
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < level.width; x++)
      if ((level.data[y * level.width + x] ?? 0) > REACH_INK) inked.push([x + 0.5, y + 0.5])
  const map = kind === 'wave' ? sine && waveMap(sine, inked) : circle && polarMap(kind, circle, up, inked)
  if (!map) return null
  const source = toPiece(upright)
  return {
    kind,
    reading: upright,
    letterHeight,
    up,
    radii,
    ...(circle ? { circle } : {}),
    ...(sine ? { sine } : {}),
    pixels: resampled(upright, map.width, map.height, (u, v) => source(map.at(u, v))),
  }
}

/**
 * How tall a straightened piece's top line stands, in pixels: the curve that straightens its letters
 * truest leaves the line its own height, and a curve off it makes the line taller.
 */
function straightness(frame: CurveFrame): number {
  const ink = inkOf(frame.pixels, borderColour(frame.pixels))
  const box = inkBox(ink)
  if (!box) return Infinity
  return findLines(ink, box, frame.reading.lines.length)[0]?.h ?? Infinity
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
  if (count > 1) return fitRings(feet, count, rough.rings) ?? rough
  return oneRing(trimmedFit(feet, fitCircle, circleDistance)?.model) ?? rough
}

/**
 * The sine of the top line's baseline: through each of its letters' feet, their pixels lowest below
 * the sine through their centres, at that sine's wavelength; null when the line is too short for one.
 */
function baselineSine(reading: PieceReading, centres: readonly Point[], letterHeight: number): Sine | null {
  const rough = bestSine(topBand(reading, centres), letterHeight)?.model
  if (!rough) return null
  const top = reading.lines[0] ?? reading.box
  const feet = letterBlobs(reading.level, (x, y) => sineDistance(rough, [x, y]))
    .filter((b) => b.y >= top.y && b.y < top.y + top.h)
    .map((b) => b.foot)
  return trimmedFit(feet, (kept) => fitSine(kept, rough.wavelength), sineDistance)?.model ?? rough
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

/** Whether an arc's circle is below its letters, so its middle is highest. */
function isArcUp(circle: { cy: number }, centres: readonly Point[]): boolean {
  const meanY = centres.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, centres.length)
  return circle.cy > meanY
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
 * How far round the circle's centre the points reach, as angles clockwise from up (`sin`, `−cos`),
 * measured from the direction of their mean so the reach never wraps.
 */
function reachRound(circle: Circle, points: readonly Point[]): { from: number; to: number } {
  let sx = 0
  let sy = 0
  for (const [x, y] of points) {
    const d = Math.hypot(x - circle.cx, y - circle.cy) || 1
    sx += (x - circle.cx) / d
    sy += (y - circle.cy) / d
  }
  const mean = Math.atan2(sx, -sy)
  let from = Infinity
  let to = -Infinity
  for (const [x, y] of points) {
    const angle = Math.atan2(x - circle.cx, -(y - circle.cy))
    const off = Math.atan2(Math.sin(angle - mean), Math.cos(angle - mean))
    from = Math.min(from, off)
    to = Math.max(to, off)
  }
  return { from: mean + from, to: mean + to }
}

/** The points of a reading's topmost line band. */
function topBand(reading: PieceReading, points: readonly Point[]): Point[] {
  const top = reading.lines[0] ?? reading.box
  return points.filter(([, y]) => y >= top.y && y < top.y + top.h)
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
    const amount = clampAmount((Math.hypot(sine.p, sine.q) / look.size) * 100)
    looks.push({ ...look, curve: { shape: 'wave', amount } })
  }
  return looks
}

/** An amount rounded to a hundredth and kept within `AMOUNTS`. */
function clampAmount(amount: number): number {
  const rounded = Math.round(amount * 100) / 100
  return Math.min(AMOUNTS.max, Math.max(AMOUNTS.min, Number.isFinite(rounded) ? rounded : AMOUNTS.min))
}

/** A straightened picture's size, and the point in the upright frame each of its pixels comes from. */
interface Unrolled {
  width: number
  height: number
  at: (u: number, v: number) => Point
}

/**
 * An arc or a circle unrolled about its centre: across, the angle round it at the baseline's radius,
 * so lengths along it are the line's; down, the radius, outwards first when the letters stand
 * outwards (`up`), inwards first when they stand inwards.
 */
function polarMap(kind: CurveKind, circle: Circle, up: boolean, inked: readonly Point[]): Unrolled | null {
  if (inked.length === 0) return null
  let near = Infinity
  let far = 0
  for (const [x, y] of inked) {
    const r = Math.hypot(x - circle.cx, y - circle.cy)
    near = Math.min(near, r)
    far = Math.max(far, r)
  }
  near = Math.max(0, near - STRAIGHT_MARGIN)
  far += STRAIGHT_MARGIN
  const radius = Math.max(1, circle.radius)
  // Angles clockwise from up (an arc up, a circle) or anticlockwise from down (an arc down).
  const reach =
    kind === 'circle'
      ? { from: -Math.PI, to: Math.PI }
      : (() => {
          const round = reachRound(circle, inked)
          const pad = STRAIGHT_MARGIN / radius
          // Anticlockwise from down is a half turn less the angle clockwise from up.
          return up
            ? { from: round.from - pad, to: round.to + pad }
            : { from: Math.PI - round.to - pad, to: Math.PI - round.from + pad }
        })()
  const width = Math.max(1, Math.round((reach.to - reach.from) * radius))
  const height = Math.max(1, Math.round(far - near))
  return {
    width,
    height,
    at: (u, v) => {
      const angle = reach.from + (u + 0.5) / radius
      if (up) {
        const r = far - (v + 0.5)
        return [circle.cx + r * Math.sin(angle), circle.cy - r * Math.cos(angle)]
      }
      const r = near + (v + 0.5)
      return [circle.cx + r * Math.sin(angle), circle.cy + r * Math.cos(angle)]
    },
  }
}

/**
 * A wave unrolled along its length: across, the distance along the sine; down, the distance off it
 * along its normal, from the highest ink above it to the lowest below.
 */
function waveMap(sine: Sine, inked: readonly Point[]): Unrolled | null {
  if (inked.length === 0) return null
  const k = (2 * Math.PI) / sine.wavelength
  const y = (x: number) => sine.c + sine.slope * x + sine.p * Math.sin(k * x) + sine.q * Math.cos(k * x)
  const slope = (x: number) => sine.slope + k * (sine.p * Math.cos(k * x) - sine.q * Math.sin(k * x))
  let left = Infinity
  let right = -Infinity
  let above = 0
  let below = 0
  for (const [x, py] of inked) {
    left = Math.min(left, x)
    right = Math.max(right, x)
    const off = (py - y(x)) / Math.hypot(1, slope(x))
    above = Math.min(above, off)
    below = Math.max(below, off)
  }
  left -= STRAIGHT_MARGIN
  right += STRAIGHT_MARGIN
  above -= STRAIGHT_MARGIN
  below += STRAIGHT_MARGIN
  // The distance along the wave at each step across, to find where a distance along it is.
  const xs: number[] = [left]
  const along: number[] = [0]
  for (let x = left; x < right; x += WAVE_STEP) {
    const next = x + WAVE_STEP
    xs.push(next)
    along.push((along.at(-1) ?? 0) + Math.hypot(WAVE_STEP, y(next) - y(x)))
  }
  const length = along.at(-1) ?? 0
  let at = 0
  return {
    width: Math.max(1, Math.round(length)),
    height: Math.max(1, Math.round(below - above)),
    at: (u, v) => {
      const s = u + 0.5
      // The columns are asked for left to right, row by row, so the search walks on from the last.
      if ((along[at] ?? 0) > s) at = 0
      while (at < along.length - 2 && (along[at + 1] ?? 0) < s) at++
      const a = along[at] ?? 0
      const b = along[at + 1] ?? a
      const x = (xs[at] ?? left) + (b > a ? ((s - a) / (b - a)) * WAVE_STEP : 0)
      const d = slope(x)
      const n = Math.hypot(1, d)
      const off = above + v + 0.5
      return [x - (d / n) * off, y(x) + off / n]
    },
  }
}

/** Where a point of the upright frame is in the piece's pixels: turned back by the upright tilt about the centre. */
function toPiece(reading: PieceReading): (point: Point) => Point {
  const a = (reading.angle * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = reading.level.width / 2
  const cy = reading.level.height / 2
  return ([x, y]) => [cos * (x - cx) - sin * (y - cy) + cx, sin * (x - cx) + cos * (y - cy) + cy]
}

/**
 * A `width` × `height` picture whose each pixel is the piece's colour, bilinear and weighted by alpha,
 * at the point `from` gives; past the piece, the background, or clear for a cut-out.
 */
function resampled(
  reading: PieceReading,
  width: number,
  height: number,
  from: (u: number, v: number) => Point,
): Pixels {
  const { pixels: piece } = reading
  const cutOut = isCutOut(piece)
  const [br, bg, bb] = reading.background
  const outside = cutOut ? [0, 0, 0, 0] : [br, bg, bb, 255]
  const texel = (x: number, y: number, c: number) =>
    x < 0 || y < 0 || x >= piece.width || y >= piece.height
      ? (outside[c] ?? 0)
      : (piece.pixels[(y * piece.width + x) * 4 + c] ?? 0)
  const out = new Uint8Array(width * height * 4)
  for (let v = 0; v < height; v++)
    for (let u = 0; u < width; u++) {
      const [px, py] = from(u, v)
      const fx = px - 0.5
      const fy = py - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const ax = fx - x0
      const ay = fy - y0
      const taps: [number, number, number][] = [
        [x0, y0, (1 - ax) * (1 - ay)],
        [x0 + 1, y0, ax * (1 - ay)],
        [x0, y0 + 1, (1 - ax) * ay],
        [x0 + 1, y0 + 1, ax * ay],
      ]
      let alpha = 0
      const sums = [0, 0, 0]
      for (const [x, y, w] of taps) {
        const a = (texel(x, y, 3) / 255) * w
        alpha += a
        for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + texel(x, y, c) * a
      }
      const o = (v * width + u) * 4
      for (let c = 0; c < 3; c++) out[o + c] = alpha > 0 ? Math.round((sums[c] ?? 0) / alpha) : 0
      out[o + 3] = Math.round(alpha * 255)
    }
  return { width, height, pixels: out }
}
