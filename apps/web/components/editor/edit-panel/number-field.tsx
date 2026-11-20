'use client'

// A number field of the edit panels: a knob that types, nudges and scrubs, with a menu at its end
// where it needs one, greyed with the reason while it can't be changed; and what typing into one
// keeps, a draft, so Esc throws away what was typed before it closes the menu or panel around it.
import { type CSSProperties, type ReactNode, useRef, useState } from 'react'

import type { Editor } from '@dazbee/editor'

import { NumberInput, numberKeyDown, useNumberInput } from '@/components/editor/number-input.tsx'
import { KNOB, NUMBER_TEXT } from '@/components/editor/styles.ts'
import { useWhyTip } from '@/components/ui/greyed.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { fillOf } from '@/lib/editor/fill.ts'
import { fieldStops } from '@/lib/editor/limits.ts'
import { scrubOf } from '@/lib/editor/scrub.ts'
import { type FieldEdit, fieldEdit, parseTyped, tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/**
 * What a screen reader is told of a number field's stops (`fieldStops`), as shown after `scale`:
 * each that is finite. A spinbutton told none reads a top of 0, so a field without limits of its
 * own is told LIMITS.any; one with no stop at all, as a turn, is told nothing.
 */
export const spokenStops = ({ min, max }: { min: number; max: number }, scale: number) => ({
  ...(Number.isFinite(min) && { 'aria-valuemin': tidy(min * scale) }),
  ...(Number.isFinite(max) && { 'aria-valuemax': tidy(max * scale) }),
})

export const clamp = (n: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) =>
  Math.min(max, Math.max(min, n))

/**
 * Whether the focus is in a number field with something typed in it. Such a field is the top-most
 * thing: Esc throws away what was typed and keeps the field, so the menu or panel it is in closes
 * only on the next Esc.
 */
export const typingIn = (at: Element | null) => at?.matches('input[data-draft]') === true

/**
 * What is being typed into a field, null when nothing is: `typed.current` has it as soon as it is
 * typed, before the field draws again, for a key or a blur that comes right after.
 */
export function useDraft() {
  const [draft, setState] = useState<string | null>(null)
  const typed = useRef<string | null>(null)
  const setDraft = (to: string | null) => {
    typed.current = to
    setState(to)
  }
  return [draft, setDraft, typed] as const
}

/**
 * A number, as a knob: drag it sideways to scrub the value, one undo step for the whole drag (on a
 * field with a fill the fill's edge follows the pointer; Shift goes 10 times as fast, Alt a tenth
 * as fast on a field with fractional steps, from the moment either is pressed); click it, or tab to
 * it, and its whole value is selected, so a value typed replaces it, kept with Enter, where a sum
 * typed sets it and a leading `+`, `*` or `/` shifts or scales each layer's own (`parseTyped`); nudge
 * it with the arrow keys (Shift for 10), and undo or redo the design with its keys while nothing is
 * being typed. With `min` and `max`, or
 * `fillRange` for a fill that doesn't hold the value in, a fill behind it shows where the value sits
 * between them; a range either side of 0 fills from 0 out, each way. Home and End go to `min` and
 * `max`. A value typed, stepped or dragged stops at `min` and `max`, or without them at
 * `LIMITS.any` either way. Steps are in the value as shown, after `scale`. A `unit` sits after the
 * value, outside what is typed.
 * With `onClear`, emptying the field calls it, for a value that can be left unset (its placeholder
 * shows then), mixed values too once something was typed; without, an empty field is ignored.
 * With `why`, it is greyed: it shows its value and takes no typing, stepping or dragging, and says
 * why in a tooltip, as every greyed control does. A `menu` sits at its end, past a line, as a W
 * field's sizing does; pressing it scrubs nothing.
 */
export function NumberField({
  label,
  name,
  value,
  step = 1,
  min: least,
  max: most,
  fillRange,
  line = true,
  scale = 1,
  unit = '',
  placeholder,
  editor,
  testId,
  className,
  onSet,
  onEach,
  onClear,
  why = null,
  menu,
  describedBy,
  onTyped,
}: {
  /** What the field shows at its start: its name, or a mark such as ↔. */
  label: ReactNode
  name: string
  value: number | 'mixed' | undefined
  step?: number
  min?: number | undefined
  max?: number | undefined
  /** The range the fill shows the value in, where it differs from `min` and `max`. */
  fillRange?: readonly [number, number]
  /** Whether a line marks the value at the fill's end; a field too narrow for it beside its digits has none. */
  line?: boolean
  /** Shown as the value times this, such as 100 for a percentage. */
  scale?: number
  /** Shown after the value: %, ° or px. */
  unit?: string | undefined
  placeholder?: string | undefined
  /** Makes a drag one undo step; without one, a drag is as many changes as it makes. */
  editor?: Editor | undefined
  testId?: string
  /** Looks laid over the knob's, such as its height on a phone. */
  className?: string
  onSet: (value: number) => void
  /**
   * Changes each layer's own value, given its value as stored: a step, a scrub, or a shift or a scale
   * typed (`+10`, `*2`), already held between the field's limits. On a value the layers share it
   * is the same change to each.
   */
  onEach: (change: (now: number) => number) => void
  onClear?: () => void
  /** Why the field is greyed, while it is. */
  why?: string | null
  /** A menu at the field's end, such as a side's sizing. */
  menu?: ReactNode
  /** The id of a hint beside the field that a screen reader reads with it. */
  describedBy?: string | undefined
  /**
   * Takes a value typed, as the text typed and its edit, before the field writes it, such as one
   * typed in another unit; true when it took it, so the field writes nothing.
   */
  onTyped?: ((text: string, edit: FieldEdit) => boolean) | undefined
}) {
  const t = useMessages()
  // What a value typed, stepped or dragged stops at: the field's own limits, or, without, where a
  // design would only break. `least` and `most` are the field's own, for its fill and Home and End.
  const { min, max } = fieldStops(least, most)
  const limits = { scale, min, max }
  /**
   * Writes an edit (`fieldEdit`): a value set on every layer, else its change to each one's own.
   * With `skip`, a change that leaves the value shown as it is isn't made: steps and typed edits
   * skip it, a scrub never does, as its moves can come before the field shows the last one.
   */
  const write = (edit: FieldEdit, skip: boolean) => {
    if ('set' in edit) return onSet(edit.set)
    if (skip && typeof value === 'number' && edit.each(value) === value) return
    onEach(edit.each)
  }
  const shown = value === undefined || value === 'mixed' ? '' : String(tidy(value * scale))
  const [draft, setDraft, typedNow] = useDraft()
  /** Whether Home and End have a lowest and a highest value to go to. */
  const hasEnds =
    least !== undefined && most !== undefined && Number.isFinite(least) && Number.isFinite(most) && most > least
  const range = fillRange ?? (least !== undefined && most !== undefined ? ([least, most] as const) : undefined)
  const fill = fillOf(value, range)
  const entry = useNumberInput({
    editor,
    scrub: {
      value: typeof value === 'number' ? value * scale : null,
      field: (width) => scrubOf({ step, min, max, scale, range, width }),
      onStart: () => setDraft(null),
      onScrub: (by) => write(fieldEdit({ shift: by }, limits), false),
    },
  })
  /** One step, or ten with Shift, or a tenth with Alt where the steps are fractions. */
  const stepOf = (event: { shiftKey: boolean; altKey: boolean }) =>
    step * (event.shiftKey ? 10 : event.altKey && step < 1 ? 0.1 : 1)
  const commit = (text: string) => {
    const typed = typedNow.current !== null
    setDraft(null)
    if (text.trim() === '') {
      if (onClear && (shown !== '' || (value === 'mixed' && typed))) onClear()
      return
    }
    const asked = parseTyped(text)
    if (!asked || text.trim() === shown) return
    const edit = fieldEdit(asked, limits)
    if (onTyped?.(text, edit)) return
    write(edit, true)
  }
  const text = draft ?? shown
  const hint = value === 'mixed' ? t.editor.props.mixed : placeholder
  if (why)
    return (
      <GreyedNumber
        label={label}
        name={name}
        shown={value === 'mixed' ? t.editor.props.mixed : `${shown}${unit}`}
        why={why}
        menu={menu}
        stops={spokenStops({ min, max }, scale)}
        className={className}
      />
    )
  return (
    <div
      data-scrub={name}
      title={format(t.editor.props.scrub, { name })}
      data-ranged={fill.at === null || !line ? undefined : ''}
      style={
        { '--fill-from': `${fill.from}%`, '--fill': `${fill.width}%`, '--fill-at': `${fill.at ?? 0}%` } as CSSProperties
      }
      {...entry.knob}
      className={cn(KNOB, className)}
    >
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      <NumberInput
        entry={entry}
        text={text}
        hint={hint}
        strong={fill.at !== null}
        name={name}
        role="spinbutton"
        aria-label={name}
        aria-describedby={describedBy}
        aria-valuenow={typeof value === 'number' ? tidy(value * scale) : undefined}
        {...spokenStops({ min, max }, scale)}
        aria-valuetext={value === 'mixed' ? t.editor.props.mixed : shown ? `${shown}${unit}` : placeholder}
        data-testid={testId}
        data-draft={draft === null ? undefined : ''}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (typedNow.current !== null) commit(event.target.value)
        }}
        onKeyDown={(event) =>
          numberKeyDown(event, entry, {
            editor,
            typed: typedNow.current !== null,
            commit,
            discard: () => setDraft(null),
            step: (sign, keys) => write(fieldEdit({ shift: sign * stepOf(keys) }, limits), true),
            ends: hasEnds && draft === null ? { home: () => onSet(min), end: () => onSet(max) } : undefined,
          })
        }
      />
      {unit && (shown !== '' || !!draft) && (
        // Against the digits: back over the gap, and over the input's room for the caret where that
        // is on its side, after digits that read left to right.
        <span aria-hidden className={cn(NUMBER_TEXT, 'relative -ms-[calc(0.5rem+2px)] shrink-0 rtl:-ms-2')}>
          {unit}
        </span>
      )}
      {menu && <FieldMenu>{menu}</FieldMenu>}
    </div>
  )
}

/**
 * A number field greyed out: its label and value, which nothing types, steps or drags, with the
 * not-allowed pointer and a tooltip saying why under the pointer, on keyboard focus and on a tap.
 */
function GreyedNumber({
  label,
  name,
  shown,
  why,
  menu,
  stops,
  className,
}: {
  label: ReactNode
  name: string
  shown: string
  why: string
  menu: ReactNode
  /** Where the field stops, as a screen reader is told (`spokenStops`). */
  stops: ReturnType<typeof spokenStops>
  className?: string | undefined
}) {
  const tip = useWhyTip<HTMLDivElement>(why)
  return (
    <Tooltip {...tip.tooltip}>
      <div
        ref={tip.ref}
        role="spinbutton"
        tabIndex={0}
        aria-label={name}
        aria-disabled="true"
        {...stops}
        aria-valuetext={shown}
        aria-description={why}
        data-scrub={name}
        onClick={tip.tap}
        onPointerLeave={tip.leave}
        className={cn(KNOB, 'cursor-not-allowed opacity-40 hover:border-line', FOCUS_RING, className)}
      >
        <span className="relative min-w-0 flex-1 truncate">{label}</span>
        <span className={NUMBER_TEXT}>{shown}</span>
        {menu && <FieldMenu>{menu}</FieldMenu>}
      </div>
    </Tooltip>
  )
}

/**
 * A menu at a number field's end, past a line: a press on it opens the menu and scrubs nothing,
 * and its own field draws no border of its own. On a phone or a touch screen it is 44 px wide at least.
 */
function FieldMenu({ children }: { children: ReactNode }) {
  return (
    <span
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      className="relative -me-1.5 flex shrink-0 items-center self-stretch border-s border-line ps-1 [&>button]:justify-center max-sm:[&>button]:min-w-[44px] [@media(hover:none)]:[&>button]:min-w-[44px]"
    >
      {children}
    </span>
  )
}
