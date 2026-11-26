// Starting the flow's jobs on a design: each request becomes its job kind's input, with the brand's pictures as the
// workspace originals the job reads, the brand kit's picks as the brand's facts and its logo as a picture, and a
// design given as the reference drawn to a picture of its cover. Each is saved with the brief, AI frame and refine
// rows it fills (`saveFlow`), so a refused job writes nothing.
import { createHash } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'

import { LAYERING_CALL, layerSize, pictureAssets, ROUND_CALL } from '@dazbee/ai'
import { aiBriefs, aiFrames, aiRefines, assets, type Db, newId } from '@dazbee/db'
import {
  AI_PART_TAG,
  type AiFeatureInput,
  type BrandFacts,
  type BrandSummary,
  type BriefReference,
  type RoundInput,
  type StartAiJob,
  type StartMoreLikeThis,
  type StartRound,
} from '@dazbee/schema'
import { originalKey, type Storage } from '@dazbee/storage'

import { getBrandKit } from '../brand-kits/brand-kits.ts'
import { coverOf, drawCover } from '../drawing/design-thumbnails.ts'
import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import { brandResourcesFor } from '../drawing/render.ts'
import { findDesign, storedDesign } from '../workspace/designs.ts'
import {
  idleFrames,
  pointFrames,
  refuseTaken,
  saveFlow,
  type Started,
  type Starter,
  StartRefused,
  withRows,
} from './start-job.ts'
import { tryAgain } from './try-again.ts'

/** A picture drawn for the job, stored and recorded as an asset once the job is held. */
interface Drawn {
  key: string
  bytes: Uint8Array
  name: string
}

/** The longest side of a design drawn as a brief's reference. */
const REFERENCE_SIZE = 1024

/** The kinds of picture a model reads. */
const READABLE = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Starts `request` for `starter`, its pg-boss job sent to `queue`. Throws `StartRefused` for a design, frame or
 * picture the brand hasn't, a frame that is already an AI frame or is working, and a try-again of a frame that
 * didn't fail.
 */
export async function startFlowJob(
  { db, storage, boss, queue }: { db: Db; storage: Storage; boss: PgBoss; queue: string },
  starter: Starter,
  request: StartAiJob,
): Promise<Started> {
  const { workspace, brand } = starter
  const design = request.designId
  if (!(await findDesign(db, workspace, brand.id, design))) throw new StartRefused('No such design', 404)
  const on = { brandId: brand.id, designId: design }
  const keys = (ids: string[]) => pictureKeys(db, workspace, brand.id, ids)
  const deps = { db, boss, queue, starter }
  switch (request.kind) {
    case 'round':
    case 'more-like-this': {
      const { input, drawn } = await roundInput({ db, storage }, starter, request)
      const liked = request.kind === 'more-like-this' ? (await keys([request.likedAssetId]))[0] : undefined
      const flow: AiFeatureInput = liked
        ? { kind: 'more-like-this', input: { ...input, likedKey: liked } }
        : { kind: 'round', input }
      const frames = request.frames.map((f) => f.frameId)
      const started = await saveFlow(
        deps,
        design,
        withRows(flow, async (tx, job) => {
          if (drawn) {
            await storage.put(drawn.key, drawn.bytes, 'image/png')
            await pictureAssets({ workspace, brand: brand.id, name: drawn.name }).record(tx, drawn, AI_PART_TAG)
          }
          await tx.insert(aiBriefs).values({
            id: input.briefId,
            workspaceId: workspace,
            brandId: brand.id,
            designId: design,
            sectionId: input.sectionId,
            words: input.words,
            pictureKeys: input.pictures,
            referenceKey: input.referenceKey ?? null,
            logoKey: input.logoKey ?? null,
            likedKey: liked ?? null,
            width: input.size.width,
            height: input.size.height,
            mode: input.mode,
            createdBy: starter.member,
          })
          await tx.insert(aiFrames).values(
            input.frames.map((frame, n) => ({
              designId: design,
              frameId: frame.frameId,
              briefId: input.briefId,
              jobId: job,
              callIndex: ROUND_CALL.draft(n),
              kind: 'draft' as const,
            })),
          )
        }),
        (tx) => refuseTaken(tx, design, frames),
      )
      return started.ok ? { ...started, briefId: input.briefId } : started
    }
    case 'try-again':
      return tryAgain({ db, boss, queue }, starter, request)
    case 'refine': {
      const [frame] = await idleFrames(db, workspace, design, [request.frameId])
      const [pictureKey, marksKey] = await keys([
        request.pictureAssetId,
        ...(request.marksAssetId ? [request.marksAssetId] : []),
      ])
      if (!frame || !pictureKey) throw new StartRefused('No such picture', 400)
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
        deps,
        design,
        withRows({ kind: 'refine', input }, async (tx, job) => {
          await tx.insert(aiRefines).values({
            id: newId(),
            designId: design,
            frameId: request.frameId,
            message: request.message,
            marksKey: marksKey ?? null,
            jobId: job,
          })
        }),
        (tx) => idleFrames(tx, workspace, design, [request.frameId]),
      )
    }
    case 'resize': {
      const [frame] = await idleFrames(db, workspace, design, [request.frameId])
      const [pictureKey] = await keys([request.pictureAssetId])
      if (!frame || !pictureKey) throw new StartRefused('No such picture', 400)
      const input = {
        ...on,
        ...(frame.briefId ? { briefId: frame.briefId } : {}),
        sectionId: request.sectionId,
        pictureKey,
        sizes: request.sizes,
      }
      const sizes = request.sizes.map((s) => s.frameId)
      return saveFlow(
        deps,
        design,
        withRows({ kind: 'resize', input }, async (tx, job) => {
          await tx.insert(aiFrames).values(
            request.sizes.map((size, n) => ({
              designId: design,
              frameId: size.frameId,
              briefId: frame.briefId,
              jobId: job,
              callIndex: n,
              kind: 'size' as const,
            })),
          )
        }),
        async (tx) => {
          await idleFrames(tx, workspace, design, [request.frameId])
          await refuseTaken(tx, design, sizes)
        },
      )
    }
    case 'layering': {
      const frameIds = request.frames.map((f) => f.frameId)
      const briefId = (await idleFrames(db, workspace, design, frameIds)).find((f) => f.briefId)?.briefId
      const pictures = await keys(request.frames.map((f) => f.pictureAssetId))
      const [planKey] = request.planAssetId ? await keys([request.planAssetId]) : []
      const frames = request.frames.map((f, n) => ({ frameId: f.frameId, pictureKey: pictures[n] ?? '' }))
      const layering = frameIds.map((frameId, n) => ({
        frameId,
        callIndex: LAYERING_CALL.split(n),
        state: 'layering' as const,
      }))
      return saveFlow(
        deps,
        design,
        async (tx) => {
          const input = {
            ...on,
            ...(briefId ? { briefId } : {}),
            frames,
            ...(planKey ? { planKey } : {}),
            size: await layerSize(tx, workspace),
          }
          return { flow: { kind: 'layering', input }, rows: (job) => pointFrames(design, layering)(tx, job) }
        },
        (tx) => idleFrames(tx, workspace, design, frameIds),
      )
    }
  }
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
  const [referenceKey = drawn?.key] =
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
    ...(referenceKey ? { referenceKey } : {}),
  }
  return { input, drawn }
}

/** The brand's design `reference.designId` drawn as a picture of its cover, and the original key it is stored at. */
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
  return { key: originalKey(workspace, createHash('sha256').update(bytes).digest('hex')), bytes, name: found.name }
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
