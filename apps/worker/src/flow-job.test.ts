// The worker running saved flow jobs from a real pg-boss in the test database, with a test seller and storage
// from Docker Compose: each case on its own queue and workspace.
import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { ensureQueue, readJob, saveJob, sweepJobs, useSeller } from '@dazbee/ai'
import { testSeller } from '@dazbee/ai/test-sellers'
import { aiJobs, aiPrices, assets, brands, newId } from '@dazbee/db'
import type { RoundInput, RoundPlanAnswer } from '@dazbee/schema'
import { originalKey } from '@dazbee/storage'

import { startFlowWorker } from './flow-job.ts'
import {
  callsOf,
  db,
  expectSettled,
  jobRow,
  memberOf,
  newBoss,
  newQueue,
  newSeller,
  storage,
  waitForJob,
} from './test-worker.ts'

/** A plan of four ads. */
const PLAN: RoundPlanAnswer = {
  brand: 'Calm. Facts: "Harbour Coffee"',
  ads: (['photographic', 'graphical', 'composite', 'free'] as const).map((kind, i) => ({
    kind,
    idea: 'An idea.',
    arrangement: 'The cup at the left.',
    picture: 'The cup.',
    prompt: `Ad number ${i + 1}.`,
  })),
}

/** A 1 × 1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** A workspace with a brand and a product picture stored in its originals. */
async function brandOf() {
  const who = await memberOf()
  const brand = `brand-${newId()}`
  await db.insert(brands).values({ id: brand, workspaceId: who.workspace, name: 'Harbour Coffee' })
  const product = originalKey(who.workspace, createHash('sha256').update(PNG).digest('hex'))
  await storage.put(product, PNG, 'image/png')
  return { ...who, brand, product }
}

/** A Fast round of `who`'s, square, with its product picture. */
function roundOf(who: Awaited<ReturnType<typeof brandOf>>): RoundInput {
  const frame = () => ({ frameId: newId(), pictureLayerId: newId() })
  return {
    brandId: who.brand,
    designId: `design-${newId()}`,
    briefId: `brief-${newId()}`,
    sectionId: newId(),
    frames: [frame(), frame(), frame(), frame()],
    words: 'Harbour Coffee, fresh every morning',
    pictures: [who.product],
    size: { width: 1080, height: 1080 },
    mode: 'fast',
    brand: { name: 'Harbour Coffee', colors: [], fonts: [], voice: '' },
  }
}

/** A test seller that plans, then makes each picture, priced in tokens for the models a Fast round runs. */
async function roundSeller() {
  const seller = newSeller('flow')
  const picture = { bytes: PNG, type: 'image/png', width: 1, height: 1 }
  const plan = { answer: { kind: 'text' as const, text: JSON.stringify(PLAN), json: PLAN } }
  const draft = { answer: { kind: 'pictures' as const, pictures: [picture] } }
  const adapter = testSeller(seller, [plan, draft, draft, draft, draft])
  for (const model of ['gpt-6-luna', 'gpt-image-2.5-sunburst']) {
    await db.insert(aiPrices).values(
      (['input-token', 'output-token'] as const).map((unit) => ({
        seller,
        model,
        unit,
        currency: 'USD',
        pricePerMillion: 1_000_000n,
      })),
    )
  }
  return adapter
}

/** Saves `input` as a round of `who`'s on `queue`; its id. */
async function save(who: { workspace: string; member: string }, queue: string, input: RoundInput) {
  const boss = await newBoss()
  try {
    const saved = await db.transaction((tx) => saveJob(tx, boss, { ...who, kind: 'round', input, queue }))
    if (!saved.ok) throw new Error(`refused: ${saved.refusal}`)
    return saved.job
  } finally {
    await boss.stop({ graceful: false })
  }
}

describe('startFlowWorker', () => {
  it('runs a round to done: four pictures in the workspace’s originals, each an asset of the brand', async () => {
    const queue = newQueue()
    const who = await brandOf()
    const seller = await roundSeller()
    useSeller(seller)
    const boss = await newBoss()
    const flow = await startFlowWorker({ db, boss, storage, queue, callLimit: 8, sellers: [seller.seller] })
    const job = await save(who, queue, roundOf(who))
    const done = await vi.waitFor(
      async () => {
        const row = await jobRow(job)
        if (!row.endedAt) throw new Error(`job ${job} is ${row.state}: ${JSON.stringify(await callsOf(job))}`)
        return row
      },
      { timeout: 20_000, interval: 100 },
    )

    expect({ state: done.state, error: done.error, output: done.output }).toEqual({
      state: 'done',
      error: null,
      output: null,
    })
    const calls = (await readJob(db, who.workspace, job))?.calls ?? []
    const pictures = calls.flatMap((c) => (c.state === 'done' && c.output.kind === 'pictures' ? c.output.pictures : []))
    expect(pictures).toHaveLength(4)
    for (const picture of pictures) {
      expect(picture.key.startsWith(`workspaces/${who.workspace}/`)).toBe(true)
      expect(await storage.exists(picture.key)).toBe(true)
      expect(picture.assetId).toBeTruthy()
    }
    // The four drafts are the same bytes here, so they are one asset of the brand.
    const recorded = await db.select().from(assets).where(eq(assets.brandId, who.brand))
    expect(recorded.map((asset) => [asset.id, asset.tags])).toEqual([[pictures[0]?.assetId, ['ai']]])
    await expectSettled(job, who.workspace)
    await flow.stop('graceful', 1000)
  })

  it('ends a pg-boss job whose AI job is gone without an error, and never tries it again', async () => {
    const queue = newQueue()
    const who = await brandOf()
    const boss = await newBoss()
    await ensureQueue(boss, queue)
    const job = await save(who, queue, roundOf(who))
    const { queueJobId } = await jobRow(job)
    // As the migration that empties the run history leaves a job that was waiting.
    await db.delete(aiJobs).where(eq(aiJobs.id, job))
    const flow = await startFlowWorker({ db, boss, storage, queue, callLimit: 8 })
    const queued = await vi.waitFor(
      async () => {
        const [found] = await boss.findJobs(queue, { id: queueJobId ?? '' })
        if (found?.state !== 'completed') throw new Error(`the pg-boss job is ${found?.state}`)
        return found
      },
      { timeout: 20_000, interval: 100 },
    )
    expect(queued.retryCount).toBe(0)
    await flow.stop('graceful', 1000)
  })

  it('leaves a job whose pg-boss job is gone to the sweep, which fails it and gives back its hold', async () => {
    const queue = newQueue()
    const who = await brandOf()
    const boss = await newBoss()
    await ensureQueue(boss, queue)
    const job = await save(who, queue, roundOf(who))
    const [queued] = await boss.findJobs(queue, {})
    await boss.deleteJob(queue, queued?.id ?? '')
    expect(await sweepJobs(db, boss, queue)).toBe(1)
    expect((await waitForJob(job, 'failed')).error).toBe('its worker was lost')
    await expectSettled(job, who.workspace)
    await boss.stop({ graceful: false })
  })
})
