'use client'

// The menu beside Arrange's W and H that sets how that side of the layers sizes, offering only
// what can apply, and shown only when that is more than Fixed; where auto layout sizes the layers,
// it also adds that side's least or most size, or takes both out. Fill and the limits are off,
// saying why, for curved text.
import { type Axis, fillApplies, hugApplies, type Sizing, sizingOf } from '@dazbee/doc'
import { type Design } from '@dazbee/schema'

import { type P, set, shared, type Target } from '@/components/editor/edit-panel/target.ts'
import { Select } from '@/components/ui/select.tsx'

import { addedLimit, type LimitChoice, noLimits, offForCurved } from './limits.ts'

const SIZINGS: readonly Sizing[] = ['fixed', 'hug', 'fill']

/**
 * What a side of the layers can size to: Fixed; Fit content where it can apply (`hugApplies`); and
 * Fill where the flow of the layer's box can stretch it on that side (`fillApplies`). A sizing a
 * layer has keeps its place.
 */
export function sizingChoices(target: Target, design: Design, axis: Axis): Sizing[] {
  const sizings = target.props.map((props, i) => sizingOf({ type: target.types[i], props })[axis])
  const applies = (sizing: Sizing, id: string) => {
    if (sizing === 'hug') return hugApplies(design, id)
    if (sizing === 'fill') return fillApplies(design, id, axis)
    return true
  }
  return SIZINGS.filter((sizing) => sizings.includes(sizing) || target.ids.every((id) => applies(sizing, id)))
}

/**
 * The menu beside W or H: how that side of the layers sizes, among `choices` (`sizingChoices`),
 * then the items for its limits among `limits` (`limitChoices`), those that don't apply to a curved
 * text among them off with the reason (`offForCurved`). Greyed while `disabled`. The editor sets the
 * sizing picked (`setSizing`); a limit is added at the size the layers are drawn.
 */
export function SizingMenu({
  target,
  p,
  axis,
  choices,
  limits,
  disabled,
}: {
  target: Target
  p: P
  axis: Axis
  choices: readonly Sizing[]
  limits: readonly LimitChoice[]
  disabled: boolean
}) {
  const value = shared(target.props.map((props, i) => sizingOf({ type: target.types[i], props })[axis]))
  const off = offForCurved(target.props)
  const offWhy = (choice: Sizing | LimitChoice) =>
    off.has(choice) ? { disabled: true, hint: p.notForCurved.sizing } : {}
  return (
    <Select
      name="sizing"
      label={p.sizingAxis[axis]}
      value={value === 'mixed' ? '' : value}
      placeholder={p.mixed}
      disabled={disabled}
      options={[
        ...choices.map((sizing) => ({
          value: sizing,
          label: p.sizings[sizing],
          ...(sizing === 'hug' ? { short: p.sizingShort.hug } : {}),
          hint: p.sizingHints[axis][sizing],
          ...offWhy(sizing),
        })),
        ...limits.map((choice) => ({ value: choice, label: p.limitChoices[axis][choice], ...offWhy(choice) })),
      ]}
      onChange={(to) => {
        if (to === 'add-min' || to === 'add-max')
          set(target, (now) => addedLimit(now, axis, to === 'add-min' ? 'min' : 'max'))
        else if (to === 'remove') set(target, () => noLimits(axis))
        else target.editor.setSizing(target.ids, { [axis]: to as Sizing })
      }}
      className="h-full gap-0.5 border-0 bg-transparent px-1 text-label text-text hover:bg-hover"
    />
  )
}
