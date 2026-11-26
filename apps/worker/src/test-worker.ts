// Fixtures for the worker's tests, against Postgres and storage from Docker Compose: workspaces with a
// member and a grant, test-only AI steps run by test sellers, pg-boss instances that notice a lost job fast,
// and the checks that a job's ledger settled. Imported by tests only.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, expect, vi } from 'vitest'

import { giveGrant, left, QUEUE_OPTIONS, type SellerAdapter, useSeller } from '@dazbee/ai'
import {
  aiCalls,
  aiJobs,
  aiLedger,
  aiPrices,
  memberships,
  modelSellers,
  newId,
  openDatabase,
  users,
  workspaces,
} from '@dazbee/db'
import type { AiJobState, CallsInput, MemberRole } from '@dazbee/schema'
import { openStorage, storageSettings } from '@dazbee/storage'

import { DATABASE_URL } from './test-database.ts'
import { declareTestFunction, TEST_PRESET, testModelOf } from './test-function.ts'

/** The allowance each test workspace is given: ₹100. */
export const ALLOWANCE = 100_000_000n

export const { db, close } = openDatabase(DATABASE_URL, { max: 8 })

export const storage = openStorage(
  storageSettings({
    STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
    STORAGE_BUCKET: 'dazbee-test',
    STORAGE_ACCESS_KEY_ID: 'dazbee',
    STORAGE_SECRET_ACCESS_KEY: 'dazbee-local-secret',
    STORAGE_REGION: 'us-east-1',
    ...process.env,
  }),
)

// CI's storage starts empty, and the worker's tests may run before any other makes the bucket.
beforeAll(() => storage.ensureBucket())

afterAll(close)

/** A queue no other test uses. */
export const newQueue = () => `ai-calls-${newId()}`

/** A started pg-boss that checks for lost jobs every second (its supervise and monitor passes). */
export async function newBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: DATABASE_URL,
    max: 4,
    monitorIntervalSeconds: 1,
    superviseIntervalSeconds: 1,
    schedule: false,
  })
  boss.on('error', () => undefined)
  await boss.start()
  return boss
}

/** A workspace with a member of `role` and ₹100 of allowance. */
export async function memberOf(role: MemberRole = 'editor') {
  const workspace = `ws-${newId()}`
  const member = `user-${newId()}`
  await db.insert(workspaces).values({ id: workspace, name: 'Harbour' })
  await db.insert(users).values({ id: member, workosUserId: `workos-${member}`, email: `${member}@example.com` })
  await db.insert(memberships).values({ workspaceId: workspace, userId: member, role })
  await giveGrant(db, { workspace, amount: ALLOWANCE, expiresAt: new Date(Date.now() + 86_400_000) })
  return { workspace, member }
}

/**
 * A test-only text function whose model `sellers` sell in order at US$1 and US$2 a million tokens; an input of
 * `count` calls of it.
 */
export async function callsInputOf(sellers: SellerAdapter[], count = 1): Promise<CallsInput> {
  const fn = `test-function-${newId()}`
  const model = testModelOf(fn)
  declareTestFunction(fn)
  for (const [position, seller] of sellers.entries()) {
    useSeller(seller)
    await db.insert(modelSellers).values({ model, seller: seller.seller, position })
    await db.insert(aiPrices).values([
      { seller: seller.seller, model, unit: 'input-token', currency: 'USD', pricePerMillion: 1_000_000n },
      { seller: seller.seller, model, unit: 'output-token', currency: 'USD', pricePerMillion: 2_000_000n },
    ])
  }
  const input = { kind: 'text' as const, instructions: 'Read the ad.', prompt: 'A coffee ad.', pictures: [] }
  return { calls: Array.from({ length: count }, () => ({ function: fn, preset: TEST_PRESET, input })) }
}

/** A seller name no other test uses. */
export const newSeller = (name: string) => `test-${name}-${newId()}`

/** The job's row. */
export async function jobRow(job: string) {
  const [row] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
  if (!row) throw new Error(`no job ${job}`)
  return row
}

/** Waits until the job is in `state` and, for an end state, ended. */
export async function waitForJob(job: string, state: AiJobState, timeout = 30_000) {
  return vi.waitFor(
    async () => {
      const row = await jobRow(job)
      const ended = state === 'waiting' || state === 'running' || row.endedAt !== null
      if (row.state !== state || !ended) throw new Error(`job ${job} is ${row.state}`)
      return row
    },
    { timeout, interval: 100 },
  )
}

/**
 * Checks that an ended job's ledger settled: each AI call charged at most once, nothing still held, and
 * the workspace's allowance down by exactly what was charged.
 */
export async function expectSettled(job: string, workspace: string): Promise<void> {
  const charged = await db
    .select({ callIndex: aiCalls.callIndex, count: sql<number>`count(*)::int` })
    .from(aiCalls)
    .where(and(eq(aiCalls.jobId, job), isNotNull(aiCalls.chargedAt)))
    .groupBy(aiCalls.callIndex)
  for (const row of charged) expect(row.count).toBe(1)
  const rows = await db.select().from(aiLedger).where(eq(aiLedger.jobId, job))
  const sum = (kinds: string[], withCall: boolean) =>
    rows.filter((r) => kinds.includes(r.kind) && (r.callId !== null) === withCall).reduce((s, r) => s + r.amount, 0n)
  const charges = sum(['charge'], true)
  // A hold is given back by charges' give-backs and the job's end; together they cancel it out.
  expect(sum(['hold'], false) + sum(['give-back'], true) + sum(['give-back'], false)).toBe(0n)
  expect(await left(db, workspace)).toBe(ALLOWANCE + charges)
}

/** The job's call-log rows, in order of call and try, as call index, seller and state. */
export async function callsOf(job: string) {
  return db
    .select({ callIndex: aiCalls.callIndex, seller: aiCalls.seller, state: aiCalls.state, attempt: aiCalls.attempt })
    .from(aiCalls)
    .where(eq(aiCalls.jobId, job))
    .orderBy(aiCalls.callIndex, aiCalls.try)
}

/**
 * Makes `queue` with a 10 s heartbeat, the shortest pg-boss allows, so a crashed worker's job is noticed
 * fast, and `retryLimit` tries after the first.
 */
export async function crashQueue(boss: PgBoss, queue: string, retryLimit: number = QUEUE_OPTIONS.retryLimit) {
  await boss.createQueue(queue, { ...QUEUE_OPTIONS, heartbeatSeconds: 10, retryDelay: 0, retryLimit })
}

/**
 * Starts a worker in a process of its own on `queue`, whose seller `seller` answers the AI function `fn` after
 * `afterMs`; resolves once it takes jobs, with a function that kills it at once, as a crash would.
 */
export async function crashingWorker(queue: string, fn: string, seller: string, afterMs: number) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./test-crash-worker.ts', import.meta.url))], {
    env: {
      ...process.env,
      CRASH_QUEUE: queue,
      CRASH_FUNCTION: fn,
      CRASH_SELLER: seller,
      CRASH_AFTER_MS: String(afterMs),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) resolve()
    })
    child.once('exit', (code) => reject(new Error(`the crashing worker exited with ${code}`)))
  })
  return {
    kill: () =>
      new Promise<void>((resolve) => {
        child.removeAllListeners('exit')
        child.once('exit', () => resolve())
        child.kill('SIGKILL')
      }),
  }
}
