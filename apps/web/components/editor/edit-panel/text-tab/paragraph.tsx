'use client'

// The text's paragraph, as rows of icon choices, each named by its tooltip: how its lines line up
// beside where they sit up and down in the box, its list beside which way it reads, its case, then
// where its lines break. A curved text's list, justify and wrap style are off, with a line saying
// they don't apply.
import { type ReactNode } from 'react'

import { Segments } from '@/components/editor/edit-panel/fields.tsx'
import { set, shared, type Target, textStyle } from '@/components/editor/edit-panel/target.ts'
import {
  ListBulletsIcon,
  ListNumbersIcon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextLinesIcon,
} from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { NotForCurved } from './curve-bounce.tsx'
import { anyCurved } from './curves.ts'
import { TextDirectionIcon, VerticalPlaceIcon } from './paragraph-icons.tsx'

/** How each case shows on its button: the same letters in every language, as a font sample is. */
const CASE_MARKS = { none: 'Ab', upper: 'AB', lower: 'ab', title: 'Aa' }

/** Start and end turn round with the reading direction, so their icons do too. */
const ALIGN_MARKS = {
  start: <TextAlignLeftIcon size={16} className="rtl:-scale-x-100" />,
  center: <TextAlignCenterIcon size={16} />,
  end: <TextAlignRightIcon size={16} className="rtl:-scale-x-100" />,
  justify: <TextAlignJustifyIcon size={16} />,
}

const VERTICAL_MARKS = {
  top: <VerticalPlaceIcon place="top" />,
  middle: <VerticalPlaceIcon place="middle" />,
  bottom: <VerticalPlaceIcon place="bottom" />,
}

const LIST_MARKS = {
  none: <TextLinesIcon size={16} />,
  bullet: <ListBulletsIcon size={16} className="rtl:-scale-x-100" />,
  number: <ListNumbersIcon size={16} className="rtl:-scale-x-100" />,
}

const DIRECTION_MARKS = {
  auto: <TextDirectionIcon direction="auto" />,
  ltr: <TextDirectionIcon direction="ltr" />,
  rtl: <TextDirectionIcon direction="rtl" />,
}

/**
 * The paragraph's choices. Alignment, direction, vertical place, the list and the wrap style are
 * the layers' own; the case is the selected run's while one text is being edited.
 */
export function ParagraphRows({ target }: { target: Target }) {
  const t = useMessages()
  const p = t.editor.props
  const bar = t.editor.bar
  const rows = bar.alignRows
  const value = <T extends string>(key: string, unset: T) => shared(target.props.map((pr) => (pr[key] ?? unset) as T))
  const { style, setStyle } = textStyle(target)
  const curved = anyCurved(target.props)
  return (
    // On a phone every choice is a finger's height.
    <div className="flex flex-col gap-1.5 max-sm:[&_[role=radio]]:h-[44px] max-sm:[&_[role=radio]]:min-w-[44px]">
      <Pair wide>
        <Segments
          name={rows.align}
          testId="text-align"
          value={value<'start' | 'center' | 'end' | 'justify'>('align', 'start')}
          options={['start', 'center', 'end', 'justify'] as const}
          labels={p.textAligns}
          marks={ALIGN_MARKS}
          offChoices={curved ? ['justify'] : undefined}
          onSet={(align) => set(target, () => ({ align }))}
        />
        <Segments
          name={rows.vertical}
          testId="text-vertical"
          value={value<'top' | 'middle' | 'bottom'>('verticalAlign', 'top')}
          options={['top', 'middle', 'bottom'] as const}
          labels={p.verticalAligns}
          marks={VERTICAL_MARKS}
          onSet={(verticalAlign) => set(target, () => ({ verticalAlign }))}
        />
      </Pair>
      <Pair>
        <NotForCurved curved={curved}>
          <Segments
            name={p.list}
            testId="text-list"
            value={shared(target.props.map((pr) => (pr.list ?? 'none') as 'none' | 'bullet' | 'number'))}
            options={['none', 'bullet', 'number'] as const}
            labels={p.lists}
            marks={LIST_MARKS}
            onSet={(list) => set(target, () => ({ list: list === 'none' ? undefined : list }))}
          />
        </NotForCurved>
        <Segments
          name={rows.direction}
          testId="text-direction"
          value={value<'auto' | 'ltr' | 'rtl'>('direction', 'auto')}
          options={['auto', 'ltr', 'rtl'] as const}
          labels={bar.textDirections}
          marks={DIRECTION_MARKS}
          onSet={(direction) => set(target, () => ({ direction }))}
        />
      </Pair>
      <Segments
        name={p.textCase}
        testId="text-case"
        value={(style('textCase') ?? 'none') as 'none' | 'upper' | 'lower' | 'title' | 'mixed'}
        options={['none', 'upper', 'lower', 'title'] as const}
        labels={p.textCases}
        marks={CASE_MARKS}
        onSet={(v) => setStyle('textCase', v)}
      />
      <NotForCurved curved={curved}>
        <Segments
          name={p.wrapStyle}
          testId="text-wrap"
          value={value<'auto' | 'balance' | 'pretty'>('wrapStyle', 'auto')}
          options={['auto', 'balance', 'pretty'] as const}
          labels={p.wrapStyleTips}
          marks={p.wrapStyles}
          onSet={(wrapStyle) => set(target, () => ({ wrapStyle }))}
        />
      </NotForCurved>
      {curved && <p className="text-caption font-medium text-muted">{p.notForCurved.paragraph}</p>}
    </div>
  )
}

/** Two groups of choices side by side, sharing the row by how many choices each has: four beside three when `wide`, else halves. */
function Pair({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid gap-1.5 [&>*]:min-w-0', wide ? 'grid-cols-[minmax(0,4fr)_minmax(0,3fr)]' : 'grid-cols-2')}>
      {children}
    </div>
  )
}
