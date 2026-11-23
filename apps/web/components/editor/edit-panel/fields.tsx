'use client'

// The edit panels' fields and parts: a choice from a list, a part of a panel under its heading and
// how that heading looks, a switch, and a row of segments.
import { createContext, type ReactNode, useContext } from 'react'

import { PANEL_HEADING, PANEL_PART, SECTION_TITLE, SELECT, SWITCH, SWITCH_ROW } from '@/components/editor/styles.ts'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** Whether what is inside stands under a title, so a heading in it heads a part. */
const UnderTitle = createContext(false)

/**
 * How a heading in a switcher tab looks: at the top, a section's title, 13 px bold, in every
 * switcher tab alike; under a title, a part's heading, as small as the field labels.
 */
export const useTitleLook = () => (useContext(UnderTitle) ? PANEL_HEADING : SECTION_TITLE)

/** A heading in a switcher tab, looking as `useTitleLook` says. */
export function PanelTitle({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <h3 id={id} className={cn(useTitleLook(), className)}>
      {children}
    </h3>
  )
}

/**
 * A choice from a list, named `name`, reading Mixed while the layers differ; greyed while `why`
 * says why there is nothing to pick.
 */
export function Choice<T extends string>({
  name,
  value,
  options,
  labels,
  onSet,
  why = null,
  testId,
}: {
  name: string
  value: T | 'mixed' | undefined
  options: readonly T[]
  labels: Record<T, string>
  onSet: (value: T) => void
  why?: string | null
  testId?: string | undefined
}) {
  const t = useMessages()
  return (
    <Select
      name="choice"
      label={name}
      value={value === 'mixed' || value === undefined ? '' : value}
      placeholder={t.editor.props.mixed}
      options={options.map((option) => ({ value: option, label: labels[option] }))}
      onChange={(next) => onSet(next as T)}
      why={why}
      testId={testId}
      className={SELECT}
    />
  )
}

/**
 * A titled part of a switcher tab: its heading (`PanelTitle`), a note and an action at the end, its
 * controls, whose own headings head parts of it.
 */
export function PanelPart({
  id,
  title,
  note,
  action,
  className,
  children,
}: {
  id: string
  title: string
  note?: string | null | undefined
  action?: ReactNode
  /** Laid over the part's own look. */
  className?: string
  children?: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={cn(PANEL_PART, className)} data-testid={id}>
      {/* As tall as its heading, or as its action where that is taller, as on a phone. */}
      <div className="flex min-h-7 items-center gap-2">
        <PanelTitle id={`${id}-title`} className="min-w-0 flex-1 truncate">
          {title}
        </PanelTitle>
        {note && <span className="min-w-0 max-w-[60%] truncate text-caption font-medium text-muted">{note}</span>}
        {action}
      </div>
      <UnderTitle.Provider value>{children}</UnderTitle.Provider>
    </section>
  )
}

/** A switch on its own, named by `label`, or with its name beside it as `children`. */
export function Switch({
  on,
  onSet,
  label,
  testId,
  className,
  children,
}: {
  on: boolean | 'mixed'
  onSet: (on: boolean) => void
  label?: string | undefined
  testId?: string
  className: string
  children?: ReactNode
}) {
  return (
    // A switch has no mixed state: while the layers differ it is a checkbox that says so.
    <button
      type="button"
      role={on === 'mixed' ? 'checkbox' : 'switch'}
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onSet(on !== true)}
      className={className}
    >
      {children}
      <span aria-hidden className={SWITCH} />
    </button>
  )
}

/**
 * A row that turns something on or off: its name, then a switch. `label` names the switch in full
 * where rows alike would share a name, the visible name in it.
 */
export function SwitchRow({
  name,
  label,
  on,
  onSet,
}: {
  name: string
  label?: string
  on: boolean | 'mixed'
  onSet: (on: boolean) => void
}) {
  return (
    <Switch on={on} onSet={onSet} label={label} className={SWITCH_ROW}>
      {name}
    </Switch>
  )
}

/**
 * A row of choices of which one is on; `marks` shows a short mark in place of a choice's name, and
 * `icons` an icon over it, on a taller choice. The choices in `offChoices` are turned off. It is named by
 * `name`, or by the visible label whose id is `labelledBy`.
 */
export function Segments<T extends string>({
  name,
  labelledBy,
  testId,
  value,
  options,
  labels,
  marks,
  icons,
  offChoices,
  onSet,
}: {
  name?: string
  labelledBy?: string
  testId?: string
  value: T | 'mixed'
  options: readonly T[]
  labels: Record<T, string>
  /** What each choice shows in place of its label, which then names it to screen readers and as its tooltip. */
  marks?: Record<T, ReactNode>
  icons?: Record<T, ReactNode>
  offChoices?: readonly T[] | undefined
  onSet: (to: T) => void
}) {
  const look = cn(SEGMENT, icons && 'flex h-auto flex-col items-center gap-1 py-2 max-sm:h-auto')
  const face = (option: T) =>
    icons ? (
      <>
        {icons[option]}
        <span className="max-w-full truncate">{labels[option]}</span>
      </>
    ) : (
      (marks?.[option] ?? labels[option])
    )
  return (
    <RadioGroup
      label={name}
      labelledBy={labelledBy}
      testId={testId}
      options={options}
      value={value}
      onPick={onSet}
      className={SEGMENTS}
    >
      {options.map((option) => (
        <Radio
          key={option}
          value={option}
          aria-label={marks ? labels[option] : undefined}
          title={marks ? labels[option] : undefined}
          data-value={option}
          disabled={offChoices?.includes(option)}
          className={look}
        >
          {face(option)}
        </Radio>
      ))}
    </RadioGroup>
  )
}
