'use client'

// A stacked column chart: a column for each point along the x axis, split into a segment per series in the
// series' order from the baseline up, 2 px of surface between segments and a rounded top. The point under the
// pointer, or moved to with the arrow keys, lifts and its tooltip gives every series' value and the total.
import { useState } from 'react'

import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { Axes } from './axes.tsx'
import { Legend, Tip } from './chart-key.tsx'
import { AXIS_BAND, frameOf, pointAfterKey, pointAt, TOP } from './plot.ts'
import type { ChartPoint, ChartSeries } from './series.ts'
import { useWidth } from './use-width.ts'

/** The surface left between two segments of a column. */
const GAP = 2

/** The widest a column is drawn, whatever room it has. */
const MOST_COLUMN = 24

/** The rounding of a column's top. */
const RADIUS = 4

/** A column's top segment: a block rounded at its top corners only, square on what it stands on. */
function roundedTop(x: number, top: number, width: number, height: number): string {
  const r = Math.min(RADIUS, width / 2, height)
  const bottom = top + height
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${bottom}Z`
}

export function StackedColumns({
  label,
  points,
  series,
  format,
  height = 200,
}: {
  /** The chart's accessible name. */
  label: string
  points: ChartPoint[]
  series: ChartSeries[]
  format: (value: number) => string
  height?: number
}) {
  const total = useMessages().charts.total
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const totals = points.map((_, i) => series.reduce((sum, each) => sum + (each.values[i] ?? 0), 0))
  const frame = frameOf({ width, height, count: points.length, max: Math.max(0, ...totals), format })
  const column = Math.max(2, Math.min(MOST_COLUMN, frame.slot * 0.64))
  const shown = active === null ? null : points[active]
  return (
    <div className="flex flex-col gap-3">
      <Legend
        items={series.map((each) => ({ key: each.key, label: each.label, colour: each.colour, shape: 'column' }))}
      />
      <div
        ref={ref}
        dir="ltr"
        role="group"
        aria-label={label}
        tabIndex={0}
        className="relative rounded-row outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onKeyDown={(event) => {
          const next = pointAfterKey(event, active, points.length)
          if (next === undefined) return
          event.preventDefault()
          setActive(next)
        }}
        onBlur={() => setActive(null)}
      >
        <svg
          aria-hidden
          width={width}
          height={TOP + height + AXIS_BAND}
          className="block touch-pan-y"
          onPointerMove={(event) => setActive(pointAt(event, frame, points.length))}
          onPointerLeave={() => setActive(null)}
        >
          {active !== null && (
            <rect
              x={frame.x(active) - frame.slot / 2}
              y={TOP}
              width={frame.slot}
              height={height}
              fill="var(--hover)"
              rx={RADIUS}
            />
          )}
          <Axes frame={frame} points={points} width={width} format={format} />
          {points.map((point, i) => {
            const x = frame.x(i) - column / 2
            const stacked = series.filter((each) => (each.values[i] ?? 0) > 0)
            let base = 0
            return (
              <g
                key={point.key}
                data-column={point.key}
                className={cn('transition-opacity', active !== null && active !== i && 'opacity-45')}
              >
                {stacked.map((each, j) => {
                  const value = each.values[i] ?? 0
                  const top = frame.y(base + value)
                  const full = frame.y(base) - top
                  const drawn = Math.max(0.5, full - (base > 0 ? GAP : 0))
                  base += value
                  return j === stacked.length - 1 ? (
                    <path key={each.key} d={roundedTop(x, top, column, drawn)} fill={each.colour} />
                  ) : (
                    <rect key={each.key} x={x} y={top} width={column} height={drawn} fill={each.colour} />
                  )
                })}
              </g>
            )
          })}
        </svg>
        {active !== null && shown && (
          <Tip
            title={shown.long}
            x={frame.x(active)}
            width={width}
            rows={[
              { key: 'total', label: total, value: format(totals[active] ?? 0), strong: true },
              ...series
                .slice()
                .reverse()
                .map((each) => ({
                  key: each.key,
                  label: each.label,
                  value: format(each.values[active] ?? 0),
                  colour: each.colour,
                  shape: 'column' as const,
                })),
            ]}
          />
        )}
      </div>
    </div>
  )
}
