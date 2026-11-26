'use client'

// The AI overview: today's real AI cost against the spending stop, today's AI calls, and the days picked's
// unknown calls, red days and sellers out of money as stat tiles; then the real cost of each day stacked by
// seller or by AI step, the layer split's GPU cost against the fixed amount it took, and each seller's daily
// check, ours against the seller's figure with its red days marked. Each chart's numbers fold out as a table.
import { type ReactNode, useState } from 'react'

import type { AiCostRow, AiSettingsView, DailyCheck, OutOfMoney, UnknownCalls } from '@dazbee/schema'

import { DataTable } from '@/components/charts/data-table.tsx'
import { LineChart } from '@/components/charts/line-chart.tsx'
import { type ChartPoint, seriesColour } from '@/components/charts/series.ts'
import { StackedColumns } from '@/components/charts/stacked-columns.tsx'
import { StatTile } from '@/components/charts/stat-tile.tsx'
import { CARD } from '@/components/pilot/admin-shell.tsx'
import { useAiNames, useAmount } from '@/components/pilot/ai-form.tsx'
import {
  checkPanels,
  costsByDay,
  type CostSplit,
  daysFrom,
  layerSplitByDay,
  OTHER,
  overviewFigures,
} from '@/components/pilot/ai-overview-data.ts'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** What the cost chart may split by, in the order its choice shows them. */
const SPLITS: CostSplit[] = ['seller', 'function']

/** Names each UTC day short under an axis and in full in a tooltip and table, in the person's locale. */
function usePoints(days: string[]): ChartPoint[] {
  const locale = useLocale()
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return days.map((day) => {
    const at = new Date(`${day}T00:00:00Z`)
    return { key: day, short: short.format(at), long: long.format(at) }
  })
}

export function AiOverview({
  settings,
  costs,
  today,
  checks,
  unknownCalls,
  outOfMoney,
  from,
  to,
}: {
  settings: AiSettingsView
  costs: AiCostRow[]
  /** Today's costs, UTC day, whatever days are picked. */
  today: AiCostRow[]
  checks: DailyCheck[]
  unknownCalls: UnknownCalls[]
  outOfMoney: OutOfMoney[]
  from: string
  to: string
}) {
  const w = useMessages().pilotAdmin
  const names = useAiNames()
  const amount = useAmount()
  const days = daysFrom(from, to)
  const points = usePoints(days)
  const figures = overviewFigures({ today, checks, unknownCalls })
  const money = (value: number, digits = 2) => format(w.money, { amount: amount(value, digits) })
  const share =
    settings.spendingStop > 0 ? settings.spentToday / settings.spendingStop : settings.spentToday > 0 ? 1 : 0
  return (
    <div data-testid="ai-overview" className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="col-span-2 md:col-span-1">
          <StatTile
            testId="tile-spent"
            label={w.tiles.spent}
            value={money(settings.spentToday)}
            meter={share}
            warn={settings.stopped}
            detail={
              settings.stopped ? w.tiles.stopped : format(w.tiles.spentOf, { stop: amount(settings.spendingStop) })
            }
          />
        </div>
        <StatTile
          testId="tile-calls"
          label={w.tiles.calls}
          value={amount(figures.callsToday, 0)}
          detail={format(w.tiles.done, { done: amount(figures.doneToday, 0) })}
        />
        <StatTile
          testId="tile-unknown"
          label={w.tiles.unknown}
          value={amount(figures.unknownCalls, 0)}
          warn={figures.unknownCalls > 0}
          detail={figures.unknownCalls > 0 ? w.tiles.unknownSome : w.tiles.unknownNone}
        />
        <StatTile
          testId="tile-red"
          label={w.tiles.red}
          value={amount(figures.redDays, 0)}
          warn={figures.redDays > 0}
          detail={format(w.tiles.redOf, { checked: amount(figures.checkedDays, 0) })}
        />
        <StatTile
          testId="tile-out-of-money"
          label={w.tiles.outOfMoney}
          value={amount(outOfMoney.length, 0)}
          warn={outOfMoney.length > 0}
          detail={
            outOfMoney.length > 0
              ? outOfMoney.map((each) => names.seller(each.seller)).join(', ')
              : w.tiles.outOfMoneyNone
          }
        />
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <CostCard costs={costs} days={days} points={points} />
        <LayerSplitCard costs={costs} days={days} points={points} />
      </div>
      <ChecksCard checks={checks} days={days} points={points} />
    </div>
  )
}

/** The real cost of each day, stacked by seller or by AI step as the person picks. */
function CostCard({ costs, days, points }: { costs: AiCostRow[]; days: string[]; points: ChartPoint[] }) {
  const w = useMessages().pilotAdmin
  const names = useAiNames()
  const amount = useAmount()
  const [split, setSplit] = useState<CostSplit>('seller')
  const series = costsByDay(costs, days, split).map((each) => ({
    key: each.key,
    label: each.key === OTHER ? w.costs.other : split === 'seller' ? names.seller(each.key) : names.fn(each.key),
    colour: seriesColour(each.slot),
    values: each.values,
  }))
  const money = (value: number) => amount(value, 4)
  return (
    <Card
      id="ai-cost-chart-title"
      title={w.costs.title}
      testId="ai-cost-chart"
      className="xl:col-span-2"
      controls={
        <div role="group" aria-label={w.costs.split} className={SEGMENTS}>
          {SPLITS.map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={split === each}
              data-split={each}
              onClick={() => setSplit(each)}
              className={SEGMENT}
            >
              {each === 'seller' ? w.costs.bySeller : w.costs.byFunction}
            </button>
          ))}
        </div>
      }
    >
      {series.length === 0 ? (
        <Empty text={w.costs.none} />
      ) : (
        <>
          <StackedColumns label={w.costs.title} points={points} series={series} format={money} />
          <DataTable label={w.costs.title} pointLabel={w.day} points={points} series={series} format={money} total />
        </>
      )}
    </Card>
  )
}

/** The layer split's real GPU cost each day against the fixed amount it charged. */
function LayerSplitCard({ costs, days, points }: { costs: AiCostRow[]; days: string[]; points: ChartPoint[] }) {
  const w = useMessages().pilotAdmin
  const amount = useAmount()
  const split = layerSplitByDay(costs, days)
  const money = (value: number) => amount(value, 4)
  const series = split
    ? [
        { key: 'gpu', label: w.split.gpu, colour: seriesColour(0), values: split.real },
        { key: 'fixed', label: w.split.fixed, colour: seriesColour(1), values: split.charged },
      ]
    : []
  return (
    <Card id="ai-split-chart-title" title={w.split.title} testId="ai-split-chart">
      {series.length === 0 ? (
        <Empty text={w.split.none} />
      ) : (
        <>
          <LineChart label={w.split.title} points={points} series={series} format={money} height={200} />
          <DataTable label={w.split.title} pointLabel={w.day} points={points} series={series} format={money} />
        </>
      )}
    </Card>
  )
}

/** Each seller's daily check day by day, in its own currency: our call log against its figure, red days marked. */
function ChecksCard({ checks, days, points }: { checks: DailyCheck[]; days: string[]; points: ChartPoint[] }) {
  const w = useMessages().pilotAdmin
  const names = useAiNames()
  const amount = useAmount()
  const panels = checkPanels(checks, days)
  const figure = (value: number) => amount(value, 4)
  return (
    <Card id="ai-check-chart-title" title={w.checks.title} testId="ai-check-chart">
      {panels.length === 0 ? (
        <Empty text={w.checks.none} />
      ) : (
        <div className="grid min-w-0 gap-x-6 gap-y-6 md:grid-cols-2 2xl:grid-cols-3">
          {panels.map((panel) => {
            const title = format(w.checks.panel, { seller: names.seller(panel.seller), currency: panel.currency })
            const series = [
              { key: 'ours', label: w.checks.ours, colour: seriesColour(0), values: panel.ours },
              { key: 'theirs', label: w.checks.theirs, colour: seriesColour(1), values: panel.theirs },
            ]
            return (
              <section
                key={panel.seller}
                data-panel={panel.seller}
                data-red={panel.red.map((i) => days[i]).join(' ') || undefined}
                aria-label={title}
                className="flex min-w-0 flex-col gap-2"
              >
                <h3 className="text-small font-semibold">{title}</h3>
                <LineChart
                  label={title}
                  points={points}
                  series={series}
                  format={figure}
                  flags={{ points: panel.red, label: w.checks.red }}
                  height={130}
                />
                <DataTable label={title} pointLabel={w.day} points={points} series={series} format={figure} />
              </section>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/** A card of the overview: its title, the controls that change what it shows, and what it shows. */
function Card({
  id,
  title,
  testId,
  className,
  controls,
  children,
}: {
  id: string
  title: string
  testId: string
  className?: string
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} data-testid={testId} className={cn(CARD, className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-body font-semibold">
          {title}
        </h2>
        {controls}
      </div>
      {children}
    </section>
  )
}

/** What a card says when it has nothing to show. */
function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-label text-muted">{text}</p>
}
