// The layering finish, run in one tab: a done layering job's lease, which a tab claims for 2 minutes and renews
// while it matches and places the layers, refused while another tab holds it; the finish's end, which makes the
// job's frames editable; and the job's split layers, which the tab downloads.
import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { readJob } from '@dazbee/ai'
import { aiFrames, aiJobs, type Db } from '@dazbee/db'
import { type AiFinishLease, FINISH_LEASE_SECONDS, layeringFiles, LayeringInput } from '@dazbee/schema'
import { originalKey, type Storage } from '@dazbee/storage'

/** Why the finish's lease or its end was refused. */
export type FinishRefusal = 'no-job' | 'not-done' | 'finished' | 'held'

/** A layering job of the brand: its id. */
interface Scope {
  workspace: string
  brand: string
  job: string
}

/**
 * Claims, or renews, the finish of the brand's layering job for `holder`: its lease until 2 minutes from now.
 * Refused for a job whose layers aren't made yet, one whose frames are all finished, and one another holder holds.
 */
export async function claimFinish(db: Db, scope: Scope, holder: string): Promise<AiFinishLease | FinishRefusal> {
  const found = await layeringJob(db, scope)
  if (found !== 'found') return found
  const [waiting] = await db
    .select({ frameId: aiFrames.frameId })
    .from(aiFrames)
    .where(and(eq(aiFrames.jobId, scope.job), eq(aiFrames.state, 'layering')))
    .limit(1)
  if (!waiting) return 'finished'
  const [claimed] = await db
    .update(aiJobs)
    .set({ finishHolder: holder, finishUntil: sql`now() + make_interval(secs => ${FINISH_LEASE_SECONDS})` })
    .where(and(eq(aiJobs.id, scope.job), free(holder)))
    .returning({ until: aiJobs.finishUntil })
  if (!claimed?.until) return 'held'
  return { holder, until: claimed.until.toISOString() }
}

/**
 * Ends the finish of the brand's layering job: its frames still being made editable become editable, but a frame
 * whose split failed holds its picture again; and the lease is let go. Ending it again changes nothing. Refused
 * while another holder holds the lease.
 */
export async function endFinish(db: Db, scope: Scope, holder: string): Promise<'ended' | FinishRefusal> {
  const found = await layeringJob(db, scope)
  if (found !== 'found') return found
  return db.transaction(async (tx) => {
    const [ended] = await tx
      .update(aiJobs)
      .set({ finishHolder: null, finishUntil: null })
      .where(and(eq(aiJobs.id, scope.job), free(holder)))
      .returning({ id: aiJobs.id })
    if (!ended) return 'held'
    const job = await readJob(tx, scope.workspace, scope.job)
    const frames = await tx
      .select({ designId: aiFrames.designId, frameId: aiFrames.frameId, callIndex: aiFrames.callIndex })
      .from(aiFrames)
      .where(and(eq(aiFrames.jobId, scope.job), eq(aiFrames.state, 'layering')))
    for (const frame of frames) {
      const split = job?.calls.find((c) => c.index === frame.callIndex)
      await tx
        .update(aiFrames)
        .set({ state: split?.state === 'done' ? 'editable' : 'arrived', updatedAt: new Date() })
        .where(and(eq(aiFrames.designId, frame.designId), eq(aiFrames.frameId, frame.frameId)))
    }
    return 'ended'
  })
}

/** Split layer `index` of the brand's done layering job (`layeringFiles`), as PNG bytes; null for none. */
export async function layeringFile(
  db: Db,
  storage: Storage,
  scope: Scope,
  index: number,
): Promise<Uint8Array | FinishRefusal | null> {
  const found = await layeringJob(db, scope)
  if (found !== 'found') return found
  const job = await readJob(db, scope.workspace, scope.job)
  const file = job && layeringFiles(job)[index]
  // A layer is a workspace original: a key elsewhere is never read.
  if (!file?.key.startsWith(originalKey(scope.workspace, ''))) return null
  return storage.get(file.key)
}

/** Whether the job is the brand's layering job, and done. */
async function layeringJob(db: Db, { workspace, brand, job }: Scope): Promise<'found' | 'no-job' | 'not-done'> {
  const [row] = await db
    .select({ kind: aiJobs.kind, input: aiJobs.input, state: aiJobs.state })
    .from(aiJobs)
    .where(and(eq(aiJobs.id, job), eq(aiJobs.workspaceId, workspace)))
  const input = row?.kind === 'layering' ? LayeringInput.safeParse(row.input) : null
  if (!input?.success || input.data.brandId !== brand) return 'no-job'
  return row?.state === 'done' ? 'found' : 'not-done'
}

/** A lease `holder` may take: no one holds it, it lapsed, or it is the holder's own. */
function free(holder: string) {
  return or(isNull(aiJobs.finishUntil), sql`${aiJobs.finishUntil} <= now()`, eq(aiJobs.finishHolder, holder))
}
