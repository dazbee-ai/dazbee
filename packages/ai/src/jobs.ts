// AI jobs (ADR-0022): saving one with its hold in one transaction, starting an attempt under the workspace's job
// limit, ending it with the rest of its hold given back, cancelling it, and the sweep of jobs whose pg-boss
// job ended without them. The worker runs them; this module is shared with the API.
import { randomUUID } from 'node:crypto'

import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { fromDrizzle, type PgBoss, type QueueOptions } from 'pg-boss'

import { aiCalls, aiJobs, type Db, memberships, newId, type Tx } from '@dazbee/db'
import {
  type AiCallView,
  type AiFeatureInput,
  type AiJobKind,
  AiJobMessage,
  type AiJobRefusal,
  type AiJobState,
  type AiJobView,
  type CallOutput,
  CallsInput,
  CallsOutput,
  type CallState,
  parseFeatureJob,
} from '@dazbee/schema'

import { CUT_OFF } from './call-log.ts'
import { flowCalls, flowMode, type HeldCall, holdOf } from './features/holds.ts'
import { endHold, hold } from './ledger.ts'
import { presetsFor } from './picks.ts'
import { aiSettingsOf } from './settings.ts'

/** A job's kind with what it runs: a `calls` job's list of calls, or a flow job's input. */
export type JobInput = { kind: 'calls'; input: CallsInput } | AiFeatureInput

/** A job to save: in which workspace, by which member, of which job kind, and what it runs. */
export type NewJob = JobInput & {
  workspace: string
  member: string
  /** The pg-boss queue it goes to: `ai-calls` for a `calls` job and `ai-flow` for a flow job, unless given. */
  queue?: string
}

/** A saved job's id, or why it was refused. */
export type SavedJob = { ok: true; job: string } | { ok: false; refusal: AiJobRefusal }

/**
 * What starting an attempt found: make it, with its number and the preset each AI function of a flow job runs with
 * (none for a `calls` job, whose calls name theirs), or not (the job waits for a place, or has ended).
 */
export type AttemptStart =
  { make: true; attempt: number; job: JobInput; workspace: string; presets: Record<string, string> } | { make: false }

/** How a job's attempt ended. */
export type JobEnd =
  { state: 'done'; output: CallsOutput | null } | { state: 'failed'; error: string } | { state: 'cancelled' }

/** The pg-boss settings of every AI job queue: 2 retries of a crash or an expiry, 30 minutes an attempt, a heartbeat. */
export const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 5,
  expireInSeconds: 30 * 60,
  heartbeatSeconds: 30,
} satisfies QueueOptions

/** The queue of the `calls` jobs. */
export const CALLS_QUEUE = 'ai-calls'

/** The one queue of the flow's jobs, whose worker switches on the job kind. */
export const FLOW_QUEUE = 'ai-flow'

/** How long a job over its workspace's job limit waits before it is tried again. */
export const LIMIT_WAIT_SECONDS = 10

/**
 * What a workspace reads as a failed job's error. The job's row keeps why it failed, which can name a seller, a
 * model or a preset, and those a workspace never reads.
 */
export const JOB_FAILED = 'failed'

/** The roles that may use AI. */
const AI_ROLES = ['owner', 'admin', 'editor']

/** The states of a job that has ended. */
const ENDED: AiJobState[] = ['done', 'failed', 'cancelled']

/** The pg-boss states after which a job is never run again. */
const QUEUE_ENDED = ['completed', 'cancelled', 'failed']

/**
 * Saves an AI job in `tx`: throws on an input its job kind's schema refuses, and on a try-again of a brief the
 * workspace hasn't; refuses a member who may not use AI, a day past the spending stop, and a hold
 * bigger than what is left; then holds what its calls cost, writes the job with its mode and the preset each AI
 * function of its calls runs with in that mode, and sends its pg-boss job, all in the one transaction, so a failed send keeps
 * nothing. A pick made later never changes a saved job.
 */
export async function saveJob(tx: Tx, boss: PgBoss, job: NewJob): Promise<SavedJob> {
  const [member] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, job.workspace), eq(memberships.userId, job.member)))
  // A bad input throws before anything is held or written.
  const parsed = parseJob(job.kind, job.input)
  if (!member || !AI_ROLES.includes(member.role)) return { ok: false, refusal: 'not-allowed' }
  const settings = await aiSettingsOf(tx)
  if ((await spentToday(tx)) >= settings.spendingStop) return { ok: false, refusal: 'stopped' }
  const id = newId()
  const mode = parsed.kind === 'calls' ? null : await flowMode(tx, job.workspace, parsed)
  const calls: HeldCall[] =
    parsed.kind === 'calls'
      ? parsed.input.calls.map((call) => ({ fn: call.function, preset: call.preset, input: call.input }))
      : await flowCalls(tx, job.workspace, parsed, await presetsFor(tx, mode))
  // A flow job keeps the preset of each AI function its calls use; a `calls` job's calls name theirs.
  const presets = parsed.kind === 'calls' ? null : Object.fromEntries(calls.map((call) => [call.fn, call.preset]))
  const cost = await holdOf(tx, calls)
  if (!(await hold(tx, { workspace: job.workspace, job: id, cost }))) return { ok: false, refusal: 'used-up' }
  const queue = job.queue ?? (parsed.kind === 'calls' ? CALLS_QUEUE : FLOW_QUEUE)
  const queueJobId = randomUUID()
  await tx.insert(aiJobs).values({
    id,
    workspaceId: job.workspace,
    memberId: job.member,
    kind: parsed.kind,
    input: parsed.input,
    mode,
    presets,
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
    const input = parseJob(row.kind, row.input)
    // A flow job saved with no presets takes the ones in use now, and keeps them for its later attempts.
    const presets =
      row.presets ??
      (input.kind === 'calls' ? {} : await presetsFor(tx, row.mode ?? (await flowMode(tx, row.workspaceId, input))))
    await tx
      .update(aiJobs)
      .set({ state: 'running', attempt, startedAt: row.startedAt ?? new Date(), presets })
      .where(eq(aiJobs.id, job))
    await tx
      .update(aiCalls)
      .set({ state: 'unknown', error: 'its attempt ended', endedAt: new Date() })
      .where(and(eq(aiCalls.jobId, job), eq(aiCalls.state, 'running'), lt(aiCalls.attempt, attempt)))
    return { make: true, attempt, job: input, workspace: row.workspaceId, presets }
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
  return (await readJobs(db, workspace, [job]))[0] ?? null
}

/** The workspace's jobs among `jobs` as it reads them, in no set order; a job of another workspace is left out. */
export async function readJobs(db: Db | Tx, workspace: string, jobs: string[]): Promise<AiJobView[]> {
  if (jobs.length === 0) return []
  // The call log before the jobs: a try read as done had its output kept in the same transaction, so the job
  // read after it holds that output.
  const tries = await db
    .select({
      jobId: aiCalls.jobId,
      callIndex: aiCalls.callIndex,
      function: aiCalls.function,
      state: aiCalls.state,
      error: aiCalls.error,
    })
    .from(aiCalls)
    .where(and(inArray(aiCalls.jobId, jobs), eq(aiCalls.workspaceId, workspace)))
    .orderBy(asc(aiCalls.callIndex), asc(aiCalls.try))
  const rows = await db
    .select()
    .from(aiJobs)
    .where(and(inArray(aiJobs.id, jobs), eq(aiJobs.workspaceId, workspace)))
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    state: row.state,
    output: row.kind === 'calls' && row.output ? CallsOutput.parse(row.output) : null,
    calls: callViews(
      tries.filter((t) => t.jobId === row.id),
      row.callOutputs,
    ),
    error: row.error === null ? null : JOB_FAILED,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  }))
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

/** A job of `kind` with `input` as its job kind's schema reads it; throws on an input it refuses. */
function parseJob(kind: AiJobKind, input: unknown): JobInput {
  return kind === 'calls' ? { kind, input: CallsInput.parse(input) } : parseFeatureJob(kind, input)
}

/** Marks the job ended with `change` and gives back what it still holds. */
async function endWith(
  tx: Tx,
  job: string,
  workspace: string,
  change: { state?: AiJobState; output?: CallsOutput | null; error?: string | null },
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
  tries: { callIndex: number; function: string | null; state: CallState; error: string | null }[],
  outputs: Record<string, CallOutput>,
): AiCallView[] {
  const latest = new Map(tries.map((t) => [t.callIndex, t]))
  return [...latest.values()].map(({ callIndex: index, function: fn, state, error }): AiCallView => {
    // `step` repeats the AI function's name.
    const place = { index, function: fn ?? '', step: fn ?? '' }
    const output = outputs[String(index)]
    if (output) return { ...place, state: 'done', output }
    if (state === 'running' || state === 'done') return { ...place, state: 'running' }
    const failure = state === 'unknown' ? 'unknown' : error === CUT_OFF ? 'cut-off' : 'not-made'
    return { ...place, state: 'failed', failure }
  })
}
