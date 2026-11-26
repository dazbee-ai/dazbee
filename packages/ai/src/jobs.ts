// AI jobs (ADR-0022): saving one with its hold in one transaction, starting an attempt under the workspace's job
// limit, ending it with the rest of its hold given back, cancelling it, and the sweep of jobs whose pg-boss
// job ended without them. The worker runs them; this module is shared with the API.
import { randomUUID } from 'node:crypto'

import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { fromDrizzle, type PgBoss, type QueueOptions } from 'pg-boss'

import { aiCalls, aiJobs, type Db, memberships, newId, type Tx } from '@dazbee/db'
import {
  type AiCallView,
  type AiJobKind,
  AiJobMessage,
  type AiJobRefusal,
  type AiJobState,
  type AiJobView,
  AiStepsInput,
  AiStepsOutput,
  type CallOutput,
  type CallState,
} from '@dazbee/schema'

import { CUT_OFF } from './call-log.ts'
import { endHold, hold } from './ledger.ts'
import { aiSettingsOf } from './settings.ts'
import { holdFor } from './steps.ts'

/** A job to save: in which workspace, by which member, of which kind, and what it runs. */
export interface NewJob {
  workspace: string
  member: string
  kind: AiJobKind
  input: AiStepsInput
  /** The pg-boss queue it goes to; its kind's queue unless given. */
  queue?: string
}

/** A saved job's id, or why it was refused. */
export type SavedJob = { ok: true; job: string } | { ok: false; refusal: AiJobRefusal }

/** What starting an attempt found: make it, with its number, or not (the job waits for a place, or has ended). */
export type AttemptStart = { make: true; attempt: number; input: AiStepsInput; workspace: string } | { make: false }

/** How a job's attempt ended. */
export type JobEnd =
  { state: 'done'; output: AiStepsOutput } | { state: 'failed'; error: string } | { state: 'cancelled' }

/** The pg-boss settings of every AI job queue: 2 retries of a crash or an expiry, 30 minutes an attempt, a heartbeat. */
export const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 5,
  expireInSeconds: 30 * 60,
  heartbeatSeconds: 30,
} satisfies QueueOptions

/** How long a job over its workspace's job limit waits before it is tried again. */
export const LIMIT_WAIT_SECONDS = 10

/** The roles that may use AI. */
const AI_ROLES = ['owner', 'admin', 'editor']

/** The states of a job that has ended. */
const ENDED: AiJobState[] = ['done', 'failed', 'cancelled']

/** The pg-boss states after which a job is never run again. */
const QUEUE_ENDED = ['completed', 'cancelled', 'failed']

/**
 * Saves an AI job in `tx`: throws on an input its schema refuses; refuses a member who may not use AI, a day past the spending stop, and a hold
 * bigger than what is left; then holds its expected cost, writes the job and sends its pg-boss job, all in
 * the one transaction, so a failed send keeps nothing.
 */
export async function saveJob(tx: Tx, boss: PgBoss, job: NewJob): Promise<SavedJob> {
  const [member] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, job.workspace), eq(memberships.userId, job.member)))
  // A bad input throws before anything is held or written.
  const input = AiStepsInput.parse(job.input)
  if (!member || !AI_ROLES.includes(member.role)) return { ok: false, refusal: 'not-allowed' }
  const settings = await aiSettingsOf(tx)
  if ((await spentToday(tx)) >= settings.spendingStop) return { ok: false, refusal: 'stopped' }
  const id = newId()
  const cost = await holdFor(tx, input.calls)
  if (!(await hold(tx, { workspace: job.workspace, job: id, cost }))) return { ok: false, refusal: 'used-up' }
  const queue = job.queue ?? job.kind
  const queueJobId = randomUUID()
  await tx.insert(aiJobs).values({
    id,
    workspaceId: job.workspace,
    memberId: job.member,
    kind: job.kind,
    input,
    queue,
    queueJobId,
  })
  const message: AiJobMessage = { job: id }
  await boss.send(queue, message, { id: queueJobId, db: fromDrizzle(tx, sql) })
  return { ok: true, job: id }
}

/** Makes `queue` with the AI job settings when it doesn't exist yet. */
export async function ensureQueue(boss: PgBoss, queue: string): Promise<void> {
  if (!(await boss.getQueue(queue))) await boss.createQueue(queue, QUEUE_OPTIONS)
}

/** The real cost of every AI call started today, midnight to midnight IST, in millionths of a rupee. */
export async function spentToday(db: Db | Tx): Promise<bigint> {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${aiCalls.realCost}), 0)` })
    .from(aiCalls)
    .where(
      gte(aiCalls.startedAt, sql`date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`),
    )
  return BigInt(row?.sum ?? 0)
}

/**
 * Starts an attempt of `job` for pg-boss job `queueJobId` of `queue`: under a lock on the workspace's AI jobs, a
 * job that would pass the job limit is sent again to start later (a new pg-boss job, so no try is spent);
 * otherwise the job takes its next attempt and the earlier attempts' running calls become unknown. A
 * cancelled job that never ran is ended here.
 */
export async function startAttempt(
  db: Db,
  boss: PgBoss,
  { job, queue, queueJobId }: { job: string; queue: string; queueJobId: string },
): Promise<AttemptStart> {
  return db.transaction(async (tx) => {
    const [found] = await tx.select({ workspace: aiJobs.workspaceId }).from(aiJobs).where(eq(aiJobs.id, job))
    if (!found) return { make: false }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-jobs:${found.workspace}`}))`)
    const [row] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job)).for('update')
    if (!row || row.queueJobId !== queueJobId) return { make: false }
    if (row.state === 'cancelled') {
      if (!row.endedAt) await endWith(tx, row.id, row.workspaceId, {})
      return { make: false }
    }
    if (ENDED.includes(row.state)) return { make: false }
    if (row.state === 'waiting') {
      const settings = await aiSettingsOf(tx)
      const [running] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.workspaceId, row.workspaceId),
            ne(aiJobs.id, job),
            // A cancelled job whose calls are still stopping keeps its place until it ends.
            or(
              eq(aiJobs.state, 'running'),
              and(eq(aiJobs.state, 'cancelled'), isNull(aiJobs.endedAt), gt(aiJobs.attempt, 0)),
            ),
          ),
        )
      if ((running?.count ?? 0) >= settings.jobLimit) {
        const later = randomUUID()
        await tx.update(aiJobs).set({ queueJobId: later }).where(eq(aiJobs.id, job))
        const message: AiJobMessage = { job }
        await boss.send(queue, message, { id: later, startAfter: LIMIT_WAIT_SECONDS, db: fromDrizzle(tx, sql) })
        return { make: false }
      }
    }
    const attempt = row.attempt + 1
    await tx
      .update(aiJobs)
      .set({ state: 'running', attempt, startedAt: row.startedAt ?? new Date() })
      .where(eq(aiJobs.id, job))
    await tx
      .update(aiCalls)
      .set({ state: 'unknown', error: 'its attempt ended', endedAt: new Date() })
      .where(and(eq(aiCalls.jobId, job), eq(aiCalls.state, 'running'), lt(aiCalls.attempt, attempt)))
    return { make: true, attempt, input: AiStepsInput.parse(row.input), workspace: row.workspaceId }
  })
}

/**
 * Sends `job` again as a new pg-boss job to start at once, for a worker that stops before the attempt is done,
 * so the stop spends none of the job's tries; the next attempt reuses the calls already done. A job cancelled
 * meanwhile ends here instead. Gives whether the attempt still owned the job.
 */
export async function sendAgain(
  db: Db,
  boss: PgBoss,
  { job, attempt, queue }: { job: string; attempt: number; queue: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job)).for('update')
    if (!row || row.attempt !== attempt || row.endedAt) return false
    if (row.state === 'cancelled') {
      await endWith(tx, job, row.workspaceId, {})
      return true
    }
    if (row.state !== 'running') return false
    const again = randomUUID()
    await tx.update(aiJobs).set({ queueJobId: again }).where(eq(aiJobs.id, job))
    const message: AiJobMessage = { job }
    await boss.send(queue, message, { id: again, db: fromDrizzle(tx, sql) })
    return true
  })
}

/**
 * Ends `job`'s attempt `attempt` as `end` says, giving back the rest of its hold, when that attempt still owns
 * the job; a cancelled job ends as cancelled whatever its attempt found. Gives whether it ended the job.
 */
export async function endJob(db: Db, job: string, attempt: number, end: JobEnd): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job)).for('update')
    if (!row || row.attempt !== attempt || row.endedAt) return false
    if (row.state === 'cancelled') {
      // A cancel that came once every call had finished keeps what they made.
      await endWith(tx, job, row.workspaceId, end.state === 'done' ? { output: end.output } : {})
      return true
    }
    if (row.state !== 'running' || end.state === 'cancelled') return false
    await endWith(tx, job, row.workspaceId, {
      state: end.state,
      output: end.state === 'done' ? end.output : null,
      error: end.state === 'failed' ? end.error.slice(0, 1000) : null,
    })
    return true
  })
}

/** The job's state as its workspace reads it, or null when the workspace has no such job. */
export async function readJob(db: Db | Tx, workspace: string, job: string): Promise<AiJobView | null> {
  // The call log before the job: a try read as done had its output kept in the same transaction, so the job
  // read after it holds that output.
  const tries = await db
    .select({ callIndex: aiCalls.callIndex, step: aiCalls.step, state: aiCalls.state, error: aiCalls.error })
    .from(aiCalls)
    .where(and(eq(aiCalls.jobId, job), eq(aiCalls.workspaceId, workspace)))
    .orderBy(asc(aiCalls.callIndex), asc(aiCalls.try))
  const [row] = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, job), eq(aiJobs.workspaceId, workspace)))
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    output: row.output ? AiStepsOutput.parse(row.output) : null,
    calls: callViews(tries, row.callOutputs),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  }
}

/**
 * Cancels the workspace's job unless it has ended; gives whether it did. A job that hasn't started gives back
 * its hold at once; a running one is stopped by its worker, which gives back the rest once its calls stop.
 */
export async function cancelJob(db: Db, workspace: string, job: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.id, job), eq(aiJobs.workspaceId, workspace)))
      .for('update')
    if (!row || ENDED.includes(row.state)) return false
    await tx.update(aiJobs).set({ state: 'cancelled' }).where(eq(aiJobs.id, job))
    if (row.state === 'waiting') await endWith(tx, job, workspace, {})
    return true
  })
}

/** Whether the job was cancelled, as a running worker checks between calls. */
export async function isCancelled(db: Db, job: string): Promise<boolean> {
  const [row] = await db.select({ state: aiJobs.state }).from(aiJobs).where(eq(aiJobs.id, job))
  return row?.state === 'cancelled'
}

/**
 * Ends every AI job of `queue` not yet ended whose pg-boss job will never run again (it failed with no retry left, was
 * completed or cancelled without the job ending, or is gone): a cancelled one as cancelled, any other as
 * failed, with its running calls unknown and its hold given back. Gives how many it ended.
 */
export async function sweepJobs(db: Db, boss: PgBoss, queue: string): Promise<number> {
  const open = await db
    .select({ id: aiJobs.id, queueJobId: aiJobs.queueJobId })
    .from(aiJobs)
    .where(
      and(eq(aiJobs.queue, queue), isNull(aiJobs.endedAt), inArray(aiJobs.state, ['waiting', 'running', 'cancelled'])),
    )
  let ended = 0
  for (const job of open) {
    if (!job.queueJobId) continue
    const [queued] = await boss.findJobs(queue, { id: job.queueJobId })
    if (queued && !QUEUE_ENDED.includes(queued.state)) continue
    const swept = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(aiJobs).where(eq(aiJobs.id, job.id)).for('update')
      if (!row || row.endedAt || row.queueJobId !== job.queueJobId) return false
      await tx
        .update(aiCalls)
        .set({ state: 'unknown', error: 'its worker was lost', endedAt: new Date() })
        .where(and(eq(aiCalls.jobId, job.id), eq(aiCalls.state, 'running')))
      await endWith(
        tx,
        job.id,
        row.workspaceId,
        row.state === 'cancelled' ? {} : { state: 'failed', error: 'its worker was lost' },
      )
      return true
    })
    if (swept) ended++
  }
  return ended
}

/** Marks the job ended with `change` and gives back what it still holds. */
async function endWith(
  tx: Tx,
  job: string,
  workspace: string,
  change: { state?: AiJobState; output?: AiStepsOutput | null; error?: string | null },
): Promise<void> {
  await tx
    .update(aiJobs)
    .set({ ...change, endedAt: new Date() })
    .where(eq(aiJobs.id, job))
  await endHold(tx, { workspace, job })
}

/**
 * Each started call of a job, by call index, from its tries in the call log (oldest first) and the outputs kept:
 * made when its output is kept, being made while its latest try runs or is done with its output not yet read,
 * and otherwise failed, with why.
 */
function callViews(
  tries: { callIndex: number; step: string; state: CallState; error: string | null }[],
  outputs: Record<string, CallOutput>,
): AiCallView[] {
  const latest = new Map(tries.map((t) => [t.callIndex, t]))
  return [...latest.values()].map(({ callIndex: index, step, state, error }): AiCallView => {
    const output = outputs[String(index)]
    if (output) return { index, step, state: 'done', output }
    if (state === 'running' || state === 'done') return { index, step, state: 'running' }
    const failure = state === 'unknown' ? 'unknown' : error === CUT_OFF ? 'cut-off' : 'not-made'
    return { index, step, state: 'failed', failure }
  })
}
