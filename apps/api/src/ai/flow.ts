// Starting the flow's jobs on a design: each request becomes its job kind's input, with the brand's pictures as the
// workspace originals the job reads, the brand kit's picks as the brand's facts and its logo as a picture, and a
// design given as the reference drawn to a picture of its cover. The job, its hold, its pg-boss job and the brief,
// AI frame and refine rows it fills are saved in one transaction, so a refused job writes nothing.
import { createHash } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'

import { LAYERING_CALL, layerSize, pictureAssets, ROUND_CALL, saveJob } from '@dazbee/ai'
import { aiBriefs, aiFrames, aiJobs, aiRefines, assets, type Db, newId, type Tx } from '@dazbee/db'
import {
  AI_PART_TAG,
  type AiFrameView,
  type AiJobRefusal,
  type BrandFacts,
  type BrandSummary,
  type BriefReference,
  type FlowJobInput,
  parseFlowJob,
  type RoundInput,
  type StartAiJob,
  type StartMoreLikeThis,
  type StartRound,
  type StartTryAgain,
} from '@dazbee/schema'
import { originalKey, type Storage } from '@dazbee/storage'

import { getBrandKit } from '../brand-kits/brand-kits.ts'
import { coverOf, drawCover } from '../drawing/design-thumbnails.ts'
import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import { brandResourcesFor } from '../drawing/render.ts'
import { findDesign, storedDesign } from '../workspace/designs.ts'
import { frameBusy, framesOf } from './ai-frames.ts'

/** Who starts a job: in which workspace and brand, as which person. */
export interface Starter {
  workspace: string
  brand: BrandSummary
  member: string
}

/** A started job, with the brief it wrote; or why saving it was refused, with nothing written. */
export type Started = { ok: true; job: string; briefId: string | null } | { ok: false; refusal: AiJobRefusal }

/** A request the API refuses before anything is held: its answer's status and message. */
export class StartRefused extends Error {
  readonly status: 400 | 404 | 409

  constructor(message: string, status: 400 | 404 | 409) {
    super(message)
    this.name = 'StartRefused'
    this.status = status
  }
}

/** The longest side of a design drawn as a brief's reference. */
const REFERENCE_SIZE = 1024

/** The kinds of picture a model reads. */
const READABLE = ['image/png', 'image/jpeg', 'image/webp']

/** A picture drawn for the job, stored and recorded as an asset in its transaction. */
interface Drawn {
  key: string
  bytes: Uint8Array
  name: string
}

/** What a job saves beside itself, in its transaction, once it is held. */
type Rows = (tx: Tx, job: string) => Promise<void>

/** A job to save, worked out in its transaction, and the rows it saves beside itself once it is held. */
type Plan = (tx: Tx) => Promise<{ flow: FlowJobInput; rows: (job: string) => Promise<void> }>

/** The AI frames a job acts on, locked in its transaction, and the check they pass there before it is saved. */
interface Guard {
  design: string
  frames: string[]
  check: (tx: Tx) => Promise<unknown>
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
 * Starts `request` for `starter`. Throws `StartRefused` for a design, frame or picture the brand hasn't, a frame
 * that is already an AI frame or is working, and a try-again of a frame that didn't fail.
 */
export async function startFlowJob(
  { db, storage, boss }: { db: Db; storage: Storage; boss: PgBoss },
  starter: Starter,
  request: StartAiJob,
): Promise<Started> {
  const { workspace, brand } = starter
  if (!(await findDesign(db, workspace, brand.id, request.designId))) throw new StartRefused('No such design', 404)
  const on = { brandId: brand.id, designId: request.designId }
  const keys = (ids: string[]) => pictureKeys(db, workspace, brand.id, ids)
  switch (request.kind) {
    case 'round':
    case 'more-like-this': {
      const { input, drawn } = await roundInput({ db, storage }, starter, request)
      const flow: FlowJobInput =
        request.kind === 'round'
          ? { kind: 'round', input }
          : { kind: 'more-like-this', input: { ...input, likedKey: (await keys([request.likedAssetId]))[0] ?? '' } }
      const started = await saveFlow(
        db,
        boss,
        starter,
        withRows(flow, async (tx, job) => {
          await refuseTaken(
            tx,
            request.designId,
            request.frames.map((f) => f.frameId),
          )
          if (drawn)
            await pictureAssets({ workspace, brand: brand.id, name: drawn.name }).record(tx, drawn, AI_PART_TAG)
          await tx.insert(aiBriefs).values({
            id: input.briefId,
            workspaceId: workspace,
            brandId: brand.id,
            designId: request.designId,
            sectionId: input.sectionId,
            words: input.words,
            pictureKeys: input.pictures,
            referenceKey: input.referenceKey ?? null,
            logoKey: input.logoKey ?? null,
            likedKey: flow.kind === 'more-like-this' ? flow.input.likedKey : null,
            width: input.size.width,
            height: input.size.height,
            mode: input.mode,
            createdBy: starter.member,
          })
          await tx.insert(aiFrames).values(
            input.frames.map((frame, n) => ({
              designId: request.designId,
              frameId: frame.frameId,
              briefId: input.briefId,
              jobId: job,
              callIndex: ROUND_CALL.draft(n),
              kind: 'draft' as const,
            })),
          )
        }),
      )
      return started.ok ? { ...started, briefId: input.briefId } : started
    }
    case 'try-again':
      return tryAgain(db, boss, starter, request)
    case 'refine': {
      const frame = await idleFrame(db, workspace, request.designId, request.frameId)
      const [pictureKey = '', marksKey] = await keys([
        request.pictureAssetId,
        ...(request.marksAssetId ? [request.marksAssetId] : []),
      ])
      const input = {
        ...on,
        ...(frame.briefId ? { briefId: frame.briefId } : {}),
        frame: { frameId: request.frameId, pictureLayerId: request.pictureLayerId },
        pictureKey,
        message: request.message,
        ...(marksKey ? { marksKey } : {}),
        size: request.size,
      }
      return saveFlow(
        db,
        boss,
        starter,
        withRows({ kind: 'refine', input }, async (tx, job) => {
          await tx.insert(aiRefines).values({
            id: newId(),
            designId: request.designId,
            frameId: request.frameId,
            message: request.message,
            marksKey: marksKey ?? null,
            jobId: job,
          })
        }),
        idle(workspace, request.designId, [request.frameId]),
      )
    }
    case 'resize': {
      const frame = await idleFrame(db, workspace, request.designId, request.frameId)
      const [pictureKey = ''] = await keys([request.pictureAssetId])
      const input = {
        ...on,
        ...(frame.briefId ? { briefId: frame.briefId } : {}),
        sectionId: request.sectionId,
        pictureKey,
        sizes: request.sizes,
      }
      return saveFlow(
        db,
        boss,
        starter,
        withRows({ kind: 'resize', input }, async (tx, job) => {
          await refuseTaken(
            tx,
            request.designId,
            request.sizes.map((s) => s.frameId),
          )
          await tx.insert(aiFrames).values(
            request.sizes.map((size, n) => ({
              designId: request.designId,
              frameId: size.frameId,
              briefId: frame.briefId,
              jobId: job,
              callIndex: n,
              kind: 'size' as const,
            })),
          )
        }),
        idle(workspace, request.designId, [request.frameId]),
      )
    }
    case 'layering': {
      const frameIds = request.frames.map((f) => f.frameId)
      if (new Set(frameIds).size !== frameIds.length) throw new StartRefused('Name each frame once', 400)
      let briefId: string | null = null
      for (const { frameId } of request.frames) {
        briefId ??= (await idleFrame(db, workspace, request.designId, frameId)).briefId
      }
      const pictures = await keys(request.frames.map((f) => f.pictureAssetId))
      const [planKey] = request.planAssetId ? await keys([request.planAssetId]) : []
      return saveFlow(
        db,
        boss,
        starter,
        async (tx) => {
          const input = {
            ...on,
            ...(briefId ? { briefId } : {}),
            frames: request.frames.map((f, n) => ({ frameId: f.frameId, pictureKey: pictures[n] ?? '' })),
            ...(planKey ? { planKey } : {}),
            size: await layerSize(tx, workspace),
          }
          return {
            flow: { kind: 'layering', input },
            rows: async (job) => {
              for (const [n, frameId] of frameIds.entries()) {
                await tx
                  .update(aiFrames)
                  .set({ jobId: job, callIndex: LAYERING_CALL.split(n), state: 'layering', updatedAt: new Date() })
                  .where(and(eq(aiFrames.designId, request.designId), eq(aiFrames.frameId, frameId)))
              }
            },
          }
        },
        idle(workspace, request.designId, frameIds),
      )
    }
  }
}

/**
 * Tries a failed frame again: a draft from its brief's stored plan; the whole round, into the same frames, when its
 * round's plan failed; or a resize's one size.
 */
async function tryAgain(db: Db, boss: PgBoss, starter: Starter, request: StartTryAgain): Promise<Started> {
  const { workspace } = starter
  const frame = await aiFrame(db, workspace, request.designId, request.frameId)
  if (frame.state !== 'failed') throw new StartRefused('Only a frame that didn’t come out can be tried again', 409)
  const [row] = await db
    .select({ kind: aiJobs.kind, input: aiJobs.input, state: aiJobs.state })
    .from(aiJobs)
    .where(and(eq(aiJobs.id, frame.jobId), eq(aiJobs.workspaceId, workspace)))
  if (!row || row.kind === 'ai-steps') throw new StartRefused('This frame can’t be tried again', 409)
  const failed = parseFlowJob(row.kind, row.input)
  // Every frame the job fills is locked, and must still have failed in the failed job.
  const save = (plan: Plan, frames = [request.frameId]) =>
    saveFlow(db, boss, starter, plan, {
      design: request.designId,
      frames,
      check: async (tx) => {
        for (const id of frames) {
          const now = await aiFrame(tx, workspace, request.designId, id)
          if (now.state !== 'failed' || now.jobId !== frame.jobId) throw new StartRefused('That frame is working', 409)
        }
      },
    })
  const moveFrames = (frames: { frameId: string; callIndex: number }[]) => async (tx: Tx, job: string) => {
    for (const { frameId, callIndex } of frames) {
      await tx
        .update(aiFrames)
        .set({ jobId: job, callIndex, state: 'waiting', updatedAt: new Date() })
        .where(and(eq(aiFrames.designId, request.designId), eq(aiFrames.frameId, frameId)))
    }
  }
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
        const frames = input.frames.map((f, n) => ({ frameId: f.frameId, callIndex: ROUND_CALL.draft(n) }))
        return save(
          withRows(failed, moveFrames(frames)),
          frames.map((f) => f.frameId),
        )
      }
      const draft = frame.callIndex - ROUND_CALL.draft(0)
      const target = input.frames[draft]
      if (!target) throw new StartRefused('This frame can’t be tried again', 409)
      const again = { brandId: input.brandId, designId: input.designId, briefId: input.briefId, draft, frame: target }
      return save(withRows({ kind: 'try-again', input: again }, moveFrames([{ ...target, callIndex: 0 }])))
    }
    case 'try-again':
      return save(withRows(failed, moveFrames([{ frameId: request.frameId, callIndex: 0 }])))
    case 'resize': {
      const size = failed.input.sizes.find((s) => s.frameId === request.frameId)
      if (!size) throw new StartRefused('This frame can’t be tried again', 409)
      const input = { ...failed.input, sizes: [size] }
      return save(withRows({ kind: 'resize', input }, moveFrames([{ frameId: size.frameId, callIndex: 0 }])))
    }
    default:
      throw new StartRefused('This frame can’t be tried again', 409)
  }
}

/**
 * Saves the job `plan` gives, with its hold and its pg-boss job, then its rows, in one transaction, in which `plan`
 * runs first, after `guard`'s frames are locked and its check passed again, so two requests at once never both act
 * on one frame. A refused save writes nothing.
 */
async function saveFlow(db: Db, boss: PgBoss, starter: Starter, plan: Plan, guard?: Guard): Promise<Started> {
  try {
    return await db.transaction(async (tx) => {
      if (guard) {
        await tx
          .select({ frameId: aiFrames.frameId })
          .from(aiFrames)
          .where(and(eq(aiFrames.designId, guard.design), inArray(aiFrames.frameId, guard.frames)))
          .for('update')
        await guard.check(tx)
      }
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
function withRows(flow: FlowJobInput, rows: Rows): Plan {
  return async (tx) => ({ flow, rows: (job) => rows(tx, job) })
}

/** A round's input from the request, the brief's pictures and reference as keys, and the reference drawn if a design. */
async function roundInput(
  { db, storage }: { db: Db; storage: Storage },
  { workspace, brand }: Starter,
  request: StartRound | StartMoreLikeThis,
): Promise<{ input: RoundInput; drawn: Drawn | null }> {
  const pictures = await pictureKeys(db, workspace, brand.id, request.pictures)
  const kit = await getBrandKit(db, workspace, brand.id)
  const facts: BrandFacts = {
    name: brand.name,
    colors: kit.colors.map((c) => `${c.name} ${c.value}`),
    fonts: kit.fonts.map((f) => `${f.name}: ${f.family}`),
    voice: kit.voice,
  }
  const [logoKey] = kit.logoAssetId ? await pictureKeys(db, workspace, brand.id, [kit.logoAssetId], false) : []
  const reference = request.kind === 'round' && request.reference ? request.reference : null
  const drawn =
    reference && 'designId' in reference ? await drawReference(db, storage, workspace, brand, reference) : null
  const [referenceKey] =
    reference && 'assetId' in reference ? await pictureKeys(db, workspace, brand.id, [reference.assetId]) : []
  const input: RoundInput = {
    brandId: brand.id,
    designId: request.designId,
    briefId: newId(),
    sectionId: request.sectionId,
    frames: request.frames,
    words: request.words,
    pictures,
    size: request.size,
    mode: request.mode,
    brand: facts,
    ...(logoKey ? { logoKey } : {}),
    ...((drawn?.key ?? referenceKey) ? { referenceKey: drawn?.key ?? referenceKey } : {}),
  }
  return { input, drawn }
}

/** The brand's design `reference.designId` drawn as a picture of its cover, stored as a workspace original. */
async function drawReference(
  db: Db,
  storage: Storage,
  workspace: string,
  brand: BrandSummary,
  reference: Extract<BriefReference, { designId: string }>,
): Promise<Drawn> {
  const found = await findDesign(db, workspace, brand.id, reference.designId)
  const design = found && (await storedDesign(db, found.id))
  const cover = design && coverOf(design)
  if (!found || !design || !cover) throw new StartRefused('The reference design has nothing to show', 400)
  const bytes = await inDrawingTurn(async () =>
    drawCover(design, cover, REFERENCE_SIZE, await brandResourcesFor(db, storage, workspace, brand.id, design)),
  )
  const key = originalKey(workspace, createHash('sha256').update(bytes).digest('hex'))
  await storage.put(key, bytes, 'image/png')
  return { key, bytes, name: found.name }
}

/**
 * The workspace originals of the brand's assets `ids`, in order. Refuses an id the brand has no asset of, or one a
 * model can't read (an SVG file); with `strict` off such an asset is left out instead.
 */
async function pictureKeys(db: Db, workspace: string, brand: string, ids: string[], strict = true): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: assets.id, sha256: assets.sha256, contentType: assets.contentType })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspace), eq(assets.brandId, brand), inArray(assets.id, ids)))
  return ids.flatMap((id) => {
    const row = rows.find((r) => r.id === id)
    if (row && READABLE.includes(row.contentType)) return [originalKey(workspace, row.sha256)]
    if (strict) throw new StartRefused('Pick PNG, JPEG or WebP pictures from the brand’s images', 400)
    return []
  })
}

/** The design's AI frame `frame` as tabs read it; refuses a frame that isn't one. */
async function aiFrame(db: Db | Tx, workspace: string, design: string, frame: string): Promise<AiFrameView> {
  const [found] = (await framesOf(db, workspace, design, [frame])).frames
  if (!found) throw new StartRefused('That frame isn’t an AI frame of this design', 404)
  return found
}

/** The design's AI frame `frame`; refuses one that isn't, or is working. */
async function idleFrame(db: Db | Tx, workspace: string, design: string, frame: string): Promise<AiFrameView> {
  const found = await aiFrame(db, workspace, design, frame)
  if (await frameBusy(db, workspace, design, found)) throw new StartRefused('That frame is working', 409)
  return found
}

/** A guard on the design's AI frames `frames`: each still idle once locked. */
function idle(workspace: string, design: string, frames: string[]): Guard {
  return {
    design,
    frames,
    check: async (tx) => {
      for (const frame of frames) await idleFrame(tx, workspace, design, frame)
    },
  }
}

/** Refuses frames of the design that are AI frames already. */
async function refuseTaken(tx: Tx, design: string, frames: string[]): Promise<void> {
  if (new Set(frames).size !== frames.length) throw new StartRefused('Name each frame once', 400)
  const [taken] = await tx
    .select({ frameId: aiFrames.frameId })
    .from(aiFrames)
    .where(and(eq(aiFrames.designId, design), inArray(aiFrames.frameId, frames)))
    .limit(1)
  if (taken) throw new StartRefused('Those frames are AI frames already', 409)
}
