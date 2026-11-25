'use client'

// What names a chart's marks: its legend, a swatch shaped as each mark is drawn, and the tooltip that gives
// every series' value at the point under the pointer or the keyboard, the value first and its name after.
import { WarningCircleIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'

import { CRITICAL_COLOUR } from './series.ts'

/** A legend entry: its name, its colour, and the mark it stands for: a column, a line or a flagged point. */
export interface KeyItem {
  key: string
  label: string
  colour: string
  shape: 'column' | 'line' | 'flag'
}

/** A row of the tooltip: the value, then what it is. */
export interface TipRow {
  key: string
  label: string
  value: string
  colour?: string
  shape?: KeyItem['shape']
  strong?: boolean
}

/** The legend, in the series' order. */
export function Legend({ items }: { items: KeyItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
      {items.map((item) => (
        <li key={item.key} data-series={item.key} className="flex items-center gap-1.5">
          <Swatch colour={item.colour} shape={item.shape} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * The tooltip over a chart `width` px wide, its middle at `x` and kept inside the chart: its title, then a
 * row for each series. Spoken as it changes, so a person moving along the chart by keyboard hears it.
 */
export function Tip({ title, rows, x, width }: { title: string; rows: TipRow[]; x: number; width: number }) {
  const side = x > width / 2 ? { right: Math.max(0, width - x + 12) } : { left: Math.max(0, x + 12) }
  return (
    <div
      role="status"
      aria-live="polite"
      style={side}
      className="pointer-events-none absolute top-0 z-10 flex min-w-40 flex-col gap-1 rounded-row border border-line bg-raised px-3 py-2 text-caption shadow-panel"
    >
      <span className="font-semibold text-text">{title}</span>
      {rows.map((row) => (
        <span key={row.key} className="flex items-center gap-2 whitespace-nowrap">
          {row.colour && <Swatch colour={row.colour} shape={row.shape ?? 'line'} />}
          <span className={cn('tabular-nums text-text', row.strong ? 'font-semibold' : 'font-medium')}>
            {row.value}
          </span>
          <span className="text-muted">{row.label}</span>
        </span>
      ))}
    </div>
  )
}

/** A swatch drawn as its mark is: a block for a column, a short stroke for a line, the warning icon for a flag. */
function Swatch({ colour, shape }: { colour: string; shape: KeyItem['shape'] }) {
  if (shape === 'flag') {
    return (
      <WarningCircleIcon size={14} weight="bold" aria-hidden className="shrink-0" style={{ color: CRITICAL_COLOUR }} />
    )
  }
  return (
    <span
      aria-hidden
      style={{ background: colour }}
      className={cn('shrink-0', shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-[3px]')}
    />
  )
}
