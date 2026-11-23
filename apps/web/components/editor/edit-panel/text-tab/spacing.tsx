'use client'

// The text's spacing, for the Text switcher tab's Spacing section: the room between its lines,
// letters and paragraphs, its box, then under Text fit shrinking to fit and the most lines it shows.
// A curved text's box mode and fit are off, each part with a line saying why.
import { boxModeSizing } from '@dazbee/doc'
import { NO_LETTER_SPACING } from '@dazbee/schema'

import { PanelPart, SwitchRow } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import {
  type Fit,
  type P,
  type Patch,
  type Props,
  set,
  shared,
  type Style,
  type Target,
  textStyle,
} from '@/components/editor/edit-panel/target.ts'
import { KNOBS, TILE, TILE_FACE_WIDE } from '@/components/editor/styles.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { cn } from '@/lib/cn.ts'
import { shownSpacing, spacingIn, type SpacingUnit, typedUnit } from '@/lib/editor/letter-spacing.ts'
import { LIMITS } from '@/lib/editor/limits.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { NotForCurved } from './curve-bounce.tsx'
import { anyCurved } from './curves.ts'

/** A text's box modes, in the order their tiles show. */
const BOX_MODES = ['autoWidth', 'autoHeight', 'fixed'] as const
type BoxMode = (typeof BOX_MODES)[number]

/** Each letter spacing unit's mark, shown after its value. */
const UNIT_MARKS: Record<SpacingUnit, string> = { px: 'px', percent: '%' }

/** The letters a box mode's tile draws in its box; the same in every language, as a font sample is. */
const SAMPLE_LETTERS = 'Aa'

/** Shrink to fit's sizes as set under Text fit, the text's size following the largest. */
const fitPatch = (now: Props, fit: Fit): Patch => ({
  shrinkToFit: fit,
  style: { ...(now.style as Style), fontSize: fit.max },
})

/** The text's spacing parts: the room between its lines, letters and paragraphs, its box, and its fit. */
export function SpacingParts({ target }: { target: Target }) {
  const t = useMessages()
  const p = t.editor.props
  return (
    <>
      <SpacingCard target={target} p={p} />
      <TextBoxCard target={target} p={p} />
      <TextFitCard target={target} p={p} />
    </>
  )
}

/**
 * The text's spacing as slider fields, one to a row: between its lines (Auto when cleared), its
 * letters, which can come closer as well as part, and its paragraphs.
 */
function SpacingCard({ target, p }: { target: Target; p: P }) {
  const { style, setStyle, changeStyle } = textStyle(target)
  return (
    <PanelPart id="spacing-card" title={p.spacing}>
      <div className={cn('grid gap-1.5', TOUCH_GAP)}>
        <NumberField
          label={p.lineHeight}
          name={p.lineHeight}
          value={style('lineHeight') as number | 'mixed' | undefined}
          step={0.05}
          min={0.5}
          max={LIMITS.lineHeight}
          fillRange={[0.8, 2]}
          placeholder={p.lineHeightAuto}
          editor={target.editor}
          onSet={(v) => setStyle('lineHeight', v)}
          onEach={(change) => changeStyle('lineHeight', change, 0.5, 1.2, LIMITS.lineHeight)}
          onClear={() => setStyle('lineHeight', undefined)}
        />
        <LetterSpacingField target={target} p={p} />
        <NumberField
          label={p.paragraphSpacing}
          name={p.paragraphSpacing}
          value={(shared(target.props.map((pr) => pr.paragraphSpacing)) ?? 0) as number | 'mixed'}
          min={0}
          max={LIMITS.paragraphSpacing}
          fillRange={[0, 60]}
          editor={target.editor}
          onSet={(v) => set(target, () => ({ paragraphSpacing: v }))}
          onEach={(change) =>
            set(target, (now) => ({
              paragraphSpacing: tidy(
                clamp(change((now.paragraphSpacing as number | undefined) ?? 0), 0, LIMITS.paragraphSpacing),
              ),
            }))
          }
        />
      </div>
    </PanelPart>
  )
}

/**
 * The text's letter spacing, shown with its unit, % of the font size or px. A value typed with a
 * unit (`2%`, `1.5px`) sets it in that unit, each text's own spacing turned into it first, so `+1px`
 * adds a pixel to what each has; a value with none keeps each text's own unit.
 */
function LetterSpacingField({ target, p }: { target: Target; p: P }) {
  const { styles, eachStyle } = textStyle(target)
  const shown = shownSpacing(styles)
  const unit = shown.unit === 'mixed' ? null : shown.unit
  /** Sets each text's letter spacing from its own, in `to` or in its own unit. */
  const each = (change: (now: number) => number, to?: SpacingUnit) =>
    eachStyle('letterSpacing', (style) => {
      const was = style.letterSpacing ?? NO_LETTER_SPACING
      const own = spacingIn(was, to ?? was.unit, style.fontSize)
      return { unit: own.unit, value: tidy(clamp(change(own.value), -LIMITS.letterSpacing, LIMITS.letterSpacing)) }
    })
  return (
    <NumberField
      label={p.letterSpacing}
      name={p.letterSpacing}
      value={shown.value}
      unit={unit ? UNIT_MARKS[unit] : ''}
      step={0.1}
      min={-LIMITS.letterSpacing}
      max={LIMITS.letterSpacing}
      fillRange={[-20, 20]}
      editor={target.editor}
      onSet={(v) => each(() => v)}
      onEach={(change) => each(change)}
      onTyped={(text, edit) => {
        const to = typedUnit(text)
        if (to === null || to === unit) return false
        each('set' in edit ? () => edit.set : edit.each, to)
        return true
      }}
    />
  )
}

/**
 * The text's box as three picture tiles: growing along a line, growing down, or holding its size.
 * A tile picked sets the sizing its box mode means (`boxModeSizing`), through the editor.
 */
function TextBoxCard({ target, p }: { target: Target; p: P }) {
  const mode = (shared(target.props.map((pr) => pr.boxMode)) ?? 'autoHeight') as BoxMode | 'mixed'
  const curved = anyCurved(target.props)
  return (
    <PanelPart id="text-box-card" title={p.textBox}>
      <NotForCurved curved={curved}>
        <RadioGroup
          label={p.boxMode}
          options={BOX_MODES}
          value={mode}
          onPick={(to) => target.editor.setSizing(target.ids, boxModeSizing(to))}
          className="grid grid-cols-3 gap-[7px]"
        >
          {BOX_MODES.map((to) => (
            <Radio key={to} value={to} data-value={to} className={TILE}>
              <span className={cn(TILE_FACE_WIDE, 'text-muted group-aria-checked:text-text')}>
                <BoxArt mode={to} />
              </span>
              <span className="w-full truncate text-center">{p.boxModes[to]}</span>
            </Radio>
          ))}
        </RadioGroup>
      </NotForCurved>
      {curved && <p className="text-caption font-medium text-muted">{p.notForCurved.box}</p>}
    </PanelPart>
  )
}

/**
 * How each box mode's tile draws it: a box round "Aa", dashed where it grows, with arrows along the
 * way it grows, or solid with its corners marked where it holds its size.
 */
function BoxArt({ mode }: { mode: BoxMode }) {
  const box =
    mode === 'autoWidth'
      ? { x: 16, y: 8, width: 32, height: 18 }
      : mode === 'autoHeight'
        ? { x: 6, y: 4, width: 52, height: 26 }
        : { x: 6, y: 8, width: 52, height: 18 }
  const marks = {
    autoWidth: 'M4 17h8M8 14l-4 3 4 3M60 17h-8M56 14l4 3-4 3',
    autoHeight: 'M58 6v22M55 9l3-3 3 3M55 25l3 3 3-3',
    fixed: 'M6 8h3M6 8v3M58 26h-3M58 26v-3',
  }
  return (
    <svg width="64" height="34" viewBox="0 0 64 34" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect {...box} rx="3" strokeDasharray={mode === 'fixed' ? undefined : '3 2'} />
      <text
        x="32"
        y="21"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        className="font-sans text-micro font-semibold"
      >
        {SAMPLE_LETTERS}
      </text>
      <path d={marks[mode]} strokeWidth={mode === 'fixed' ? 2 : 1.5} />
    </svg>
  )
}

/** The text's fit: shrinking to fit between a smallest and a largest size, and the lines shown at most. */
function TextFitCard({ target, p }: { target: Target; p: P }) {
  const value = (key: string) => shared(target.props.map((pr) => pr[key])) as unknown
  const shrink = value('shrinkToFit') as Fit | undefined | 'mixed'
  const curved = anyCurved(target.props)
  return (
    <PanelPart id="text-fit-card" title={p.textFit}>
      <NotForCurved curved={curved}>
        <SwitchRow
          name={p.shrinkToFit}
          on={shrink === 'mixed' ? 'mixed' : shrink !== undefined}
          onSet={(on) =>
            set(target, (now) => {
              const size = (now.style as Style).fontSize
              return { shrinkToFit: on ? { min: tidy(Math.max(1, size / 2)), max: size } : undefined }
            })
          }
        />
        {shrink !== undefined && shrink !== 'mixed' && (
          <div className={KNOBS}>
            {(['min', 'max'] as const).map((end) => (
              <NumberField
                key={end}
                label={p.shrinkShort[end]}
                name={p.shrinkSize[end]}
                value={shrink[end]}
                min={1}
                max={LIMITS.fontSize}
                editor={target.editor}
                onSet={(v) =>
                  set(target, (now) => {
                    const was = now.shrinkToFit as Fit | undefined
                    if (!was) return null
                    const next = { ...was, [end]: v }
                    return fitPatch(
                      now,
                      end === 'min'
                        ? { min: Math.min(next.min, next.max), max: next.max }
                        : { min: next.min, max: Math.max(next.min, next.max) },
                    )
                  })
                }
                onEach={(change) =>
                  set(target, (now) => {
                    const was = now.shrinkToFit as Fit | undefined
                    if (!was) return null
                    const v = tidy(Math.max(1, change(was[end])))
                    return fitPatch(
                      now,
                      end === 'min'
                        ? { min: Math.min(v, was.max), max: was.max }
                        : { min: was.min, max: Math.max(v, was.min) },
                    )
                  })
                }
              />
            ))}
          </div>
        )}
        <NumberField
          label={p.maxLines}
          name={p.maxLines}
          value={value('maxLines') as number | 'mixed' | undefined}
          min={0}
          placeholder={p.none}
          editor={target.editor}
          // 0, or nothing, lifts the limit.
          onSet={(v) => set(target, () => ({ maxLines: Math.round(v) >= 1 ? Math.round(v) : undefined }))}
          onClear={() => set(target, () => ({ maxLines: undefined }))}
          onEach={(change) =>
            set(target, (now) => {
              const next = Math.round(change((now.maxLines as number | undefined) ?? 0))
              return { maxLines: next >= 1 ? next : undefined }
            })
          }
        />
      </NotForCurved>
      {curved && <p className="text-caption font-medium text-muted">{p.notForCurved.fit}</p>}
    </PanelPart>
  )
}
