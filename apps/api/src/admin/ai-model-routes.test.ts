// What a text step's calls measured, against Postgres from Docker Compose: each case's calls are under a step
// and a model of its own.
import { afterAll, describe, expect, it } from 'vitest'

import { CUT_OFF, STEPS } from '@dazbee/ai'
import { aiCalls, newId } from '@dazbee/db'

import { db, run } from '../test-api.ts'
import { measuredSizes } from './ai-model-routes.ts'

const step = `test-measured-${run}`
const model = `test-model-${run}`

afterAll(() => {
  Reflect.deleteProperty(STEPS, step)
})

/** A call of the case's step and model, `daysAgo` days ago, with `usage`, done unless `state` says otherwise. */
function callOf(usage: Record<string, number>, { state = 'done', error = null as string | null, daysAgo = 1 } = {}) {
  return {
    id: newId(),
    jobId: newId(),
    workspaceId: 'ws',
    callIndex: 0,
    try: 1,
    attempt: 1,
    step,
    model,
    seller: 'openai',
    state: state as 'done' | 'failed',
    error,
    usage,
    startedAt: new Date(Date.now() - daysAgo * 86_400_000),
  }
}

describe('measuredSizes', () => {
  it('measures a text step’s done and cut-off calls of the last 30 days, cached input counted', async () => {
    STEPS[step] = { kind: 'text', expected: () => ({}), sizes: { input: 100, output: 50, ceiling: 200 } }
    await db.insert(aiCalls).values([
      callOf({ 'input-token': 80, 'cached-input-token': 20, 'output-token': 40 }),
      callOf({ 'input-token': 300, 'output-token': 200 }, { state: 'failed', error: CUT_OFF }),
      // Neither a call that failed another way nor one older than 30 days counts.
      callOf({ 'input-token': 9000, 'output-token': 9000 }, { state: 'failed', error: 'test failure 400' }),
      callOf({ 'input-token': 9000, 'output-token': 9000 }, { daysAgo: 31 }),
    ])
    expect((await measuredSizes(db)).get(`${step}/${model}`)).toEqual({
      calls: 2,
      cutOff: 1,
      input: { average: 200, p95: 290 },
      output: { average: 120, p95: 192 },
    })
  })
})
