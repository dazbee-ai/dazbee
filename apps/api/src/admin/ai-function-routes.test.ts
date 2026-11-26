// The admin's AI function routes, against Postgres from Docker Compose: for anyone but an admin they don't exist;
// for an admin they list the AI functions with their presets, what each preset measured and the preset each mode
// uses, add a pick, and give an AI function's picks. A pick and a real preset's calls change what every job
// holds and runs, so each case that writes one asks the routes on a transaction it rolls back, and no other test
// ever reads them.
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import { CUT_OFF, holdOf, presetNumbers, presetOf, presetsFor } from '@dazbee/ai'
import { aiCalls, aiPicks, type Db, newId, type Tx } from '@dazbee/db'
import { AI_FUNCTIONS, AiFunctionView, AiPickView, type CallState, toMillionths } from '@dazbee/schema'

import type { Env } from '../http.ts'
import { tokenSession } from '../sign-in/session.ts'
import { addPerson, db, sessionSecret, workspace } from '../test-api.ts'
import { aiAdminRoutes } from './ai-routes.ts'
import { addAdmin, admins, ask, tokenOf } from './test-early-access.ts'

/** Thrown to roll a case's transaction back. */
class RolledBack extends Error {}

/** A call of the round plan's full preset to log: how it ended, with its real cost in millionths and its seconds. */
interface Logged {
  state: CallState
  cost?: bigint
  seconds?: number
  error?: string
  seller?: string
  requestId?: string
}

/** What a save made from an older copy is answered. */
const STALE = { status: 409, json: { error: 'This changed since you opened it; reload to see the newest.' } }

let ada: Awaited<ReturnType<typeof addAdmin>>
let bo: Awaited<ReturnType<typeof addAdmin>>

beforeAll(async () => {
  ada = await addAdmin()
  bo = await addAdmin()
})

/** Runs `use` with the admin's AI routes on a transaction that is rolled back; what it gave. */
async function rolledBack<T>(use: (routes: Hono<Env>, tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined
  await db
    .transaction(async (tx) => {
      const routes = aiAdminRoutes({ db: tx as unknown as Db, sessionOf: tokenSession(sessionSecret), admins })
      result = await use(routes, tx)
      throw new RolledBack()
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error
    })
  return result as T
}

/** The AI functions as the admin reads them from `routes`. */
async function functionsOf(routes: Hono<Env>): Promise<AiFunctionView[]> {
  const read = await ask(ada.token, 'GET', '/admin/ai/functions', undefined, routes)
  expect(read.status).toBe(200)
  return AiFunctionView.array().parse(read.json)
}

/** The round plan as the admin reads it, and the preset it uses in `mode`. */
async function roundPlanOf(routes: Hono<Env>, mode = 'precise') {
  const roundPlan = (await functionsOf(routes)).find((each) => each.function === 'round-plan')
  const use = roundPlan?.modes.find((each) => each.mode === mode)
  if (!roundPlan || !use) throw new Error('no round plan')
  return { roundPlan, use }
}

/** Asks `routes` to add a pick as the admin whose token is given. */
const pick = (routes: Hono<Env>, token: string, input: Record<string, unknown>) =>
  ask(token, 'POST', '/admin/ai/picks', input, routes)

/** The round plan's picks as its history gives them. */
async function historyOf(routes: Hono<Env>): Promise<AiPickView[]> {
  const read = await ask(ada.token, 'GET', '/admin/ai/functions/round-plan/picks', undefined, routes)
  expect(read.status).toBe(200)
  return AiPickView.array().parse(read.json)
}

/** Logs calls of the round plan's full preset in `tx`, three days ago, a minute apart. */
async function logCalls(tx: Tx, calls: Logged[]): Promise<void> {
  const first = Date.now() - 3 * 86_400_000
  await tx.insert(aiCalls).values(
    calls.map(({ state, cost = 0n, seconds = 1, error, seller = 'openai', requestId }, index) => {
      const startedAt = new Date(first + index * 60_000)
      return {
        id: newId(),
        jobId: `job-${newId()}`,
        workspaceId: 'ws',
        callIndex: index,
        try: 1,
        attempt: 1,
        feature: 'round',
        function: 'round-plan',
        preset: 'full-terra',
        kind: 'text' as const,
        model: 'gpt-6.1-terra',
        seller,
        state,
        error: error ?? null,
        sellerRequestId: requestId ?? null,
        realCost: cost,
        startedAt,
        endedAt: new Date(startedAt.getTime() + seconds * 1000),
      }
    }),
  )
}

describe('/admin/ai/functions and /admin/ai/picks', () => {
  it('answer anyone who isn’t an admin 404, as if they didn’t exist, and add no pick', async () => {
    const person = await addPerson([[workspace.id, 'editor']])
    const input = { function: 'round-plan', mode: 'precise', preset: 'full-terra' }
    for (const [method, path, sent] of [
      ['GET', '/admin/ai/functions', undefined],
      ['POST', '/admin/ai/picks', input],
      ['GET', '/admin/ai/functions/round-plan/picks', undefined],
    ] as const) {
      expect((await ask(tokenOf(person.id), method, path, sent)).status).toBe(404)
      expect((await ask(null, method, path, sent)).status).toBe(404)
    }
    expect(await db.select().from(aiPicks).where(eq(aiPicks.setBy, person.id))).toEqual([])
  })

  it('list every AI function with its kind, its presets and the preset each mode uses', async () => {
    const functions = await rolledBack((routes) => functionsOf(routes))
    expect(functions.map((each) => each.function)).toEqual([...AI_FUNCTIONS])
    const code = { source: 'code', lacking: null, pickedAt: null }
    // A preset with no done call is on its first guess.
    const none = { done: 0, cutOffs: 0, failures: 0, firstGuess: true }
    expect(functions.find((each) => each.function === 'round-plan')).toEqual({
      function: 'round-plan',
      kind: 'text',
      presets: [
        {
          name: 'light-luna',
          model: 'gpt-6-luna',
          settings: { effort: 'low', tier: 'fast' },
          ownPrompt: true,
          measured: { ...none, cost: 0.54, seconds: 10 },
        },
        {
          name: 'full-terra',
          model: 'gpt-6.1-terra',
          settings: { effort: 'low', tier: 'standard' },
          ownPrompt: true,
          measured: { ...none, cost: 1.54, seconds: 33 },
        },
      ],
      modes: [
        { mode: 'fast', preset: 'light-luna', ...code },
        { mode: 'precise', preset: 'full-terra', ...code },
      ],
    })
    // A function no mode changes uses one preset, under no mode.
    expect(functions.find((each) => each.function === 'draft')).toEqual({
      function: 'draft',
      kind: 'picture',
      presets: [
        {
          name: 'gpt-image-medium',
          model: 'gpt-image-2.5-sunburst',
          settings: { quality: 'medium' },
          ownPrompt: false,
          measured: { ...none, cost: 3.05, seconds: 28 },
        },
      ],
      modes: [{ mode: '', preset: 'gpt-image-medium', ...code }],
    })
  })

  it('give a preset’s measurements as the call log has them: its done calls, the cost and seconds its hold and its wait use, its cut-offs and its failures', async () => {
    const read = await rolledBack(async (routes, tx) => {
      await logCalls(tx, [
        { state: 'done', cost: 1_200_000n, seconds: 21.4 },
        { state: 'done', cost: 1_900_000n, seconds: 18 },
        { state: 'done', cost: 1_100_000n, seconds: 30.2 },
        { state: 'failed', cost: 400_000n, error: CUT_OFF },
        { state: 'failed', error: 'refused: 400' },
        { state: 'failed', error: 'refused: 500' },
        { state: 'unknown' },
        // Neither a replayed call nor a call no seller of ours made is the preset's own.
        { state: 'done', requestId: 'replayed:round-plan/call-0' },
        { state: 'done', cost: 9_000_000n, seconds: 90, seller: 'test-seller' },
      ])
      const preset = presetOf('round-plan', 'full-terra')
      if (!preset) throw new Error('no preset')
      return {
        measured: (await roundPlanOf(routes)).roundPlan.presets.find((each) => each.name === 'full-terra')?.measured,
        numbers: await presetNumbers(tx, 'round-plan', 'full-terra', preset),
        held: await holdOf(tx, [{ fn: 'round-plan', preset: 'full-terra' }]),
      }
    })
    expect(read.measured).toEqual({ done: 3, cost: 1.9, seconds: 31, cutOffs: 1, failures: 2, firstGuess: false })
    // The page's cost and seconds are the ones a job's hold and wait are worked out from.
    expect(read.numbers).toEqual({ cost: 1_900_000n, seconds: 31, calls: 3 })
    expect(read.held).toBe((toMillionths(read.measured?.cost ?? 0) * 5n) / 4n)
  })

  it('add a pick that the next job runs, and keep every pick: the earlier preset picked again is a third row, and the history lists all three with who and when', async () => {
    const read = await rolledBack(async (routes, tx) => {
      const precise = async () => (await presetsFor(tx, 'precise'))['round-plan']
      const uses = async () => (await roundPlanOf(routes)).use
      const input = { function: 'round-plan', mode: 'precise' }
      const before = { use: await uses(), runs: await precise() }
      const first = await pick(routes, ada.token, { ...input, preset: 'light-luna', since: before.use.pickedAt })
      const picked = { use: await uses(), runs: await precise(), fast: (await roundPlanOf(routes, 'fast')).use }
      const second = await pick(routes, bo.token, { ...input, preset: 'full-terra', since: picked.use.pickedAt })
      const back = { use: await uses(), runs: await precise() }
      const third = await pick(routes, ada.token, { ...input, preset: 'light-luna', since: back.use.pickedAt })
      return {
        statuses: [first.status, second.status, third.status],
        before,
        picked,
        back,
        again: await precise(),
        history: await historyOf(routes),
        rows: await tx.select().from(aiPicks).where(eq(aiPicks.function, 'round-plan')),
      }
    })
    expect(read.statuses).toEqual([204, 204, 204])
    expect(read.before).toEqual({
      use: { mode: 'precise', preset: 'full-terra', source: 'code', lacking: null, pickedAt: null },
      runs: 'full-terra',
    })
    expect(read.picked.use).toMatchObject({ mode: 'precise', preset: 'light-luna', source: 'pick', lacking: null })
    expect(read.picked.runs).toBe('light-luna')
    // The pick is Precise's alone.
    expect(read.picked.fast).toMatchObject({ preset: 'light-luna', source: 'code', pickedAt: null })
    expect(read.back).toMatchObject({ use: { preset: 'full-terra', source: 'pick' }, runs: 'full-terra' })
    expect(read.again).toBe('light-luna')
    expect(read.rows).toHaveLength(3)
    expect(read.history.map(({ mode, preset, setBy }) => ({ mode, preset, setBy }))).toEqual([
      { mode: 'precise', preset: 'light-luna', setBy: ada.email },
      { mode: 'precise', preset: 'full-terra', setBy: bo.email },
      { mode: 'precise', preset: 'light-luna', setBy: ada.email },
    ])
    const times = read.history.map((each) => Date.parse(each.setAt))
    expect(times).toEqual([...new Set(times)].sort((a, b) => b - a))
    expect(read.history[1]?.setAt).toBe(read.back.use.pickedAt)
  })

  it('refuse a pick for a preset the code doesn’t have, and for a function and mode the modes list doesn’t hold, with nothing written', async () => {
    const read = await rolledBack(async (routes, tx) => {
      const before = await tx.select().from(aiPicks)
      const answers = []
      for (const input of [
        { function: 'round-plan', mode: 'precise', preset: 'gone-preset' },
        { function: 'round-plan', mode: '', preset: 'light-luna' },
        { function: 'draft', mode: 'fast', preset: 'gpt-image-medium' },
        { function: 'round-plan', mode: 'careful', preset: 'light-luna' },
        { function: 'no-function', mode: '', preset: 'light-luna' },
        { function: 'round-plan', mode: 'precise' },
      ]) {
        answers.push(await pick(routes, ada.token, input))
      }
      return { answers, before, after: await tx.select().from(aiPicks), use: (await roundPlanOf(routes)).use }
    })
    expect(read.answers.map((answer) => answer.status)).toEqual([400, 400, 400, 400, 400, 400])
    expect(read.answers.slice(0, 3).map((answer) => answer.json)).toEqual([
      { error: 'round-plan has no preset gone-preset' },
      { error: 'round-plan is picked for one of fast, precise' },
      { error: 'No mode changes draft' },
    ])
    expect(read.after).toEqual(read.before)
    expect(read.use).toMatchObject({ preset: 'full-terra', source: 'code', pickedAt: null })
  })

  it('tell the second of two admins picking at once that it changed meanwhile, and keep the first’s pick', async () => {
    const read = await rolledBack(async (routes, tx) => {
      const input = { function: 'round-plan', mode: 'precise' }
      // Both admins opened the page before either picked.
      const opened = (await roundPlanOf(routes)).use.pickedAt
      const first = await pick(routes, ada.token, { ...input, preset: 'light-luna', since: opened })
      const second = await pick(routes, bo.token, { ...input, preset: 'full-terra', since: opened })
      const kept = await tx.select().from(aiPicks).where(eq(aiPicks.function, 'round-plan'))
      // A pick for another mode changed nothing of this one, and a page that reloaded picks again.
      const fast = await pick(routes, bo.token, { ...input, mode: 'fast', preset: 'full-terra', since: null })
      const reloaded = (await roundPlanOf(routes)).use.pickedAt
      const third = await pick(routes, bo.token, { ...input, preset: 'full-terra', since: reloaded })
      return { first, second, kept, fast, third, runs: (await presetsFor(tx, 'precise'))['round-plan'] }
    })
    expect(read.first.status).toBe(204)
    expect(read.second).toMatchObject(STALE)
    expect(read.kept.map((row) => [row.preset, row.setBy])).toEqual([['light-luna', ada.id]])
    expect(read.fast.status).toBe(204)
    expect(read.third.status).toBe(204)
    expect(read.runs).toBe('full-terra')
  })

  it('say so when the newest pick names a preset the running code lacks, and run the code’s own choice', async () => {
    const read = await rolledBack(async (routes, tx) => {
      await pick(routes, ada.token, { function: 'round-plan', mode: 'precise', preset: 'light-luna' })
      // A pick made by a build whose code had the preset.
      await tx
        .insert(aiPicks)
        .values({ function: 'round-plan', mode: 'precise', preset: 'gone-preset', setBy: ada.id, setAt: new Date() })
      const lacking = (await roundPlanOf(routes)).use
      const runs = (await presetsFor(tx, 'precise'))['round-plan']
      const again = await pick(routes, ada.token, {
        function: 'round-plan',
        mode: 'precise',
        preset: 'light-luna',
        since: lacking.pickedAt,
      })
      return {
        lacking,
        runs,
        again: again.status,
        after: (await roundPlanOf(routes)).use,
        history: await historyOf(routes),
      }
    })
    expect(read.lacking).toMatchObject({ preset: 'full-terra', source: 'code', lacking: 'gone-preset' })
    expect(read.runs).toBe('full-terra')
    expect(read.again).toBe(204)
    expect(read.after).toMatchObject({ preset: 'light-luna', source: 'pick', lacking: null })
    expect(read.history.map((each) => each.preset)).toEqual(['light-luna', 'gone-preset', 'light-luna'])
  })

  it('have no history for a name that is no AI function', async () => {
    expect((await ask(ada.token, 'GET', '/admin/ai/functions/no-function/picks')).status).toBe(404)
  })
})
