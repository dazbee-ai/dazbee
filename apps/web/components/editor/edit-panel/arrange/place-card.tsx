'use client'

// Arrange's numbers for the selected layers: their size, each side's sizing and, where auto layout
// sizes them, its least and most, their place, their turn, the flips and Lock ratio.
import { type Axis } from '@dazbee/doc'
import { type ShortcutAction } from '@dazbee/editor'
import { ratioLocked } from '@dazbee/schema'

import { Switch } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import {
  num,
  type P,
  type PanelProps,
  type Props,
  set,
  shared,
  type Target,
} from '@/components/editor/edit-panel/target.ts'
import { KNOB_SWITCH, KNOBS, PANEL_PART, SWITCH } from '@/components/editor/styles.ts'
import { GreyedButton } from '@/components/ui/greyed.tsx'
import { FlipHorizontalIcon, FlipVerticalIcon, type Icon } from '@/components/ui/icons.tsx'
import { offersChoice } from '@/components/ui/select.tsx'
import { sizePatch, tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { hasLimits, LIMIT_KEYS, limitChoices, type LimitEnd, limitPatch, limitsApply, offForCurved } from './limits.ts'
import { PanelAction } from './panel-action.tsx'
import { sizingChoices, SizingMenu } from './sizing-menu.tsx'

/** The two flips beside Rotate, each by its icon. */
const FLIPS = [
  { action: 'flipHorizontal', icon: FlipHorizontalIcon },
  { action: 'flipVertical', icon: FlipVerticalIcon },
] as const satisfies readonly { action: ShortcutAction; icon: Icon }[]

/** A layer's props with its width and height as numbers, as a size typed into Arrange reads them. */
const sizedAs = (now: Props) => ({ ...now, width: num(now, 'width'), height: num(now, 'height') })

/** The layers' turn in degrees, wrapping round at 360; groups and booleans turn with what they hold. */
export function RotationField({ target, p, label, why }: { target: Target; p: P; label: string; why: string | null }) {
  return (
    <NumberField
      label={label}
      unit="°"
      name={p.rotationName}
      value={shared(target.props.map((pr) => num(pr, 'rotation') ?? 0))}
      // A turn wraps round at 360, so any number typed is one.
      min={Number.NEGATIVE_INFINITY}
      max={Number.POSITIVE_INFINITY}
      editor={target.editor}
      why={why}
      onSet={(v) => set(target, () => ({ rotation: tidy(((v % 360) + 360) % 360) }))}
      onEach={(change) =>
        set(target, (now) => ({ rotation: tidy(((change(num(now, 'rotation') ?? 0) % 360) + 360) % 360) }))
      }
    />
  )
}

/**
 * Arrange's numbers, with no heading: the box's width and height, each with how that side sizes
 * beside it, then where it sits, then its turn, the two flips (with `flips`) and Lock ratio, two to
 * a row. Each shows the box as drawn, where auto layout places and sizes it, and steps from there. A width or height
 * set fixes that side, as the editor fixes each side a size is set on. Lock ratio is stored on each
 * layer, so the canvas's handles keep it too, and shows mixed while the layers differ; a width or
 * height set moves the other side of each layer that has it on, and fixes it too. Groups and booleans take their box
 * from what they hold, so they have only X and Y, and the flips, which mirror what they hold.
 * While `why` says the layers are locked, each is greyed, saying so; X and Y are greyed too while
 * `placedWhy` says auto layout places them; the flips and Lock ratio are greyed only while
 * `flipWhy` says a layer is locked against resizing.
 */
export function PlaceCard({
  target,
  design,
  p,
  why,
  placedWhy,
  flipWhy,
  flips,
}: {
  target: Target
  design: PanelProps['design']
  p: P
  why: string | null
  placedWhy: string | null
  flipWhy: string | null
  /** Whether the flips show: they only act, so a tab that may only view has none. */
  flips: boolean
}) {
  const t = useMessages()
  const placing = t.editor.bar.placing
  const sized = target.types.every((type) => type !== 'group' && type !== 'boolean')
  const ratioOn = shared(target.props.map(ratioLocked))
  const sides = [
    { key: 'width', label: p.width, name: p.widthName },
    { key: 'height', label: p.height, name: p.heightName },
  ] as const
  // Where auto layout sizes the layers, a side's least and most show once any of them has one.
  const limited = sized && limitsApply(design, target.ids)
  const limitedSides = sides.filter(({ key }) => limited && hasLimits(target.props, key))
  // A curved text's box fits its letters, so its limits show their values, off.
  const limitWhy = why ?? (offForCurved(target.props).size > 0 ? p.notForCurved.sizing : null)
  const spots = [
    { key: 'x', label: p.x, name: p.xName },
    { key: 'y', label: p.y, name: p.yName },
  ] as const
  return (
    <div className={PANEL_PART} data-testid="layout-card">
      <div className={KNOBS}>
        {sized &&
          sides.map((f) => {
            const choices = sizingChoices(target, design, f.key)
            const limits = limited ? limitChoices(target.props, f.key) : []
            return (
              <NumberField
                key={f.key}
                label={f.label}
                name={f.name}
                value={shared(target.props.map((pr) => num(pr, f.key)))}
                min={0}
                editor={target.editor}
                why={why}
                menu={
                  offersChoice(choices) || limits.length > 0 ? (
                    <SizingMenu
                      target={target}
                      p={p}
                      axis={f.key}
                      choices={choices}
                      limits={limits}
                      disabled={why !== null}
                    />
                  ) : undefined
                }
                onSet={(v) => set(target, (now) => sizePatch(sizedAs(now), f.key, v))}
                onEach={(change) =>
                  set(target, (now) => sizePatch(sizedAs(now), f.key, tidy(clamp(change(num(now, f.key)), 0))))
                }
              />
            )
          })}
        {limitedSides.flatMap(({ key }) =>
          (['min', 'max'] as const).map((end) => (
            <LimitField key={`${key}-${end}`} target={target} p={p} axis={key} end={end} why={limitWhy} />
          )),
        )}
        {spots.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            name={f.name}
            value={shared(target.props.map((pr) => num(pr, f.key)))}
            editor={target.editor}
            why={placedWhy}
            onSet={(v) => set(target, () => ({ [f.key]: v }))}
            onEach={(change) => set(target, (now) => ({ [f.key]: tidy(change(num(now, f.key))) }))}
          />
        ))}
        {sized && <RotationField target={target} p={p} label={placing.rotate} why={why} />}
        {flips && (
          <div className="grid grid-cols-2 gap-1.5 max-sm:gap-[8px]" data-testid="flip-buttons">
            {FLIPS.map(({ action, icon }) => (
              <PanelAction
                key={action}
                target={target}
                action={action}
                name={t.editor.actions[action]}
                icon={icon}
                why={flipWhy}
                knob
              />
            ))}
          </div>
        )}
        {sized &&
          (flipWhy ? (
            <GreyedButton
              why={flipWhy}
              role={ratioOn === 'mixed' ? 'checkbox' : 'switch'}
              aria-checked={ratioOn}
              data-testid="lock-ratio"
              className={KNOB_SWITCH}
            >
              {placing.lockRatio}
              <span aria-hidden className={SWITCH} />
            </GreyedButton>
          ) : (
            <Switch
              on={ratioOn}
              onSet={(on) => set(target, () => ({ lockRatio: on ? true : undefined }))}
              testId="lock-ratio"
              className={KNOB_SWITCH}
            >
              {placing.lockRatio}
            </Switch>
          ))}
      </div>
    </div>
  )
}

/**
 * A side's least or most size where auto layout sizes the layers: none shows as None, a number
 * typed sets it, moving the other end to it where it would pass it, and emptying it takes it out.
 */
function LimitField({
  target,
  p,
  axis,
  end,
  why,
}: {
  target: Target
  p: P
  axis: Axis
  end: LimitEnd
  why: string | null
}) {
  const key = LIMIT_KEYS[axis][end]
  const value = shared(target.props.map((pr) => pr[key] as number | undefined))
  return (
    <NumberField
      label={p.limits[axis][end]}
      name={p.limitNames[axis][end]}
      value={value}
      placeholder={p.noLimit}
      min={0}
      editor={target.editor}
      why={why}
      onSet={(v) => set(target, (now) => limitPatch(now, axis, end, v))}
      onEach={(change) =>
        set(target, (now) =>
          limitPatch(now, axis, end, tidy(clamp(change((now[key] as number | undefined) ?? num(now, axis)), 0))),
        )
      }
      onClear={() => set(target, () => ({ [key]: undefined }))}
    />
  )
}
