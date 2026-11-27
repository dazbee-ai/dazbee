// The AI flow's routes as a tab calls them: starting each job kind on a design, the design's AI frames with their
// jobs and briefs, a frame's refines, marking a call written into the design, the layering finish's lease, the
// estimate an AI action shows on hover, and the person's own running jobs. Pictures are named by asset id; the
// API turns them into the storage keys the jobs read.
import { z } from 'zod'

import { AiFeature, AiJobKind, AiJobRefusal, AiJobState, AiJobView, AiMode, MadePicture, MAX_REFERENCES } from './ai.ts'
import { AiFrameKind, AiFrameState, AiFrameTarget, AiSize, AiSizeTarget, ImageRatio, ImageWords } from './ai-flow.ts'
import { ApiError } from './api.ts'
import { AssetId, Id } from './primitives.ts'

/** How long a tab holds the layering finish's lease unless it renews it: 2 minutes. */
export const FINISH_LEASE_SECONDS = 120

/** What every job a tab starts names: the design it fills. */
const OnDesign = z.object({ designId: Id })

/** A brief's reference ad: a picture of the brand's, or one of its designs, whose cover the API draws. */
export const BriefReference = z.union([z.object({ assetId: AssetId }), z.object({ designId: Id })])
export type BriefReference = z.infer<typeof BriefReference>

/** What a brief is: its section and four frames, its words, pictures, one size and a mode. */
const BriefFields = {
  sectionId: Id,
  frames: z.array(AiFrameTarget).length(4),
  words: z.string().trim().min(1).max(4000),
  pictures: z.array(AssetId).max(MAX_REFERENCES),
  size: AiSize,
  mode: AiMode,
}

/** Starts a round from a brief, with an optional reference ad. */
export const StartRound = OnDesign.extend({
  kind: z.literal('round'),
  ...BriefFields,
  reference: BriefReference.optional(),
})
export type StartRound = z.infer<typeof StartRound>

/** Starts more like this: a round of a brief whose planner sees the liked draft's picture first. */
export const StartMoreLikeThis = OnDesign.extend({
  kind: z.literal('more-like-this'),
  ...BriefFields,
  likedAssetId: AssetId,
})
export type StartMoreLikeThis = z.infer<typeof StartMoreLikeThis>

/**
 * Tries a failed AI frame again: one draft from its brief's stored plan, the whole round when its plan failed, or
 * one size of a resize.
 */
export const StartTryAgain = OnDesign.extend({ kind: z.literal('try-again'), frameId: Id })
export type StartTryAgain = z.infer<typeof StartTryAgain>

/** Refines an AI frame's picture, or a picture layer of an editable one, with a message and optional marks. */
export const StartRefine = OnDesign.extend({
  kind: z.literal('refine'),
  frameId: Id,
  pictureLayerId: Id,
  pictureAssetId: AssetId,
  message: z.string().trim().min(1).max(4000),
  marksAssetId: AssetId.optional(),
  size: AiSize,
})
export type StartRefine = z.infer<typeof StartRefine>

/** Redraws an AI frame's picture at each size picked, each into a new frame of a new section. */
export const StartResize = OnDesign.extend({
  kind: z.literal('resize'),
  frameId: Id,
  pictureAssetId: AssetId,
  sectionId: Id,
  sizes: z.array(AiSizeTarget).min(1).max(20),
})
export type StartResize = z.infer<typeof StartResize>

/** Makes AI frames editable: each frame's picture split into layers, from one layer plan. */
export const StartLayering = OnDesign.extend({
  kind: z.literal('layering'),
  frames: z
    .array(z.object({ frameId: Id, pictureAssetId: AssetId }))
    .min(1)
    .max(20),
  planAssetId: AssetId.optional(),
})
export type StartLayering = z.infer<typeof StartLayering>

/** Makes an image for the brand from the person's words, at a ratio; it is on no design. */
export const StartImage = z.object({ kind: z.literal('image'), words: ImageWords, ratio: ImageRatio })
export type StartImage = z.infer<typeof StartImage>

/** A job a tab starts, of any AI feature. */
export const StartAiJob = z.discriminatedUnion('kind', [
  StartRound,
  StartMoreLikeThis,
  StartTryAgain,
  StartRefine,
  StartResize,
  StartLayering,
  StartImage,
])
export type StartAiJob = z.infer<typeof StartAiJob>

/** A started job: its id, and the brief it wrote, for a round or more like this. */
export const AiJobStarted = z.object({ job: Id, briefId: Id.nullable() })
export type AiJobStarted = z.infer<typeof AiJobStarted>

/** A job refused before anything was held or written, with why. */
export const AiJobRefused = ApiError.extend({ refusal: AiJobRefusal })
export type AiJobRefused = z.infer<typeof AiJobRefused>

/**
 * An AI frame as a tab reads it: its brief, the job and call that fill it now, what it holds, its state and its
 * current picture. A frame whose call failed, or whose job ended without its picture, reads as failed.
 */
export const AiFrameView = z.object({
  frameId: Id,
  briefId: Id.nullable(),
  jobId: Id,
  callIndex: z.number().int().nonnegative(),
  kind: AiFrameKind,
  state: AiFrameState,
  assetId: AssetId.nullable(),
  updatedAt: z.iso.datetime(),
})
export type AiFrameView = z.infer<typeof AiFrameView>

/** A brief as a tab reads it: its section, title and words, its pictures and reference, size, mode and whether it was planned. */
export const AiBriefView = z.object({
  id: Id,
  sectionId: Id,
  title: z.string(),
  words: z.string(),
  pictureAssetIds: z.array(AssetId),
  referenceAssetId: AssetId.nullable(),
  size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  mode: AiMode,
  planned: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type AiBriefView = z.infer<typeof AiBriefView>

/**
 * Each call's index in a layering job, for frame `n` (from 0): its layer plan, its split and its reading. The first
 * frame's plan is call 0, and the splits and readings of up to 20 frames are calls 1 to 40, so the other frames'
 * plans come after them, at 40 + `n`.
 */
export const LAYERING_CALL = {
  plan: (n: number) => (n === 0 ? 0 : 40 + n),
  split: (n: number) => 1 + 2 * n,
  read: (n: number) => 2 + 2 * n,
} as const

/** Each call's index in a refine: the refine plan, then the edit that makes its new version. */
export const REFINE_CALL = { plan: 0, edit: 1 } as const

/** The picture call `index` of job `jobId` made, among `jobs` as read; null before it is made, or for no such call. */
export function madeCallPicture(jobs: readonly AiJobView[], jobId: string, index: number): string | null {
  const call = jobs.find((j) => j.id === jobId)?.calls.find((c) => c.index === index)
  return call?.state === 'done' && call.output.kind === 'pictures' ? (call.output.pictures[0]?.assetId ?? null) : null
}

/** Whether a job is still on its way: waiting or running. */
export function jobRunning(job: Pick<AiJobView, 'state'> | undefined): boolean {
  return job?.state === 'waiting' || job?.state === 'running'
}

/**
 * A refine of one of the design's AI frames, as every tab reads it to write its new version once: the frame and the
 * picture layer it changes, its job, and the version once a tab's arrival of it is marked; null before.
 */
export const AiRefineLink = z.object({
  id: Id,
  frameId: Id,
  pictureLayerId: Id,
  jobId: Id,
  resultAssetId: AssetId.nullable(),
})
export type AiRefineLink = z.infer<typeof AiRefineLink>

/** A design's AI frames, the jobs that fill them or refine them, with each call, its briefs and its refines. */
export const DesignAi = z.object({
  frames: z.array(AiFrameView),
  jobs: z.array(AiJobView),
  briefs: z.array(AiBriefView),
  refines: z.array(AiRefineLink).default([]),
})
export type DesignAi = z.infer<typeof DesignAi>

/** One refine of a frame: the message, the marks, the summary of the change, the version it made and its job. */
export const AiRefineView = z.object({
  id: Id,
  message: z.string(),
  marksAssetId: AssetId.nullable(),
  summary: z.string().nullable(),
  resultAssetId: AssetId.nullable(),
  job: AiJobView,
  createdAt: z.iso.datetime(),
})
export type AiRefineView = z.infer<typeof AiRefineView>

/** The call a tab wrote into an AI frame, once its arrival is confirmed. */
export const AiFrameWritten = z.object({ jobId: Id, callIndex: z.number().int().nonnegative() })
export type AiFrameWritten = z.infer<typeof AiFrameWritten>

/** The tab that claims, renews or ends a layering finish: an id it made for itself. */
export const AiFinishHolder = z.object({ holder: z.string().regex(/^[\w-]{8,64}$/) })
export type AiFinishHolder = z.infer<typeof AiFinishHolder>

/** A layering finish's lease: its holder, and until when it holds it unless renewed. */
export const AiFinishLease = AiFinishHolder.extend({ until: z.iso.datetime() })
export type AiFinishLease = z.infer<typeof AiFinishLease>

/**
 * What the estimate is asked about: the action, its mode, the sizes it makes or reads, and whether the brief has a
 * reference ad. `pictures` is taken and not read.
 */
export const AiEstimateQuery = z.object({
  action: AiFeature,
  mode: AiMode.default('fast'),
  sizes: z
    .array(AiSize)
    .min(1)
    .max(20)
    .default([{ width: 1080, height: 1080 }]),
  pictures: z.coerce.number().int().min(0).max(MAX_REFERENCES).default(0),
  reference: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
})
export type AiEstimateQuery = z.infer<typeof AiEstimateQuery>

/**
 * How much of the workspace's AI an action takes and about how long: its hold as a share of the allowance of its
 * live grants, in whole percents or "under-1", null with no live allowance; and its seconds.
 */
export const AiEstimate = z.object({
  share: z.union([z.number().int().positive(), z.literal('under-1')]).nullable(),
  seconds: z.number().int().nonnegative(),
})
export type AiEstimate = z.infer<typeof AiEstimate>

/**
 * A design of the brand with AI work on it: running (a job of it not ended), or its layers almost done (a layering
 * job whose server part ended, waiting for a tab to finish it).
 */
export const DesignWorking = z.object({ designId: Id, work: z.enum(['running', 'finishing']) })
export type DesignWorking = z.infer<typeof DesignWorking>

/**
 * One of the person's AI feature jobs, running or just ended, with how many calls made or failed: the design it
 * fills, or for a job on no design nulls; and for an image job its words, its ratio and, once made, its image.
 */
export const MyAiJob = z.object({
  id: Id,
  kind: AiJobKind,
  state: AiJobState,
  workspaceId: Id,
  brandId: Id,
  designId: Id.nullable(),
  designName: z.string().nullable(),
  image: z.object({ words: ImageWords, ratio: ImageRatio, assetId: AssetId.nullable() }).nullable(),
  made: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
})
export type MyAiJob = z.infer<typeof MyAiJob>

/**
 * A done layering job's split layers, as `GET …/ai/jobs/:id/files/:index` numbers them: each split call's layers in
 * the order of its call index, then in the split's order.
 */
export function layeringFiles(job: Pick<AiJobView, 'calls'>): MadePicture[] {
  return [...job.calls]
    .sort((a, b) => a.index - b.index)
    .flatMap((call) => (call.state === 'done' && call.output.kind === 'layers' ? call.output.layers : []))
}

/** The sizes the estimate is asked about, from `1080x1080,1080x1920`; null for a list it can't read. */
export function readSizes(text: string): { width: number; height: number }[] | null {
  const sizes = text.split(',').map((part) => /^(\d{1,5})x(\d{1,5})$/.exec(part.trim()))
  if (sizes.some((match) => !match)) return null
  return sizes.map((match) => ({ width: Number(match?.[1]), height: Number(match?.[2]) }))
}
