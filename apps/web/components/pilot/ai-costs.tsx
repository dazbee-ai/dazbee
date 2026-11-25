'use client'

// The AI section's days and costs. The days: the UTC days the costs, the daily check and the unknown calls
// cover, picked by a form that reloads the page with them. The costs: every try of every AI call over those
// days, added up by AI step, model and seller, then the same by day, with the real cost and what workspaces
// were charged; and the layer split's real GPU cost beside the fixed amounts it took, day by day.
import type { AiCostRow } from '@dazbee/schema'

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
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** Costs added up over a group of rows. */
interface Sum {
  calls: number
  done: number
  realCost: number
  charged: number
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

export function AiRange({ from, to, keep }: { from: string; to: string; keep: Record<string, string> }) {
  const w = useMessages().pilotAi.range
  return (
    <form method="get" data-testid="ai-range" className="flex flex-wrap items-end gap-3">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
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
      <p className="basis-full text-caption text-muted">{w.hint}</p>
    </form>
  )
}

export function AiCosts({ costs }: { costs: AiCostRow[] }) {
  const w = useMessages().pilotAi.costs
  const names = useAiNames()
  const amount = useAmount()
  const totals = sumBy(costs, (row) => `${row.step}/${row.model}/${row.seller}`)
  const splits = sumBy(
    costs.filter((row) => row.step === 'layer-split'),
    (row) => row.day,
  )
  const all = sumBy(costs, () => 'all')[0]?.[2]
  const head = (
    <>
      <th className={HEAD}>{w.step}</th>
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
      <td className={CELL}>{names.step(row.step)}</td>
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
              {totals.map(([key, row, sum]) => (
                <tr key={key} data-cost={key}>
                  {cells(row, sum)}
                </tr>
              ))}
              {all && (
                <tr className="border-t border-line font-semibold">
                  <td className={CELL} colSpan={3}>
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
                <tr key={`${row.day}/${row.step}/${row.model}/${row.seller}`}>
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
