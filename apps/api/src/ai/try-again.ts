// Trying a failed AI frame again: a draft from its brief's stored plan; the whole round into the same frames when
// its round's plan failed; or a resize's one size. The frames it fills must still have failed once the design's
// lock is held, so two asks at once start one job.
import { and, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'

import { ROUND_CALL } from '@dazbee/ai'
import { aiBriefs, aiJobs, type Db, type Tx } from '@dazbee/db'
import { parseFlowJob, type StartTryAgain } from '@dazbee/schema'

import {
  aiFrame,
  type FrameCall,
  type Plan,
  pointFrames,
  saveFlow,
  type Started,
  type Starter,
  StartRefused,
  withRows,
} from './start-job.ts'

/** What a frame no job kind can try again is told. */
const NOT_TRIED_AGAIN = 'This frame can’t be tried again'

/** Tries the failed frame `request.frameId` again. */
export async function tryAgain(
  { db, boss, queue }: { db: Db; boss: PgBoss; queue: string },
  starter: Starter,
  request: StartTryAgain,
): Promise<Started> {
  const { workspace } = starter
  const design = request.designId
  const frame = await aiFrame(db, workspace, design, request.frameId)
  if (frame.state !== 'failed') throw new StartRefused('Only a frame that didn’t come out can be tried again', 409)
  const [row] = await db
    .select({ kind: aiJobs.kind, input: aiJobs.input, state: aiJobs.state })
    .from(aiJobs)
    .where(and(eq(aiJobs.id, frame.jobId), eq(aiJobs.workspaceId, workspace)))
  if (!row || row.kind === 'calls') throw new StartRefused(NOT_TRIED_AGAIN, 409)
  const failed = parseFlowJob(row.kind, row.input)
  const save = (plan: Plan, frames: FrameCall[]) =>
    saveFlow({ db, boss, queue, starter }, design, plan, async (tx: Tx) => {
      for (const { frameId } of frames) {
        const now = await aiFrame(tx, workspace, design, frameId)
        if (now.state !== 'failed' || now.jobId !== frame.jobId) throw new StartRefused('That frame is working', 409)
      }
    })
  const again = (flow: Parameters<typeof withRows>[0], frames: FrameCall[]) =>
    save(withRows(flow, pointFrames(design, frames)), frames)
  const waiting = (frameId: string, callIndex: number): FrameCall => ({ frameId, callIndex, state: 'waiting' })
  switch (failed.kind) {
    case 'round':
    case 'more-like-this': {
      const { input } = failed
      const [brief] = await db
        .select({ plan: aiBriefs.plan })
        .from(aiBriefs)
        .where(and(eq(aiBriefs.id, input.briefId), eq(aiBriefs.workspaceId, workspace)))
      if (!brief) throw new StartRefused('This frame’s brief is gone', 409)
      if (!brief.plan && row.state === 'failed') {
        // The plan failed, so no draft was made: the whole round again, into the same frames.
        return again(
          failed,
          input.frames.map((f, n) => waiting(f.frameId, ROUND_CALL.draft(n))),
        )
      }
      const draft = frame.callIndex - ROUND_CALL.draft(0)
      const target = input.frames[draft]
      if (!target) throw new StartRefused(NOT_TRIED_AGAIN, 409)
      const one = { brandId: input.brandId, designId: input.designId, briefId: input.briefId, draft, frame: target }
      return again({ kind: 'try-again', input: one }, [waiting(target.frameId, 0)])
    }
    case 'try-again':
      return again(failed, [waiting(request.frameId, 0)])
    case 'resize': {
      const size = failed.input.sizes.find((s) => s.frameId === request.frameId)
      if (!size) throw new StartRefused(NOT_TRIED_AGAIN, 409)
      return again({ kind: 'resize', input: { ...failed.input, sizes: [size] } }, [waiting(size.frameId, 0)])
    }
    default:
      throw new StartRefused(NOT_TRIED_AGAIN, 409)
  }
}
