// The AI overview's figures and charts, shaped from what the API gives: every UTC day of the days picked,
// the real cost of each day split by seller or by AI function, the daily check of each seller day by day with
// its red days, the layer split's GPU cost against the fixed amount it took, and the headline figures.
import { AI_FUNCTIONS, type AiCostRow, type DailyCheck, LAYER_SPLIT, SELLERS, type UnknownCalls } from '@dazbee/schema'

/** What the cost chart splits each day's real cost by. */
export type CostSplit = 'seller' | 'function'

/**
 * A series of the cost chart: the seller or AI function it stands for, or `OTHER`; its place in the fixed list of
 * sellers or AI functions, which picks its colour, -1 for Other; and its real cost on each day, in rupees.
 */
export interface CostSeries {
  key: string
  slot: number
  values: number[]
}

/** One seller's daily check, day by day: its currency, our call log's figure and its own, and its red days. */
export interface CheckPanel {
  seller: string
  currency: string
  ours: (number | null)[]
  theirs: (number | null)[]
  red: number[]
}

/** The overview's headline figures: today's calls and the days picked's unknown calls and red days. */
export interface OverviewFigures {
  callsToday: number
  doneToday: number
  unknownCalls: number
  redDays: number
  checkedDays: number
}

/** The key of the series that holds sellers or AI functions not in their fixed list. */
export const OTHER = 'other'

/** A day in milliseconds. */
const DAY = 86_400_000

/** Every UTC day from `from` to `to`, both included, as YYYY-MM-DD. */
export function daysFrom(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  const days: string[] = []
  for (let at = start; at <= end; at += DAY) days.push(new Date(at).toISOString().slice(0, 10))
  return days
}

/**
 * Each day's real cost split by seller or by AI function: a series for each one that cost anything on the days,
 * in the fixed order of sellers or AI functions, and one for those not in it last.
 */
export function costsByDay(costs: AiCostRow[], days: string[], split: CostSplit): CostSeries[] {
  const list: readonly string[] = split === 'seller' ? SELLERS : AI_FUNCTIONS
  const index = dayIndex(days)
  const series = new Map<string, CostSeries>()
  for (const row of costs) {
    const day = index.get(row.day)
    if (day === undefined) continue
    const slot = list.indexOf(row[split])
    const key = slot >= 0 ? row[split] : OTHER
    const each = series.get(key) ?? { key, slot, values: days.map(() => 0) }
    each.values[day] = (each.values[day] ?? 0) + row.realCost
    series.set(key, each)
  }
  return [...series.values()]
    .filter((each) => each.values.some((value) => value > 0))
    .sort((a, b) => (a.slot < 0 ? list.length : a.slot) - (b.slot < 0 ? list.length : b.slot))
}

/** Each checked seller's daily check, day by day, sellers in their fixed order; a day not checked has no figures. */
export function checkPanels(checks: DailyCheck[], days: string[]): CheckPanel[] {
  const index = dayIndex(days)
  const panels = new Map<string, CheckPanel>()
  for (const check of checks) {
    const day = index.get(check.day)
    if (day === undefined) continue
    const panel = panels.get(check.seller) ?? {
      seller: check.seller,
      currency: check.currency,
      ours: days.map(() => null),
      theirs: days.map(() => null),
      red: [],
    }
    panel.ours[day] = check.ourCost
    panel.theirs[day] = check.sellerCost
    if (check.state === 'red') panel.red.push(day)
    panels.set(check.seller, panel)
  }
  const order = (seller: string) => {
    const at = (SELLERS as readonly string[]).indexOf(seller)
    return at < 0 ? SELLERS.length : at
  }
  return [...panels.values()].sort((a, b) => order(a.seller) - order(b.seller) || a.seller.localeCompare(b.seller))
}

/** The layer split's real GPU cost and the fixed amount it charged, each day, in rupees; null with no layer split. */
export function layerSplitByDay(costs: AiCostRow[], days: string[]): { real: number[]; charged: number[] } | null {
  const index = dayIndex(days)
  const rows = costs.filter((row) => row.function === LAYER_SPLIT && index.has(row.day))
  if (rows.length === 0) return null
  const real = days.map(() => 0)
  const charged = days.map(() => 0)
  for (const row of rows) {
    const day = index.get(row.day) ?? 0
    real[day] = (real[day] ?? 0) + row.realCost
    charged[day] = (charged[day] ?? 0) + row.charged
  }
  return { real, charged }
}

/** The headline figures: the tries and done calls of `today`'s costs, and the days picked's unknown calls and red days. */
export function overviewFigures({
  today,
  checks,
  unknownCalls,
}: {
  today: AiCostRow[]
  checks: DailyCheck[]
  unknownCalls: UnknownCalls[]
}): OverviewFigures {
  return {
    callsToday: today.reduce((sum, row) => sum + row.calls, 0),
    doneToday: today.reduce((sum, row) => sum + row.done, 0),
    unknownCalls: unknownCalls.reduce((sum, each) => sum + each.calls, 0),
    redDays: checks.filter((check) => check.state === 'red').length,
    checkedDays: checks.length,
  }
}

/** Each day's place in `days`. */
function dayIndex(days: string[]): Map<string, number> {
  return new Map(days.map((day, i) => [day, i]))
}
