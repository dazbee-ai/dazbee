'use client'

// A chart's numbers as a table, folded away under the chart: a row for each point, a column for each series,
// and a total column for a stacked chart, so every value can be read without the tooltip.
import { useMessages } from '@/lib/i18n/client.tsx'

import type { ChartPoint, ChartSeries } from './series.ts'

export function DataTable({
  label,
  pointLabel,
  points,
  series,
  format,
  total = false,
}: {
  /** The table's accessible name: the chart's title. */
  label: string
  /** The heading of the column that names each point, such as Day. */
  pointLabel: string
  points: ChartPoint[]
  series: ChartSeries[]
  format: (value: number) => string
  /** Whether to add each point's total, as a stacked chart shows it. */
  total?: boolean
}) {
  const w = useMessages().charts
  const head = 'px-2 py-1.5 text-start font-medium whitespace-nowrap text-muted'
  const cell = 'px-2 py-1 whitespace-nowrap'
  return (
    <details className="group text-caption">
      <summary className="cursor-pointer self-start text-muted select-none hover:text-text">{w.table}</summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-row border border-line">
        <table aria-label={label} className="w-full border-collapse tabular-nums">
          <thead className="sticky top-0 bg-raised">
            <tr className="border-b border-line">
              <th className={head}>{pointLabel}</th>
              {series.map((each) => (
                <th key={each.key} className={`${head} text-end`}>
                  {each.label}
                </th>
              ))}
              {total && <th className={`${head} text-end`}>{w.total}</th>}
            </tr>
          </thead>
          <tbody>
            {points.map((point, i) => (
              <tr key={point.key} data-point={point.key} className="border-b border-line last:border-b-0">
                <td className={cell}>{point.long}</td>
                {series.map((each) => {
                  const value = each.values[i]
                  return (
                    <td key={each.key} className={`${cell} text-end`}>
                      {value === null || value === undefined ? '' : format(value)}
                    </td>
                  )
                })}
                {total && (
                  <td className={`${cell} text-end font-semibold`}>
                    {format(series.reduce((sum, each) => sum + (each.values[i] ?? 0), 0))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
