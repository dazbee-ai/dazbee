'use client'

// The AI section's days and costs. The days: the UTC days the costs, the daily check and the unknown calls
// cover, picked from presets or by a form that reloads the page with them. The costs: every try of every AI call
// over those days, added up by AI feature, then AI function, its preset, model and seller, then the same by day,
// with the real cost and what workspaces were charged; and the layer split's real GPU cost beside the fixed amounts
// it took, day by day.
import Link from 'next/link'
import { Fragment } from 'react'

import { type AiCostRow, LAYER_SPLIT } from '@dazbee/schema'

import {
  AiHeading,
  AiTable,
  CELL,
  FIELD,
  HEAD,
  SAVE_BUTTON,
  useAiNames,
  useAmount,
} from '@/components/pilot/ai-form.tsx'
import { Note } from '@/components/settings/note.tsx'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** Costs added up over a group of rows. */
interface Sum {
  calls: number
  done: number
  realCost: number
  charged: number
}

/** The presets of the days shown: the last so many UTC days, today's included. */
const PRESETS = [7, 14, 30, 90]

/** The UTC day `days` days before `day`. */
function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

/** `rows` added up by `keyOf`, in the order each key first comes. */
function sumBy<K extends string>(rows: AiCostRow[], keyOf: (row: AiCostRow) => K): [K, AiCostRow, Sum][] {
  const sums = new Map<K, [K, AiCostRow, Sum]>()
  for (const row of rows) {
    const key = keyOf(row)
    const sum = sums.get(key)?.[2] ?? { calls: 0, done: 0, realCost: 0, charged: 0 }
    sums.set(key, [
      key,
      sums.get(key)?.[1] ?? row,
      {
        calls: sum.calls + row.calls,
        done: sum.done + row.done,
        realCost: sum.realCost + row.realCost,
        charged: sum.charged + row.charged,
      },
    ])
  }
  return [...sums.values()]
}

export function AiRange({
  from,
  to,
  today,
  keep,
  refused = false,
}: {
  from: string
  to: string
  /** Today's UTC day, which each preset ends on. */
  today: string
  keep: Record<string, string>
  /** Whether the address named days that can't be shown, so these are the last 14 in their place. */
  refused?: boolean
}) {
  const w = useMessages().pilotAi.range
  return (
    <form method="get" data-testid="ai-range" className="flex flex-wrap items-end gap-x-4 gap-y-3">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div role="group" aria-label={w.presets} className={cn(SEGMENTS, 'self-end')}>
        {PRESETS.map((days) => {
          const start = daysBefore(today, days - 1)
          return (
            <Link
              key={days}
              href={`?${new URLSearchParams({ ...keep, from: start, to: today })}`}
              aria-current={from === start && to === today ? 'true' : undefined}
              className={cn(SEGMENT, 'flex items-center aria-[current=true]:bg-chip aria-[current=true]:text-text')}
            >
              {format(w.last, { days })}
            </Link>
          )
        })}
      </div>
      <label className="flex flex-col gap-1 text-caption text-muted">
        {w.from}
        <input name="from" type="date" required defaultValue={from} className={cn(FIELD, 'text-text')} />
      </label>
      <label className="flex flex-col gap-1 text-caption text-muted">
        {w.to}
        <input name="to" type="date" required defaultValue={to} className={cn(FIELD, 'text-text')} />
      </label>
      <button type="submit" className={SAVE_BUTTON}>
        {w.show}
      </button>
      <p className="self-center text-caption text-muted">{w.hint}</p>
      {refused && (
        <div className="basis-full">
          <Note refused text={w.refused} />
        </div>
      )}
    </form>
  )
}

export function AiCosts({ costs }: { costs: AiCostRow[] }) {
  const w = useMessages().pilotAi.costs
  const names = useAiNames()
  const amount = useAmount()
  // By AI feature, then AI function, preset and model: each feature's rows follow its own total.
  const byFunction = sumBy(
    costs,
    (row) => `${row.feature}/${row.function}/${row.preset}/${row.model}/${row.seller}`,
  ).sort(([a], [b]) => a.localeCompare(b))
  const features = sumBy(costs, (row) => row.feature)
  const splits = sumBy(
    costs.filter((row) => row.function === LAYER_SPLIT),
    (row) => row.day,
  )
  const all = sumBy(costs, () => 'all')[0]?.[2]
  const head = (
    <>
      <th className={HEAD}>{w.function}</th>
      <th className={HEAD}>{w.preset}</th>
      <th className={HEAD}>{w.model}</th>
      <th className={HEAD}>{w.seller}</th>
      <th className={cn(HEAD, 'text-end')}>{w.calls}</th>
      <th className={cn(HEAD, 'text-end')}>{w.done}</th>
      <th className={cn(HEAD, 'text-end')}>{w.real}</th>
      <th className={cn(HEAD, 'text-end')}>{w.charged}</th>
    </>
  )
  const cells = (row: AiCostRow, sum: Sum) => (
    <>
      <td className={CELL}>{names.fn(row.function)}</td>
      <td className={cn(CELL, 'font-mono text-caption')}>{row.preset}</td>
      <td className={cn(CELL, 'font-mono text-caption')}>{row.model}</td>
      <td className={CELL}>{names.seller(row.seller)}</td>
      <td className={cn(CELL, 'text-end')}>{sum.calls}</td>
      <td className={cn(CELL, 'text-end')}>{sum.done}</td>
      <td className={cn(CELL, 'text-end')}>{amount(sum.realCost, 4)}</td>
      <td className={cn(CELL, 'text-end')}>{amount(sum.charged, 4)}</td>
    </>
  )
  return (
    <div data-testid="ai-costs" className="flex flex-col gap-4">
      <AiHeading id="ai-costs-title" title={w.title} hint={w.hint} />
      {costs.length === 0 ? (
        <p className="text-label text-muted">{w.none}</p>
      ) : (
        <>
          <h3 className="text-caption font-semibold">{w.totals}</h3>
          <AiTable label={w.totals}>
            <thead>
              <tr>{head}</tr>
            </thead>
            <tbody>
              {features
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([feature, , total]) => (
                  <Fragment key={feature}>
                    <tr data-feature={feature} className="border-t border-line font-semibold">
                      <td className={CELL} colSpan={4}>
                        {names.feature(feature)}
                      </td>
                      <td className={cn(CELL, 'text-end')}>{total.calls}</td>
                      <td className={cn(CELL, 'text-end')}>{total.done}</td>
                      <td className={cn(CELL, 'text-end')}>{amount(total.realCost, 4)}</td>
                      <td className={cn(CELL, 'text-end')}>{amount(total.charged, 4)}</td>
                    </tr>
                    {byFunction
                      .filter(([, row]) => row.feature === feature)
                      .map(([key, row, sum]) => (
                        <tr key={key} data-cost={key}>
                          {cells(row, sum)}
                        </tr>
                      ))}
                  </Fragment>
                ))}
              {all && (
                <tr className="border-t border-line font-semibold">
                  <td className={CELL} colSpan={4}>
                    {w.all}
                  </td>
                  <td className={cn(CELL, 'text-end')}>{all.calls}</td>
                  <td className={cn(CELL, 'text-end')}>{all.done}</td>
                  <td className={cn(CELL, 'text-end')}>{amount(all.realCost, 4)}</td>
                  <td className={cn(CELL, 'text-end')}>{amount(all.charged, 4)}</td>
                </tr>
              )}
            </tbody>
          </AiTable>
          <h3 className="text-caption font-semibold">{w.layerSplit}</h3>
          <AiTable label={w.layerSplit}>
            <thead>
              <tr>
                <th className={HEAD}>{w.day}</th>
                <th className={cn(HEAD, 'text-end')}>{w.done}</th>
                <th className={cn(HEAD, 'text-end')}>{w.gpu}</th>
                <th className={cn(HEAD, 'text-end')}>{w.fixed}</th>
              </tr>
            </thead>
            <tbody>
              {splits.length === 0 && (
                <tr>
                  <td colSpan={4} className={cn(CELL, 'text-muted')}>
                    {w.none}
                  </td>
                </tr>
              )}
              {splits.map(([day, , sum]) => (
                <tr key={day} data-split-day={day}>
                  <td className={CELL}>{day}</td>
                  <td className={cn(CELL, 'text-end')}>{sum.done}</td>
                  <td className={cn(CELL, 'text-end')}>{amount(sum.realCost, 4)}</td>
                  <td className={cn(CELL, 'text-end')}>{amount(sum.charged, 4)}</td>
                </tr>
              ))}
            </tbody>
          </AiTable>
          <h3 className="text-caption font-semibold">{w.byDay}</h3>
          <AiTable label={w.byDay}>
            <thead>
              <tr>
                <th className={HEAD}>{w.day}</th>
                {head}
              </tr>
            </thead>
            <tbody>
              {costs.map((row) => (
                <tr key={`${row.day}/${row.feature}/${row.function}/${row.preset}/${row.model}/${row.seller}`}>
                  <td className={CELL}>{row.day}</td>
                  {cells(row, row)}
                </tr>
              ))}
            </tbody>
          </AiTable>
        </>
      )}
    </div>
  )
}
