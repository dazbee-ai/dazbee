// The Curve and bounce part's curve, read and written: the shape and amount the selected texts
// share, and the patch a pick of a shape or an amount writes to each text.
import type { TextCurve } from '@dazbee/schema'

import { type Patch, type Props, shared } from '@/components/editor/edit-panel/target.ts'

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

/** The patch that changes a curved text's amount from its own, held between 0 and its shape's most; null for a straight text. */
export function curveAmountPatch(now: Props, change: (amount: number) => number): Patch | null {
  const was = curveOf(now)
  if (!was) return null
  const amount = Math.min(CURVE_MOST[was.shape], Math.max(0, change(was.amount)))
  return amount === was.amount ? null : { curve: { ...was, amount } }
}

/** Whether any of the texts is curved, which turns off the settings that don't apply to curved text. */
export function anyCurved(props: readonly Props[]): boolean {
  return props.some((pr) => curveOf(pr) !== undefined)
}

/** A text's curve, if it has one. */
function curveOf(props: Props): TextCurve | undefined {
  return props.curve as TextCurve | undefined
}
