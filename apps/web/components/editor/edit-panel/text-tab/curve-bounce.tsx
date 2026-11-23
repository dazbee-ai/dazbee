'use client'

// The Text switcher tab's Curve and bounce part: the curve's shape as a row of pictures, none
// taking it off, and while every selected text is curved, its amount; under it the bounce, none,
// wavy or random, with its amount while every text bounces and Shuffle for a random one; then the
// letter turn, of the selected run while one is being edited, else of every character. Each pick is
// one undo step, and so is a drag on an amount. Also how the other parts show the settings that
// don't apply to curved text.
import { type ReactNode, useId } from 'react'

import { Segments } from '@/components/editor/edit-panel/fields.tsx'
import { NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { set, type Target, textStyle } from '@/components/editor/edit-panel/target.ts'
import { FIELD_LABEL, PANEL_BUTTON } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { ShuffleIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import {
  amountMost,
  BOUNCE_CHOICES,
  bounceAmountPatch,
  CURVE_CHOICES,
  curveAmountPatch,
  type CurveChoice,
  pickBounce,
  pickCurve,
  sharedBounce,
  sharedCurve,
  sharedTurn,
  shufflePatch,
  TURN_MOST,
  turnAllPatch,
  turnEachPatch,
} from './curves.ts'

/** Each choice's shape, as the line its letters sit on in a 24 px box. */
const CURVE_PATHS: Record<CurveChoice, string> = {
  none: 'M4 12h16',
  arcUp: 'M4 15.5Q12 4.5 20 15.5',
  arcDown: 'M4 8.5Q12 19.5 20 8.5',
  circle: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14z',
  wave: 'M3 12c1.5-4 4.5-4 6 0s4.5 4 6 0 4.5-4 6 0',
}

/**
 * The curve's shape, read as the one the texts share or mixed, and its amount from 0 to its most
 * (`amountMost`), shown while every text is curved; each text stops at its own most.
 */
export function CurveRows({ target }: { target: Target }) {
  const p = useMessages().editor.props
  const { choice, amount } = sharedCurve(target.props)
  const marks = Object.fromEntries(
    CURVE_CHOICES.map((shape) => [shape, <CurvePicture key={shape} choice={shape} />]),
  ) as Record<CurveChoice, ReactNode>
  return (
    // On a phone every choice is a finger's height.
    <div className="flex flex-col gap-1.5 max-sm:[&_[role=radio]]:h-[44px] max-sm:[&_[role=radio]]:min-w-[44px]">
      <Segments
        name={p.curve}
        testId="text-curve"
        value={choice}
        options={CURVE_CHOICES}
        labels={p.curveShapes}
        marks={marks}
        onSet={(to) => set(target, (now) => pickCurve(now, to))}
      />
      {amount !== null && (
        <NumberField
          label={p.amount}
          name={p.curveAmount}
          testId="curve-amount"
          value={amount}
          min={0}
          max={amountMost(target.props)}
          editor={target.editor}
          onSet={(v) => set(target, (now) => curveAmountPatch(now, () => v))}
          onEach={(change) => set(target, (now) => curveAmountPatch(now, change))}
        />
      )}
    </div>
  )
}

/**
 * The bounce under its visible name: none, wavy or random, read as the one the texts share or mixed;
 * while every text bounces, its amount from 0 to 100, and while every one is random, Shuffle, which
 * gives each its next seed.
 */
export function BounceRows({ target }: { target: Target }) {
  const p = useMessages().editor.props
  const labelId = useId()
  const { choice, amount } = sharedBounce(target.props)
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className={FIELD_LABEL}>
        {p.bounce}
      </span>
      <Segments
        labelledBy={labelId}
        testId="text-bounce"
        value={choice}
        options={BOUNCE_CHOICES}
        labels={p.bounceStyles}
        onSet={(to) => set(target, (now) => pickBounce(now, to))}
      />
      {amount !== null && (
        <div className="flex items-center gap-1.5">
          <NumberField
            label={p.amount}
            name={p.bounceAmount}
            testId="bounce-amount"
            value={amount}
            min={0}
            max={100}
            editor={target.editor}
            className="min-w-0 flex-1"
            onSet={(v) => set(target, (now) => bounceAmountPatch(now, () => v))}
            onEach={(change) => set(target, (now) => bounceAmountPatch(now, change))}
          />
          {choice === 'random' && (
            <button
              type="button"
              data-testid="bounce-shuffle"
              onClick={() => set(target, shufflePatch)}
              className={cn(PANEL_BUTTON, 'shrink-0')}
            >
              <ShuffleIcon size={14} aria-hidden className="shrink-0 rtl:-scale-x-100" />
              <span>{p.shuffle}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The letter turn in degrees, −180 to 180: of the selected run while one is being edited, else of
 * every character of the texts, read as the one they share or mixed where characters differ.
 */
export function LetterTurnField({ target }: { target: Target }) {
  const p = useMessages().editor.props
  const { range } = target
  const { setStyle, changeStyle } = textStyle(target)
  const value = sharedTurn(target.props, range)
  return (
    <NumberField
      label={p.letterTurn}
      name={p.letterTurnName}
      testId="letter-turn"
      unit="°"
      value={value}
      min={-TURN_MOST}
      max={TURN_MOST}
      editor={target.editor}
      onSet={(v) => (range ? setStyle('turn', tidy(v)) : set(target, (now) => turnAllPatch(now, v)))}
      onEach={(change) =>
        range ? changeStyle('turn', change, -TURN_MOST, 0, TURN_MOST) : set(target, (now) => turnEachPatch(now, change))
      }
    />
  )
}

/** Settings that don't apply to curved text, as the Paragraph and Spacing parts show them: turned off and dimmed while `curved`. */
export function NotForCurved({ curved, children }: { curved: boolean; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', curved && 'opacity-55')}>
      <ViewOnlyFieldset off={curved}>{children}</ViewOnlyFieldset>
    </div>
  )
}

/** A choice's picture: its shape drawn as the line its letters sit on, in Iconoir's style. */
function CurvePicture({ choice }: { choice: CurveChoice }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={CURVE_PATHS[choice]} />
    </svg>
  )
}
