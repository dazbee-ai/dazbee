// The Curve and bounce part, read and written: the curve, the bounce and the letter turn the
// selected texts share, and the patch a pick of a shape, a bounce, an amount, Shuffle or a letter
// turn writes to each text.
import type { RunStyle, TextBounce, TextCurve, TextRun } from '@dazbee/schema'

import { type Patch, type Props, shared, type Style } from '@/components/editor/edit-panel/target.ts'
import { tidy } from '@/lib/editor/size.ts'

/** A curve's shape, or none for a straight text. */
export type CurveChoice = 'none' | TextCurve['shape']

/** The part's choices, in the order they show. */
export const CURVE_CHOICES = ['none', 'arcUp', 'arcDown', 'circle', 'wave'] as const satisfies readonly CurveChoice[]

/** The amount a shape picked on a straight text starts at, or its most where that is lower. */
export const CURVE_START = 50

/**
 * Where each shape's amount stops in the panel: past it, letters crowd where the curve bends their
 * tops together, on an arc down's inner line and in a wave's dips. An arc up and a circle turn their
 * tops outwards, so they go to 100.
 */
export const CURVE_MOST: Record<TextCurve['shape'], number> = { arcUp: 100, arcDown: 50, circle: 100, wave: 40 }

/** A bounce's style, or none for a text whose letters sit on their line. */
export type BounceChoice = 'none' | TextBounce['style']

/** The part's bounce choices, in the order they show. */
export const BOUNCE_CHOICES = ['none', 'wavy', 'random'] as const satisfies readonly BounceChoice[]

/** The amount and seed a bounce picked on a text with none starts at. */
export const BOUNCE_START = { amount: 30, seed: 1 } as const

/**
 * The texts' curve as the part shows it: the shape they share, none where every one is straight, or
 * mixed; and the amount they share, or mixed, null unless every one is curved.
 */
export function sharedCurve(props: readonly Props[]): {
  choice: CurveChoice | 'mixed'
  amount: number | 'mixed' | null
} {
  const curves = props.map(curveOf)
  const choice = shared(curves.map((curve) => curve?.shape ?? 'none'))
  const curved = curves.filter((curve) => curve !== undefined)
  const amount = curved.length === curves.length ? shared(curved.map((curve) => curve.amount)) : null
  return { choice, amount }
}

/**
 * The patch that gives a text the shape `to`: none takes its curve off; a shape keeps its amount, or
 * starts a straight text at CURVE_START, held at the shape's most. Null where nothing changes.
 */
export function pickCurve(now: Props, to: CurveChoice): Patch | null {
  const was = curveOf(now)
  if (to === 'none') return was ? { curve: undefined } : null
  const amount = Math.min(was?.amount ?? CURVE_START, CURVE_MOST[to])
  if (was?.shape === to && was.amount === amount) return null
  return { curve: { shape: to, amount } }
}

/**
 * Where the amount field stops for the texts: the highest of each curved text's own most, its
 * shape's, or its amount where an agent set it past that, so a step from it doesn't jump down.
 */
export function amountMost(props: readonly Props[]): number {
  return Math.max(0, ...props.flatMap((pr) => (pr.curve ? [mostOf(pr.curve as TextCurve)] : [])))
}

/**
 * The patch that changes a curved text's amount from its own, held between 0 and its most (its
 * shape's, or its own amount where that is higher); null for a straight text.
 */
export function curveAmountPatch(now: Props, change: (amount: number) => number): Patch | null {
  const was = curveOf(now)
  if (!was) return null
  const amount = Math.min(mostOf(was), Math.max(0, change(was.amount)))
  return amount === was.amount ? null : { curve: { ...was, amount } }
}

/** Whether any of the texts is curved, which turns off the settings that don't apply to curved text. */
export function anyCurved(props: readonly Props[]): boolean {
  return props.some((pr) => curveOf(pr) !== undefined)
}

/**
 * The texts' bounce as the part shows it: the style they share, none where no text bounces, or
 * mixed; and the amount they share, or mixed, null unless every one bounces.
 */
export function sharedBounce(props: readonly Props[]): {
  choice: BounceChoice | 'mixed'
  amount: number | 'mixed' | null
} {
  const bounces = props.map(bounceOf)
  const choice = shared(bounces.map((bounce) => bounce?.style ?? 'none'))
  const bounced = bounces.filter((bounce) => bounce !== undefined)
  const amount = bounced.length === bounces.length ? shared(bounced.map((bounce) => bounce.amount)) : null
  return { choice, amount }
}

/**
 * The patch that gives a text the bounce `to`: none takes its bounce off; a style keeps the text's
 * amount and seed, or starts one with none at BOUNCE_START. Null where nothing changes.
 */
export function pickBounce(now: Props, to: BounceChoice): Patch | null {
  const was = bounceOf(now)
  if (to === 'none') return was ? { bounce: undefined } : null
  if (was?.style === to) return null
  const { amount, seed } = was ?? BOUNCE_START
  return { bounce: { style: to, amount, seed } }
}

/** The patch that changes a bounced text's amount from its own, held between 0 and 100; null for a text with no bounce. */
export function bounceAmountPatch(now: Props, change: (amount: number) => number): Patch | null {
  const was = bounceOf(now)
  if (!was) return null
  const amount = Math.min(100, Math.max(0, change(was.amount)))
  return amount === was.amount ? null : { bounce: { ...was, amount } }
}

/** The patch Shuffle writes: a random bounce's next seed, the whole number after its own; null for any other text. */
export function shufflePatch(now: Props): Patch | null {
  const was = bounceOf(now)
  return was?.style === 'random' ? { bounce: { ...was, seed: was.seed + 1 } } : null
}

/**
 * The letter turn shown: the one the characters of the selected `range` share while a text is being
 * edited, else every character of the texts; 0 where none sets one, or mixed.
 */
export function sharedTurn(props: readonly Props[], range?: readonly Style[]): number | 'mixed' {
  if (range) return shared([...new Set(range.map((style) => (style.turn as number | undefined) ?? 0))])
  return shared([...new Set(props.flatMap(turnsOf))])
}

/**
 * The patch that turns every character of a text by `turn` degrees: its base style's turn, none at
 * 0, and its runs' own turns taken off. Null where nothing changes.
 */
export function turnAllPatch(now: Props, turn: number): Patch | null {
  const style = withTurn(now.style as RunStyle, tidy(turn))
  const runs = runsOf(now).flatMap((run) => {
    if (run.style.turn === undefined) return [run]
    const kept = withTurn(run.style, 0)
    return Object.keys(kept).length > 0 ? [{ ...run, style: kept }] : []
  })
  return changed(now, { style, runs })
}

/**
 * The patch that changes each character's turn of a text from its own: its base style's and each
 * run's that sets one, each held between −180 and 180. Null where nothing changes.
 */
export function turnEachPatch(now: Props, change: (turn: number) => number): Patch | null {
  const turned = (turn: number | undefined) => tidy(Math.min(180, Math.max(-180, change(turn ?? 0))))
  const base = now.style as RunStyle
  const style = withTurn(base, turned(base.turn))
  const runs = runsOf(now).map((run) =>
    run.style.turn === undefined ? run : { ...run, style: { ...run.style, turn: turned(run.style.turn) } },
  )
  return changed(now, { style, runs })
}

/** A text's curve, if it has one. */
function curveOf(props: Props): TextCurve | undefined {
  return props.curve as TextCurve | undefined
}

/** Where a curve's amount stops: its shape's most, or its own amount where that is higher. */
function mostOf(curve: TextCurve): number {
  return Math.max(CURVE_MOST[curve.shape], curve.amount)
}

/** A text's bounce, if it has one. */
function bounceOf(props: Props): TextBounce | undefined {
  return props.bounce as TextBounce | undefined
}

/**
 * The turns a text's characters take: its base style's, 0 where it sets none, unless runs that set
 * a turn cover every character, and each such run's own.
 */
function turnsOf(props: Props): number[] {
  const turning = runsOf(props)
    .filter((run) => run.style.turn !== undefined)
    .toSorted((a, b) => a.start - b.start)
  let reached = 0
  for (const run of turning) if (run.start <= reached) reached = Math.max(reached, run.end)
  const length = ((props.text ?? '') as string).length
  const base = length === 0 || reached < length ? [(props.style as RunStyle).turn ?? 0] : []
  return [...base, ...turning.map((run) => run.style.turn ?? 0)]
}

/** A text's runs. */
function runsOf(props: Props): TextRun[] {
  return (props.runs ?? []) as TextRun[]
}

/** A style with its turn set, or taken off at 0. */
function withTurn<T extends RunStyle>(style: T, turn: number): T {
  const out: RunStyle = { ...style }
  if (turn === 0) delete out.turn
  else out.turn = turn
  return out as T
}

/** The patch `to` where it changes the text's style or runs, else null. */
function changed(now: Props, to: { style: RunStyle; runs: TextRun[] }): Patch | null {
  const same =
    JSON.stringify(to.style) === JSON.stringify(now.style) && JSON.stringify(to.runs) === JSON.stringify(runsOf(now))
  return same ? null : to
}
