// A design's AI frames as its tabs read them: each frame with the job and call that fill it, the jobs with each
// call, and the briefs; a frame's refines; and a call marked written once a tab's arrival of it is confirmed, so it
// is written into the design once. A frame's stored state is read with its job: a waiting frame whose call failed,
// or whose job ended without its picture, is failed, and a frame whose layering job ended without its layers holds
// its picture again.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { readJobs } from '@dazbee/ai'
import { aiBriefs, aiFrames, aiJobs, aiRefines, assets, type Db, type Tx } from '@dazbee/db'
import {
  type AiBriefView,
  type AiCallView,
  type AiFrameState,
  type AiFrameView,
  type AiFrameWritten,
  type AiJobView,
  type AiRefineView,
  briefTitle,
  type DesignAi,
  RefineInput,
  RefinePlanAnswer,
} from '@dazbee/schema'
import { originalKey } from '@dazbee/storage'

/** How marking a call written came out. */
export type Written = 'written' | 'no-frame' | 'not-made' | 'not-its-call'

/** The call of a refine job that makes the new version, and the one whose answer sums it up. */
const REFINE_EDIT = 1
const REFINE_PLAN = 0

/** The design's AI frames, every job that fills or refines them with each call, and its briefs. */
export async function designAi(db: Db, workspace: string, brand: string, design: string): Promise<DesignAi> {
  const rows = await db.select().from(aiFrames).where(eq(aiFrames.designId, design))
  const refines = await db
    .select({
      id: aiRefines.id,
      frameId: aiRefines.frameId,
      jobId: aiRefines.jobId,
      resultAssetId: aiRefines.resultAssetId,
      input: aiJobs.input,
    })
    .from(aiRefines)
    .innerJoin(aiJobs, eq(aiJobs.id, aiRefines.jobId))
    .where(and(eq(aiRefines.designId, design), eq(aiJobs.workspaceId, workspace)))
    .orderBy(asc(aiRefines.createdAt), asc(aiRefines.id))
  const jobs = await readJobs(db, workspace, [...new Set([...rows, ...refines].map((r) => r.jobId))])
  const briefs = await db
    .select()
    .from(aiBriefs)
    .where(and(eq(aiBriefs.designId, design), eq(aiBriefs.workspaceId, workspace)))
    .orderBy(asc(aiBriefs.createdAt))
  const ids = await assetIds(
    db,
    workspace,
    brand,
    briefs.flatMap((b) => [...b.pictureKeys, ...(b.referenceKey ? [b.referenceKey] : [])]),
  )
  return {
    frames: rows.map((row) =>
      frameView(
        row,
        jobs.find((j) => j.id === row.jobId),
      ),
    ),
    jobs,
    briefs: briefs.map((b): AiBriefView => ({
      id: b.id,
      sectionId: b.sectionId,
      title: briefTitle(b.words),
      words: b.words,
      pictureAssetIds: b.pictureKeys.flatMap((key) => ids.get(key) ?? []),
      referenceAssetId: (b.referenceKey && ids.get(b.referenceKey)) || null,
      size: { width: b.width, height: b.height },
      mode: b.mode,
      planned: b.plan !== null,
      createdAt: b.createdAt.toISOString(),
    })),
    refines: refines.map(({ input, ...refine }) => ({
      ...refine,
      pictureLayerId: RefineInput.parse(input).frame.pictureLayerId,
    })),
  }
}

/** The design's AI frames `frames` as tabs read them, with their jobs; a frame the design hasn't is left out. */
export async function framesOf(
  db: Db | Tx,
  workspace: string,
  design: string,
  frames: string[],
): Promise<{ frames: AiFrameView[]; jobs: AiJobView[] }> {
  if (frames.length === 0) return { frames: [], jobs: [] }
  const rows = await db
    .select()
    .from(aiFrames)
    .where(and(eq(aiFrames.designId, design), inArray(aiFrames.frameId, frames)))
  const jobs = await readJobs(db, workspace, [...new Set(rows.map((r) => r.jobId))])
  return {
    frames: rows.map((row) =>
      frameView(
        row,
        jobs.find((j) => j.id === row.jobId),
      ),
    ),
    jobs,
  }
}

/**
 * Whether an AI frame is working, so no other AI action may start on it: waiting for its picture (made or not),
 * being made editable, or being refined.
 */
export async function frameBusy(db: Db | Tx, workspace: string, design: string, frame: AiFrameView): Promise<boolean> {
  if (frame.state === 'waiting' || frame.state === 'layering') return true
  const [refining] = await db
    .select({ id: aiRefines.id })
    .from(aiRefines)
    .innerJoin(aiJobs, eq(aiJobs.id, aiRefines.jobId))
    .where(
      and(
        eq(aiRefines.designId, design),
        eq(aiRefines.frameId, frame.frameId),
        eq(aiJobs.workspaceId, workspace),
        isNull(aiJobs.endedAt),
      ),
    )
    .limit(1)
  return Boolean(refining)
}

/** The frame's refines, oldest first, each with its job; empty for a frame with none. */
export async function frameRefines(
  db: Db,
  workspace: string,
  brand: string,
  design: string,
  frame: string,
): Promise<AiRefineView[]> {
  const rows = await db
    .select()
    .from(aiRefines)
    .where(and(eq(aiRefines.designId, design), eq(aiRefines.frameId, frame)))
    .orderBy(asc(aiRefines.createdAt), asc(aiRefines.id))
  const jobs = await readJobs(db, workspace, [...new Set(rows.map((r) => r.jobId))])
  const ids = await assetIds(
    db,
    workspace,
    brand,
    rows.flatMap((r) => (r.marksKey ? [r.marksKey] : [])),
  )
  return rows.flatMap((row): AiRefineView[] => {
    const job = jobs.find((j) => j.id === row.jobId)
    if (!job) return []
    return [
      {
        id: row.id,
        message: row.message,
        marksAssetId: (row.marksKey && ids.get(row.marksKey)) || null,
        summary: row.summary ?? refineSummary(job),
        resultAssetId: row.resultAssetId,
        job,
        createdAt: row.createdAt.toISOString(),
      },
    ]
  })
}

/**
 * Marks call `written.callIndex` of job `written.jobId` written into the design's frame: a frame's own call makes
 * the frame `arrived` with its picture; a refine of the frame keeps its version and summary, and the version becomes
 * the frame's picture. Marking it again changes nothing. Refuses a call not made yet, and a job that doesn't fill or
 * refine the frame.
 */
export async function markWritten(
  db: Db,
  workspace: string,
  design: string,
  frame: string,
  written: AiFrameWritten,
): Promise<Written> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiFrames)
      .where(and(eq(aiFrames.designId, design), eq(aiFrames.frameId, frame)))
      .for('update')
    if (!row) return 'no-frame'
    const [job] = await readJobs(tx, workspace, [written.jobId])
    if (row.jobId === written.jobId && row.callIndex === written.callIndex) {
      if (row.state !== 'waiting') return 'written'
      const asset = job && madePicture(job.calls, written.callIndex)
      if (!asset) return 'not-made'
      await tx
        .update(aiFrames)
        .set({ state: 'arrived', assetId: asset, updatedAt: new Date() })
        .where(and(eq(aiFrames.designId, design), eq(aiFrames.frameId, frame)))
      return 'written'
    }
    const [refine] = await tx
      .select()
      .from(aiRefines)
      .where(and(eq(aiRefines.designId, design), eq(aiRefines.frameId, frame), eq(aiRefines.jobId, written.jobId)))
    if (!refine || !job || written.callIndex !== REFINE_EDIT) return 'not-its-call'
    if (refine.resultAssetId) return 'written'
    const asset = madePicture(job.calls, REFINE_EDIT)
    if (!asset) return 'not-made'
    await tx
      .update(aiRefines)
      .set({ resultAssetId: asset, summary: refineSummary(job) })
      .where(eq(aiRefines.id, refine.id))
    await tx
      .update(aiFrames)
      .set({ assetId: asset, updatedAt: new Date() })
      .where(and(eq(aiFrames.designId, design), eq(aiFrames.frameId, frame)))
    return 'written'
  })
}

/** A frame as tabs read it, its stored state read with its job. */
function frameView(row: typeof aiFrames.$inferSelect, job: AiJobView | undefined): AiFrameView {
  return {
    frameId: row.frameId,
    briefId: row.briefId,
    jobId: row.jobId,
    callIndex: row.callIndex,
    kind: row.kind,
    state: frameState(row.state, row.callIndex, job),
    assetId: row.assetId,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * A frame's state read with its job: waiting turns failed once its call failed or its job ended without the
 * picture; layering turns back to arrived once the layering job ended without the frame's layers.
 */
function frameState(stored: AiFrameState, callIndex: number, job: AiJobView | undefined): AiFrameState {
  const call = job?.calls.find((c) => c.index === callIndex)
  const ended = !job || job.endedAt !== null
  if (stored === 'waiting' && (call?.state === 'failed' || (ended && call?.state !== 'done'))) return 'failed'
  if (stored === 'layering' && ended && call?.state !== 'done') return 'arrived'
  return stored
}

/** The asset of the first picture call `index` made, or null while it isn't made. */
function madePicture(calls: AiCallView[], index: number): string | null {
  const call = calls.find((c) => c.index === index)
  if (call?.state !== 'done' || call.output.kind !== 'pictures') return null
  return call.output.pictures[0]?.assetId ?? null
}

/** A refine's summary from its refine plan's answer, or null while it has none. */
function refineSummary(job: AiJobView): string | null {
  const plan = job.calls.find((c) => c.index === REFINE_PLAN)
  if (plan?.state !== 'done' || plan.output.kind !== 'text') return null
  const answer = RefinePlanAnswer.safeParse(plan.output.json)
  return answer.success ? answer.data.summary : null
}

/** The brand's asset of each workspace original among `keys`, by key. */
async function assetIds(db: Db, workspace: string, brand: string, keys: string[]): Promise<Map<string, string>> {
  const prefix = originalKey(workspace, '')
  const bySha = new Map(keys.filter((k) => k.startsWith(prefix)).map((k) => [k.slice(prefix.length), k]))
  if (bySha.size === 0) return new Map()
  const rows = await db
    .select({ id: assets.id, sha256: assets.sha256 })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspace), eq(assets.brandId, brand), inArray(assets.sha256, [...bySha.keys()])))
  return new Map(rows.flatMap((row) => (bySha.has(row.sha256) ? [[bySha.get(row.sha256) ?? '', row.id]] : [])))
}
