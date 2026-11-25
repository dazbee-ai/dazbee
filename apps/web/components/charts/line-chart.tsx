'use client'

// A line chart: a 2 px line for each series along the x axis, broken where a series has no value, with a dot
// where a value stands alone. Flagged points are shaded red with the warning mark above them, named in the
// legend. A crosshair finds the point under the pointer, or moved to with the arrow keys, and its tooltip
// gives every series' value there.
import { useState } from 'react'

import { Axes } from './axes.tsx'
import { type KeyItem, Legend, Tip, type TipRow } from './chart-key.tsx'
import { AXIS_BAND, type Frame, frameOf, pointAfterKey, pointAt, TOP } from './plot.ts'
import { type ChartPoint, type ChartSeries, CRITICAL_COLOUR } from './series.ts'
import { useWidth } from './use-width.ts'

/** The radius of a dot: a value standing alone, or the series' value under the crosshair. */
const DOT = 4

/** The line's path through `values`, a new stroke after each gap, and the values with no neighbour on either side. */
function linesOf(values: (number | null)[], frame: Frame): { path: string; alone: number[] } {
  const has = (i: number) => values[i] !== null && values[i] !== undefined
  let path = ''
  const alone: number[] = []
  values.forEach((value, i) => {
    if (value === null) return
    const before = has(i - 1)
    path += `${before ? 'L' : 'M'}${frame.x(i)},${frame.y(value)}`
    if (!before && !has(i + 1)) alone.push(i)
  })
  return { path, alone }
}

export function LineChart({
  label,
  points,
  series,
  format,
  flags,
  height = 160,
}: {
  /** The chart's accessible name. */
  label: string
  points: ChartPoint[]
  series: ChartSeries[]
  format: (value: number) => string
  /** The points marked as wrong, and what the mark means. */
  flags?: { points: number[]; label: string }
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(0, ...series.flatMap((each) => each.values.map((value) => value ?? 0)))
  const frame = frameOf({ width, height, count: points.length, max, format })
  const flagged = new Set(flags?.points ?? [])
  const keys: KeyItem[] = series.map((each) => ({
    key: each.key,
    label: each.label,
    colour: each.colour,
    shape: 'line',
  }))
  if (flags && flagged.size > 0) keys.push({ key: 'flag', label: flags.label, colour: CRITICAL_COLOUR, shape: 'flag' })
  const shown = active === null ? null : points[active]
  const rows = (index: number): TipRow[] => [
    ...(flags && flagged.has(index)
      ? [{ key: 'flag', label: '', value: flags.label, colour: CRITICAL_COLOUR, shape: 'flag' as const, strong: true }]
      : []),
    ...series.flatMap((each) => {
      const value = each.values[index]
      return value === null || value === undefined
        ? []
        : [{ key: each.key, label: each.label, value: format(value), colour: each.colour }]
    }),
  ]
  return (
    <div className="flex flex-col gap-3">
      <Legend items={keys} />
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
          {[...flagged].map((i) => (
            <g key={i} data-flag={points[i]?.key}>
              <rect
                x={frame.x(i) - frame.slot / 2}
                y={TOP}
                width={frame.slot}
                height={height}
                fill={CRITICAL_COLOUR}
                opacity={0.14}
              />
              <circle
                cx={frame.x(i)}
                cy={TOP + DOT}
                r={DOT}
                fill={CRITICAL_COLOUR}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </g>
          ))}
          <Axes frame={frame} points={points} width={width} format={format} />
          {series.map((each) => {
            const { path, alone } = linesOf(each.values, frame)
            return (
              <g key={each.key} data-line={each.key}>
                <path
                  d={path}
                  fill="none"
                  stroke={each.colour}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {alone.map((i) => (
                  <circle key={i} cx={frame.x(i)} cy={frame.y(each.values[i] ?? 0)} r={DOT} fill={each.colour} />
                ))}
              </g>
            )
          })}
          {active !== null && (
            <g>
              <line
                x1={frame.x(active)}
                x2={frame.x(active)}
                y1={TOP}
                y2={TOP + height}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              {series.map((each) => {
                const value = each.values[active]
                return value === null || value === undefined ? null : (
                  <circle
                    key={each.key}
                    cx={frame.x(active)}
                    cy={frame.y(value)}
                    r={DOT}
                    fill={each.colour}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )
              })}
            </g>
          )}
        </svg>
        {active !== null && shown && <Tip title={shown.long} x={frame.x(active)} width={width} rows={rows(active)} />}
      </div>
    </div>
  )
}
