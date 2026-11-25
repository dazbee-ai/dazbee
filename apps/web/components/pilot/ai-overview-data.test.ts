import { describe, expect, it } from 'vitest'

import type { AiCostRow, DailyCheck } from '@dazbee/schema'

import { checkPanels, costsByDay, daysFrom, layerSplitByDay, OTHER, overviewFigures } from './ai-overview-data.ts'

/** A cost row of `seller` and `step` on `day`. */
const cost = (day: string, step: string, seller: string, realCost: number, more: Partial<AiCostRow> = {}) =>
  ({ day, step, model: 'm', seller, calls: 1, done: 1, realCost, charged: 0, ...more }) satisfies AiCostRow

/** A daily check of `seller` on `day`. */
const check = (seller: string, day: string, state: DailyCheck['state'], ourCost: number, sellerCost: number | null) =>
  ({
    seller,
    day,
    currency: seller === 'openai' ? 'USD' : 'INR',
    ourCost,
    sellerCost,
    outsideCalls: null,
    state,
    source: null,
    checkedAt: '2026-11-20T00:00:00.000Z',
  }) satisfies DailyCheck

const DAYS = ['2026-11-19', '2026-11-20', '2026-11-21']

describe('daysFrom', () => {
  it('gives every UTC day from the first to the last, across a month’s end', () => {
    expect(daysFrom('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
    expect(daysFrom('2026-11-20', '2026-11-20')).toEqual(['2026-11-20'])
  })
})

describe('costsByDay', () => {
  const costs = [
    cost('2026-11-21', 'flow.refine', 'pixazo', 2),
    cost('2026-11-19', 'flow.read', 'openai', 0.5),
    cost('2026-11-19', 'flow.refine', 'openai', 1.25),
    cost('2026-11-20', 'test-step', 'test-seller', 4),
    cost('2026-10-01', 'flow.read', 'meta', 9),
    cost('2026-11-21', 'flow.resize', 'zenmux', 0, { done: 0 }),
  ]

  it('adds up each day’s real cost by seller, in the sellers’ fixed order, with those not in it as Other and none that cost nothing', () => {
    expect(costsByDay(costs, DAYS, 'seller')).toEqual([
      { key: 'openai', slot: 0, values: [1.75, 0, 0] },
      { key: 'pixazo', slot: 4, values: [0, 0, 2] },
      { key: OTHER, slot: -1, values: [0, 4, 0] },
    ])
  })

  it('adds up each day’s real cost by AI step, keeping each step’s place whatever else is shown', () => {
    expect(costsByDay(costs, DAYS, 'step')).toEqual([
      { key: 'flow.read', slot: 1, values: [0.5, 0, 0] },
      { key: 'flow.refine', slot: 4, values: [1.25, 0, 2] },
      { key: OTHER, slot: -1, values: [0, 4, 0] },
    ])
  })
})

describe('checkPanels', () => {
  it('gives each seller its figures day by day, in the sellers’ order, with its red days', () => {
    const panels = checkPanels(
      [
        check('meta', '2026-11-20', 'red', 0.93, 5),
        check('openai', '2026-11-19', 'ok', 1, 1.01),
        check('meta', '2026-11-21', 'waiting', 2, null),
        check('openai', '2026-11-20', 'ok', 2, 2),
      ],
      DAYS,
    )
    expect(panels).toEqual([
      { seller: 'openai', currency: 'USD', ours: [1, 2, null], theirs: [1.01, 2, null], red: [] },
      { seller: 'meta', currency: 'INR', ours: [null, 0.93, 2], theirs: [null, 5, null], red: [1] },
    ])
  })
})

describe('layerSplitByDay', () => {
  it('gives the GPU’s real cost against the fixed amount charged each day', () => {
    const split = layerSplitByDay(
      [
        cost('2026-11-20', 'flow.layer-split', 'modal', 1.2, { charged: 1.83 }),
        cost('2026-11-20', 'flow.layer-split', 'modal', 0.4, { charged: 1.83 }),
        cost('2026-11-21', 'flow.refine', 'pixazo', 2),
      ],
      DAYS,
    )
    expect(split?.real.map((v) => Number(v.toFixed(6)))).toEqual([0, 1.6, 0])
    expect(split?.charged).toEqual([0, 3.66, 0])
  })

  it('gives nothing when the layer split made no call on the days', () => {
    expect(layerSplitByDay([cost('2026-11-21', 'flow.refine', 'pixazo', 2)], DAYS)).toBeNull()
  })
})

describe('overviewFigures', () => {
  it('counts today’s tries and done calls, and the days’ unknown calls and red days', () => {
    expect(
      overviewFigures({
        today: [
          cost('2026-11-21', 'flow.refine', 'pixazo', 2, { calls: 3, done: 2 }),
          cost('2026-11-21', 'flow.read', 'openai', 1),
        ],
        checks: [check('meta', '2026-11-20', 'red', 0.93, 5), check('openai', '2026-11-20', 'ok', 2, 2)],
        unknownCalls: [
          { seller: 'pixazo', day: '2026-11-19', calls: 2 },
          { seller: 'meta', day: '2026-11-20', calls: 1 },
        ],
      }),
    ).toEqual({ callsToday: 4, doneToday: 3, unknownCalls: 3, redDays: 1, checkedDays: 2 })
  })
})
