// Saving a flow job a tab starts: the job, its hold and its pg-boss job, then the brief, AI frame and refine rows it
// fills, in one transaction that holds the design's lock, so two jobs started at once on one design never both act
// on one frame, and a refused job writes nothing. Also the checks a job's frames pass in that transaction.
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'

import { saveJob } from '@dazbee/ai'
import { aiFrames, type Db, type Tx } from '@dazbee/db'
import type { AiFrameState, AiFrameView, AiJobRefusal, BrandSummary, FlowJobInput } from '@dazbee/schema'

import { frameBusy, framesOf } from './ai-frames.ts'

/** Who starts a job: in which workspace and brand, as which person. */
export interface Starter {
  workspace: string
  brand: BrandSummary
  member: string
}

/** A started job, with the brief it wrote; or why saving it was refused, with nothing written. */
export type Started = { ok: true; job: string; briefId: string | null } | { ok: false; refusal: AiJobRefusal }

/** What a job saves beside itself, in its transaction, once it is held. */
export type Rows = (tx: Tx, job: string) => Promise<void>

/** A job to save, worked out in its transaction, and the rows it saves beside itself once it is held. */
export type Plan = (tx: Tx) => Promise<{ flow: FlowJobInput; rows: (job: string) => Promise<void> }>

/** A frame a job fills: which call of the job fills it, and the state it starts in. */
export interface FrameCall {
  frameId: string
  callIndex: number
  state: AiFrameState
}

/** A request the API refuses before anything is held: its answer's status and message. */
export class StartRefused extends Error {
  readonly status: 400 | 404 | 409

  constructor(message: string, status: 400 | 404 | 409) {
    super(message)
    this.name = 'StartRefused'
    this.status = status
  }
}

/** Saving refused by `saveJob`, which rolls the transaction back. */
class SaveRefused extends Error {
  readonly refusal: AiJobRefusal

  constructor(refusal: AiJobRefusal) {
    super(refusal)
    this.refusal = refusal
  }
}

/**
 * Saves the job `plan` gives on `design`, with its hold and its pg-boss job, then its rows, in one transaction that
 * first takes the design's lock and runs `check` again. A refused save writes nothing.
 */
export async function saveFlow(
  { db, boss, starter }: { db: Db; boss: PgBoss; starter: Starter },
  design: string,
  plan: Plan,
  check: (tx: Tx) => Promise<unknown> = async () => {},
): Promise<Started> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-frames:${design}`}))`)
      await check(tx)
      const planned = await plan(tx)
      const saved = await saveJob(tx, boss, { workspace: starter.workspace, member: starter.member, ...planned.flow })
      if (!saved.ok) throw new SaveRefused(saved.refusal)
      await planned.rows(saved.job)
      return { ok: true, job: saved.job, briefId: null }
    })
  } catch (refused) {
    if (refused instanceof SaveRefused) return { ok: false, refusal: refused.refusal }
    throw refused
  }
}

/** The plan of a save of `flow` and `rows`. */
export function withRows(flow: FlowJobInput, rows: Rows): Plan {
  return async (tx) => ({ flow, rows: (job) => rows(tx, job) })
}

/** Rows that point the design's AI frames at the job's calls, each in the state it starts in. */
export function pointFrames(design: string, frames: FrameCall[]): Rows {
  return async (tx, job) => {
    for (const { frameId, callIndex, state } of frames) {
      await tx
        .update(aiFrames)
        .set({ jobId: job, callIndex, state, updatedAt: new Date() })
        .where(and(eq(aiFrames.designId, design), eq(aiFrames.frameId, frameId)))
    }
  }
}

/** The design's AI frame `frame` as tabs read it; refuses a frame that isn't one. */
export async function aiFrame(db: Db | Tx, workspace: string, design: string, frame: string): Promise<AiFrameView> {
  const [found] = (await framesOf(db, workspace, design, [frame])).frames
  if (!found) throw new StartRefused('That frame isn’t an AI frame of this design', 404)
  return found
}

/** The design's AI frames `frames`, each refused when it isn't one or is working. */
export async function idleFrames(
  db: Db | Tx,
  workspace: string,
  design: string,
  frames: string[],
): Promise<AiFrameView[]> {
  if (new Set(frames).size !== frames.length) throw new StartRefused('Name each frame once', 400)
  const found: AiFrameView[] = []
  for (const frame of frames) {
    const each = await aiFrame(db, workspace, design, frame)
    if (await frameBusy(db, workspace, design, each)) throw new StartRefused('That frame is working', 409)
    found.push(each)
  }
  return found
}

/** Refuses frames of the design that are AI frames already, or named twice. */
export async function refuseTaken(tx: Tx, design: string, frames: string[]): Promise<void> {
  if (new Set(frames).size !== frames.length) throw new StartRefused('Name each frame once', 400)
  const [taken] = await tx
    .select({ frameId: aiFrames.frameId })
    .from(aiFrames)
    .where(and(eq(aiFrames.designId, design), inArray(aiFrames.frameId, frames)))
    .limit(1)
  if (taken) throw new StartRefused('Those frames are AI frames already', 409)
}
