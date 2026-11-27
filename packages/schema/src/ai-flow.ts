// The AI flow's contracts: what each flow job kind is given, the sizes the AI is offered, and the answers its
// text calls are asked for. The answers follow the answer formats the ad prompts ask for, field names
// included, since the model reads them there (packages/ai/src/prompts/ads).
import { z } from 'zod'

import { type AiFeature, AiMode, LayerSplitSize, MAX_REFERENCES, PictureKey } from './ai.ts'
import type { SolidPaint } from './paint.ts'
import { Id } from './primitives.ts'

/** The most one side of a size may be to the other for the AI to be offered it: 3:1 and 1:3. */
export const AI_RATIO_LIMIT = 3

/** The tag of a picture the AI flow made, which the brand's images show under their own filter. */
export const AI_TAG = 'ai'

/** The tag of a picture the AI flow uses on the way, such as a layer piece or marks, which the images never show. */
export const AI_PART_TAG = 'ai-part'

/** The tags of the pictures the AI flow makes. */
export type AiAssetTag = typeof AI_TAG | typeof AI_PART_TAG

/** The most characters of a brief's title. */
export const BRIEF_TITLE_LENGTH = 120

/** A frame's size in design pixels. */
const FrameSize = z.object({
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
})

/** A size the AI is offered: from 1:3 to 3:1. */
export const AiSize = FrameSize.refine(isAiSize, { message: 'the AI is offered sizes from 1:3 to 3:1' })
export type AiSize = z.infer<typeof AiSize>

/** The ids a tab made for a frame a job fills and the picture layer in it that takes the picture (ADR-0015). */
export const AiFrameTarget = z.object({ frameId: Id, pictureLayerId: Id })
export type AiFrameTarget = z.infer<typeof AiFrameTarget>

/** A frame a resize fills, with the size it is redrawn at, from 1:3 to 3:1. */
export const AiSizeTarget = AiFrameTarget.extend(FrameSize.shape).refine(isAiSize, {
  message: 'the AI is offered sizes from 1:3 to 3:1',
})
export type AiSizeTarget = z.infer<typeof AiSizeTarget>

/** The brand kit's picks, told to the round planner as the brand's facts. */
export const BrandFacts = z.object({
  name: z.string().max(200),
  colors: z.array(z.string().max(100)).max(50),
  fonts: z.array(z.string().max(200)).max(50),
  voice: z.string().max(2000),
})
export type BrandFacts = z.infer<typeof BrandFacts>

/** What every flow job is given: the brand its pictures become assets of, and the design it fills. */
const FlowJob = z.object({ brandId: Id, designId: Id })

/**
 * A round: the brief (its words, its pictures, an optional reference ad, one size and a mode), the brand's
 * facts and kit logo, and the ids of its section and of the four frames it fills, one per draft, in the order
 * of the plan's ads.
 */
export const RoundInput = FlowJob.extend({
  briefId: Id,
  sectionId: Id,
  frames: z.array(AiFrameTarget).length(4),
  words: z.string().trim().min(1).max(4000),
  pictures: z.array(PictureKey).max(MAX_REFERENCES),
  referenceKey: PictureKey.optional(),
  size: AiSize,
  mode: AiMode,
  brand: BrandFacts,
  logoKey: PictureKey.optional(),
})
export type RoundInput = z.infer<typeof RoundInput>

/** More like this: a round, with the picture of the draft the person liked, which only the planner sees. */
export const MoreLikeThisInput = RoundInput.extend({ likedKey: PictureKey })
export type MoreLikeThisInput = z.infer<typeof MoreLikeThisInput>

/** Try again: one draft of a brief again, from the brief's stored plan, into its frame. */
export const TryAgainInput = FlowJob.extend({
  briefId: Id,
  draft: z.number().int().min(0).max(3),
  frame: AiFrameTarget,
})
export type TryAgainInput = z.infer<typeof TryAgainInput>

/**
 * Refine with AI: the frame's picture, the person's message and, when they marked places, a transparent marks
 * layer at the frame's size; the new version goes into the frame's picture layer.
 */
export const RefineInput = FlowJob.extend({
  briefId: Id.optional(),
  frame: AiFrameTarget,
  pictureKey: PictureKey,
  message: z.string().trim().min(1).max(4000),
  marksKey: PictureKey.optional(),
  size: AiSize,
})
export type RefineInput = z.infer<typeof RefineInput>

/** Other sizes: the draft's picture redrawn at each size, each a new frame of a new section. */
export const ResizeInput = FlowJob.extend({
  briefId: Id.optional(),
  sectionId: Id,
  pictureKey: PictureKey,
  sizes: z.array(AiSizeTarget).min(1).max(20),
})
export type ResizeInput = z.infer<typeof ResizeInput>

/**
 * Layering: the picture of each frame to make editable, one per size, split at 512 or 1024 px, and the draft
 * the sizes came from when it isn't one of them, which the one layer plan is made from.
 */
export const LayeringInput = FlowJob.extend({
  briefId: Id.optional(),
  frames: z
    .array(z.object({ frameId: Id, pictureKey: PictureKey }))
    .min(1)
    .max(20),
  planKey: PictureKey.optional(),
  size: LayerSplitSize,
})
export type LayeringInput = z.infer<typeof LayeringInput>

/** The ratios an AI image is made at. */
export const IMAGE_RATIOS = ['square', 'wide', 'tall'] as const

export const ImageRatio = z.enum(IMAGE_RATIOS)
export type ImageRatio = z.infer<typeof ImageRatio>

/** What a person writes to have an image made: 1 to 2,000 characters. */
export const ImageWords = z.string().trim().min(1).max(2000)

/** Make an image: one picture for the brand from the person's words, at a ratio, on no design. */
export const ImageInput = z.object({ brandId: Id, words: ImageWords, ratio: ImageRatio })
export type ImageInput = z.infer<typeof ImageInput>

/** Each AI feature's input contract. */
export const AI_FEATURE_INPUTS = {
  round: RoundInput,
  'more-like-this': MoreLikeThisInput,
  'try-again': TryAgainInput,
  refine: RefineInput,
  resize: ResizeInput,
  layering: LayeringInput,
  image: ImageInput,
} satisfies Record<AiFeature, z.ZodType>

/** A job of each AI feature with its input. */
export type AiFeatureInput = {
  [K in AiFeature]: { kind: K; input: z.infer<(typeof AI_FEATURE_INPUTS)[K]> }
}[AiFeature]

/** What an AI frame holds: a draft of a round, a size redrawn from a draft, or a refined version. */
export const AI_FRAME_KINDS = ['draft', 'size', 'refine'] as const

export const AiFrameKind = z.enum(AI_FRAME_KINDS)
export type AiFrameKind = z.infer<typeof AiFrameKind>

/**
 * The states of an AI frame: waiting for its picture, its picture arrived in the design, its call failed, being
 * made editable, or editable.
 */
export const AI_FRAME_STATES = ['waiting', 'arrived', 'failed', 'layering', 'editable'] as const

export const AiFrameState = z.enum(AI_FRAME_STATES)
export type AiFrameState = z.infer<typeof AiFrameState>

/** The round's four kinds of ad, which the round planner and the reference reader name. */
export const AD_KINDS = ['photographic', 'graphical', 'composite', 'free'] as const

export const AdKind = z.enum(AD_KINDS)
export type AdKind = z.infer<typeof AdKind>

/** One ad of a round plan: its kind, its idea, its arrangement, what its picture shows, and its prompt. */
const PlannedAd = z.object({
  kind: AdKind,
  idea: z.string(),
  arrangement: z.string(),
  picture: z.string(),
  prompt: z.string(),
})

/** The round planner's answer: its reading of the brand, ending with the advertiser's facts, and four ads in order. */
export const RoundPlanAnswer = z.object({ brand: z.string(), ads: z.array(PlannedAd).length(4) })
export type RoundPlanAnswer = z.infer<typeof RoundPlanAnswer>

/** The refine editor's answer: the instruction for the image editing model, the summary, and pinned only. */
export const RefinePlanAnswer = z.object({ instruction: z.string(), summary: z.string(), pinned_only: z.boolean() })
export type RefinePlanAnswer = z.infer<typeof RefinePlanAnswer>

/** The reference reader's answer: why, whether the picture is an ad, and the kind it is or comes closest to. */
export const ReferenceReadAnswer = z.object({ why: z.string(), is_ad: z.boolean(), kind: AdKind })
export type ReferenceReadAnswer = z.infer<typeof ReferenceReadAnswer>

/** A whole number on the layer planner's 0 to 999 grid. */
const GridPoint = z.number().int().min(0).max(999)

/** One element of a layer plan, as the planner lists them, front to back. */
const PlanElement = z.object({
  id: z.string(),
  kind: z.enum(['text', 'logo', 'shape', 'graphic', 'cutout', 'photo', 'background']),
  name: z.string(),
  content: z.string(),
  text_lines: z.array(z.string()),
  box: z.object({ x_min: GridPoint, y_min: GridPoint, x_max: GridPoint, y_max: GridPoint }),
  shadow: z.enum(['drop', 'cast', 'glow', 'none']),
  group: z.string().nullable(),
  ming_layer: z.number().int().min(1).max(6),
})

/** The layer planner's answer: the ad type, the elements, the layer split's prompt, the notes and the design's name. */
export const LayerPlanAnswer = z.object({
  ad_type: z.enum(['photographic', 'graphical', 'composite']),
  elements: z.array(PlanElement).min(1),
  prompt: z.string(),
  notes: z.array(z.string()),
  design_name: z.string(),
})
export type LayerPlanAnswer = z.infer<typeof LayerPlanAnswer>

/** The layer planner's answer with the product note: also the product's element, or null when the ad doesn't show it. */
export const ProductLayerPlanAnswer = LayerPlanAnswer.extend({ product_element: z.string().nullable() })
export type ProductLayerPlanAnswer = z.infer<typeof ProductLayerPlanAnswer>

/** One text block as the reading gives it back. */
const ReadBlock = z.object({
  id: z.string(),
  text: z.string(),
  corrections: z.array(z.string()),
  lettering: z.enum(['font', 'custom']),
  style: z.enum(['sans-serif', 'serif', 'slab-serif', 'script', 'display', 'monospace']),
  italic: z.boolean(),
  rounded: z.boolean(),
  mixed_styles: z.boolean(),
  mixed_note: z.string(),
})

/** The reading's answer: each text block of the ad as the advertiser intended it, and how it is lettered. */
export const ReadingAnswer = z.object({ blocks: z.array(ReadBlock) })
export type ReadingAnswer = z.infer<typeof ReadingAnswer>

/** The answer each of the flow's text calls is asked for. */
export const FLOW_ANSWERS = {
  roundPlan: RoundPlanAnswer,
  refinePlan: RefinePlanAnswer,
  referenceRead: ReferenceReadAnswer,
  layerPlan: LayerPlanAnswer,
  productLayerPlan: ProductLayerPlanAnswer,
  reading: ReadingAnswer,
} as const

/** Whether the AI is offered `size`: its ratio is from 1:3 to 3:1. */
export function isAiSize(size: { width: number; height: number }): boolean {
  const ratio = size.width / size.height
  return ratio <= AI_RATIO_LIMIT && ratio >= 1 / AI_RATIO_LIMIT
}

/** A job of the AI feature `kind` with `input` as its contract reads it; throws on an input it refuses. */
export function parseFeatureJob(kind: AiFeature, input: unknown): AiFeatureInput {
  return { kind, input: AI_FEATURE_INPUTS[kind].parse(input) } as AiFeatureInput
}

/** A brief's title: its first line, trimmed, cut to `BRIEF_TITLE_LENGTH` characters with "…". */
export function briefTitle(words: string): string {
  const line = words.trim().split('\n')[0]?.trim() ?? ''
  return line.length > BRIEF_TITLE_LENGTH ? `${line.slice(0, BRIEF_TITLE_LENGTH - 1).trimEnd()}…` : line
}

/** An answer as the JSON schema a text call sends as its strict response format. */
export function answerSchema(answer: z.ZodType): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(answer) }
  delete schema.$schema
  return schema
}

/** The fill a picture layer waits in until its picture arrives: a plain warm grey, as a waiting frame exports. */
export const WAITING_FILL: SolidPaint = { type: 'solid', color: '#EFE9E1FF' }

/** The name of a draft's picture layer. */
export const PICTURE_NAME = 'Picture'

/**
 * The id of the picture layer of the AI frame `frameId`: any tab finds it from the frame's id alone, since the API
 * keeps the frame's id and not the layer's.
 */
export function pictureLayerOf(frameId: string): string {
  return `${frameId}-picture`
}
