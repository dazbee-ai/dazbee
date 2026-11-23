// The curve fit, tried only for a piece whose curve check fired: the face picked on the piece
// straightened along its curve (`curve-frame.ts`), drawn with each shape the frame allows over the
// piece turned upright, across the amounts, the closest by overlap kept, and its amount and the
// piece's turn refined by a step halved each round, as the finer fit steps, bounded by its rounds and
// reading no clock.

import type { TextCurve } from '@dazbee/schema'

import { letterBlobs } from '../curve-check.ts'
import { fitSine, type Sine, sineDistance, trimmedFit } from '../curve-fits.ts'
import type { TextDrawer, TextLook } from '../draw-text.ts'
import { type Fitted, placeByInk } from '../light/fit.ts'
import { closeness, finish, type Verified, type VerifyTarget } from '../light/verify.ts'
import type { PieceReading } from '../read-piece.ts'
import { type CurveFrame, LETTER_INK, turnedBy } from './curve-frame.ts'

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

/** The first step, in degrees, the piece is turned by as its curve is refined, halved with the amount's. */
const TURN_STEP = 2

/** A drawn wave's length, in its text's size. */
const WAVE_LENGTH = 6

/** The fewest letters a wave's height is fitted again through. */
const WAVE_LETTERS = 4

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
    // A drawn wave's length is `WAVE_LENGTH` of its text's size, so its height is fitted again at that length.
    const along = waveOfLook(frame, sine, look.size) ?? sine
    const amount = clampAmount((Math.hypot(along.p, along.q) / look.size) * 100)
    looks.push({ ...look, curve: { shape: 'wave', amount } })
  }
  return looks
}

/**
 * The sine through the top line's letters' feet at the wavelength a wave drawn at `size` has,
 * `WAVE_LENGTH` of the size; null when too few letters stand on the top line.
 */
function waveOfLook(frame: CurveFrame, sine: Sine, size: number): Sine | null {
  const { level } = frame.reading
  const reach = frame.reading.curve?.letterHeight ?? size / 2
  const feet = letterBlobs(level, { down: (x, y) => sineDistance(sine, [x, y]), inkFrom: LETTER_INK })
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
