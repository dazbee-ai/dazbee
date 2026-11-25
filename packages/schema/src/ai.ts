// AI calls and metering (ADR-0022, ADR-0023): the AI steps, the modes, the sellers, the kinds of AI call,
// the units the price list counts usage in, and what each kind of call takes and gives back.
import { z } from 'zod'

/**
 * Every AI step, each priced and logged on its own, named `<feature>.<name>` by the feature that calls it:
 * `flow` is the AI flow.
 */
export const AI_STEPS = [
  'flow.round-plan',
  'flow.read',
  'flow.draft-fast',
  'flow.draft-precise',
  'flow.refine',
  'flow.resize',
  'flow.layer-plan',
  'flow.layer-split',
] as const

export const AiStep = z.enum(AI_STEPS)
export type AiStep = z.infer<typeof AiStep>

/** The AI step of layering that splits a draft into picture layers, at a fixed amount. */
export const LAYER_SPLIT_STEP = 'flow.layer-split' satisfies AiStep

/** The draft's two modes, each the model of one draft AI step. */
export const AI_MODES = ['fast', 'precise'] as const

export const AiMode = z.enum(AI_MODES)
export type AiMode = z.infer<typeof AiMode>

/** The sellers an AI call can go to. */
export const SELLERS = ['openai', 'meta', 'openrouter', 'zenmux', 'pixazo', 'modal'] as const

export const Seller = z.enum(SELLERS)
export type Seller = z.infer<typeof Seller>

/** The kinds of AI call a seller's adapter makes. */
export const CALL_KINDS = ['text', 'picture', 'layer-split'] as const

export const CallKind = z.enum(CALL_KINDS)
export type CallKind = z.infer<typeof CallKind>

/** The units usage is counted and priced in. */
export const USAGE_UNITS = [
  'input-token',
  'cached-input-token',
  'output-token',
  'image-input-token',
  'image-output-token',
  'picture',
  'reference-picture',
  'gpu-second',
  'cpu-core-second',
  'memory-gib-second',
] as const

export const UsageUnit = z.enum(USAGE_UNITS)
export type UsageUnit = z.infer<typeof UsageUnit>

/** Usage as a seller reported it: an amount of each unit, at most six decimal places counted. */
export const Usage = z.partialRecord(UsageUnit, z.number().nonnegative())
export type Usage = z.infer<typeof Usage>

/** The states of a call-log row. An unknown call may have been made and billed by its seller. */
export const CALL_STATES = ['running', 'done', 'failed', 'unknown'] as const

export const CallState = z.enum(CALL_STATES)
export type CallState = z.infer<typeof CallState>

/** The states of an AI job. */
export const AI_JOB_STATES = ['waiting', 'running', 'done', 'failed', 'cancelled'] as const

export const AiJobState = z.enum(AI_JOB_STATES)
export type AiJobState = z.infer<typeof AiJobState>

/** Where a grant came from. Gifts are the only source until plans and payments. */
export const GRANT_SOURCES = ['gift'] as const

export const GrantSource = z.enum(GRANT_SOURCES)
export type GrantSource = z.infer<typeof GrantSource>

/** The kinds of allowance-ledger row: a hold and a charge take allowance, a give-back returns it. */
export const LEDGER_KINDS = ['hold', 'charge', 'give-back'] as const

export const LedgerKind = z.enum(LEDGER_KINDS)
export type LedgerKind = z.infer<typeof LedgerKind>

/** The most reference pictures a picture call sends, its marked copy counted. */
export const MAX_REFERENCES = 16

/** A stored picture: the storage key of a workspace original. */
const PictureKey = z.string().min(1).max(500)

/** A text call: instructions and a prompt, with optional pictures to read, and an optional JSON schema for the answer. */
export const TextCall = z.object({
  kind: z.literal('text'),
  instructions: z.string().max(100_000),
  prompt: z.string().max(100_000),
  pictures: z.array(PictureKey).max(16).default([]),
  schema: z.record(z.string(), z.unknown()).optional(),
  maxOutputTokens: z.number().int().positive().max(100_000).optional(),
})
export type TextCall = z.infer<typeof TextCall>

/**
 * A picture call: one picture from a prompt, at a size, with up to 16 reference pictures (a product, a logo, a
 * style) and an optional picture of marks, drawn over a copy of the first reference to show where to change it.
 */
export const PictureCall = z
  .object({
    kind: z.literal('picture'),
    prompt: z.string().max(100_000),
    pictures: z.array(PictureKey).max(MAX_REFERENCES).default([]),
    marks: PictureKey.optional(),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
  })
  .refine((call) => !call.marks || call.pictures.length > 0, {
    message: 'marks need a picture to be drawn on',
    path: ['marks'],
  })
  .refine((call) => referenceCount(call) <= MAX_REFERENCES, {
    message: `a picture call sends at most ${MAX_REFERENCES} reference pictures, the marked copy counted`,
    path: ['pictures'],
  })
export type PictureCall = z.infer<typeof PictureCall>

/** The layer split's two sizes: 512 px for people not paying, 1024 px for those paying. */
export const LayerSplitSize = z.union([z.literal(512), z.literal(1024)])
export type LayerSplitSize = z.infer<typeof LayerSplitSize>

/** The most guidance a layer split takes; with none, it runs unguided. */
const LayerSplitGuidance = z.number().positive().max(20)

/**
 * The layer plan a layer split follows: "Decompose this image into N layers with the following
 * specifications:", then a line for each layer, top first. With none, the picture is split into 5 layers.
 */
const LayerPlan = z.string().min(1).max(10_000)

/** A layer split: a draft picture split into layers at a size, with no guidance unless one is given. */
export const LayerSplitCall = z.object({
  kind: z.literal('layer-split'),
  picture: PictureKey,
  size: LayerSplitSize,
  guidance: LayerSplitGuidance.optional(),
  plan: LayerPlan.optional(),
})
export type LayerSplitCall = z.infer<typeof LayerSplitCall>

/**
 * What the layer split app (python/layering) is sent, the job contract its Python model is generated from
 * (ADR-0002): the picture's bytes, base64, and the call's size, guidance and plan.
 */
export const LayerSplitRequest = z.object({
  picture: z.base64().max(40_000_000),
  size: LayerSplitSize,
  guidance: LayerSplitGuidance.optional(),
  plan: LayerPlan.optional(),
})
export type LayerSplitRequest = z.infer<typeof LayerSplitRequest>

/** One layer the layer split app made: a PNG with transparency, base64, at the size it was split at. */
const SplitLayer = z.object({
  png: z.base64(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

/**
 * What the layer split app gives back: the layers, top first, and the seconds its container worked on the
 * call, timed inside the function, with the CPU cores and memory the function declares for those seconds.
 */
export const LayerSplitResult = z.object({
  layers: z.array(SplitLayer).min(1).max(20),
  seconds: z.number().nonnegative(),
  cpuCores: z.number().positive(),
  memoryGib: z.number().positive(),
})
export type LayerSplitResult = z.infer<typeof LayerSplitResult>

/** What an AI call is asked to do. */
export const CallInput = z.discriminatedUnion('kind', [TextCall, PictureCall, LayerSplitCall])
export type CallInput = z.infer<typeof CallInput>

/** A stored picture an AI call made, with its size. */
export const MadePicture = z.object({
  key: PictureKey,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type MadePicture = z.infer<typeof MadePicture>

/** What an AI call gave back: text (and its JSON when a schema was asked for), stored pictures, or layers. */
export const CallOutput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string(), json: z.unknown().optional() }),
  z.object({ kind: z.literal('pictures'), pictures: z.array(MadePicture) }),
  z.object({ kind: z.literal('layers'), layers: z.array(MadePicture), gpuSeconds: z.number().nonnegative() }),
])
export type CallOutput = z.infer<typeof CallOutput>

/** The kinds of AI job. `ai-steps` runs a list of AI calls given when it is saved. */
export const AI_JOB_KINDS = ['ai-steps'] as const

export const AiJobKind = z.enum(AI_JOB_KINDS)
export type AiJobKind = z.infer<typeof AiJobKind>

/** What an AI job's pg-boss job carries: the AI job's id. */
export const AiJobMessage = z.object({ job: z.string().min(1) })
export type AiJobMessage = z.infer<typeof AiJobMessage>

/** One call of an `ai-steps` job: its AI step and input, and the only sellers to try, in order, when given. */
export const AiStepsCall = z.object({
  step: z.string().min(1).max(100),
  input: z.preprocess(carriedOver, CallInput),
  sellers: z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
})
export type AiStepsCall = z.infer<typeof AiStepsCall>

/** What an `ai-steps` job runs: its calls, by call index. */
export const AiStepsInput = z.object({ calls: z.array(AiStepsCall).min(1).max(50) })
export type AiStepsInput = z.infer<typeof AiStepsInput>

/** What a done `ai-steps` job gave back: each call's output, by call index. */
export const AiStepsOutput = z.object({ outputs: z.array(CallOutput) })
export type AiStepsOutput = z.infer<typeof AiStepsOutput>

/** Why saving an AI job was refused: the member may not use AI, the allowance is used up, or the day's spending stop is in force. */
export const AI_JOB_REFUSALS = ['not-allowed', 'used-up', 'stopped'] as const

export const AiJobRefusal = z.enum(AI_JOB_REFUSALS)
export type AiJobRefusal = z.infer<typeof AiJobRefusal>

/** An AI job as its workspace reads it: its state, and its output once done or why it failed. */
export const AiJobView = z.object({
  id: z.string(),
  kind: AiJobKind,
  state: AiJobState,
  output: AiStepsOutput.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
})
export type AiJobView = z.infer<typeof AiJobView>

/** How a seller-day's check came out: within 2% (or ₹1), past it, or still waiting on the seller's figure. */
export const DAILY_CHECK_STATES = ['ok', 'red', 'waiting'] as const

export const DailyCheckState = z.enum(DAILY_CHECK_STATES)
export type DailyCheckState = z.infer<typeof DailyCheckState>

/** Where a seller's own figure for a day came from: its cost report, or a file an admin uploaded. */
export const DAILY_CHECK_SOURCES = ['report', 'upload'] as const

export const DailyCheckSource = z.enum(DAILY_CHECK_SOURCES)
export type DailyCheckSource = z.infer<typeof DailyCheckSource>

/** A UTC day, as YYYY-MM-DD. */
export const UtcDay = z.iso.date()
export type UtcDay = z.infer<typeof UtcDay>

/**
 * One seller-day of the daily check, in the seller's currency before GST or fee: our call log's cost, the
 * seller's own figure, and for Modal the GPU time outside our calls, which is never red.
 */
export const DailyCheck = z.object({
  seller: z.string(),
  day: UtcDay,
  currency: z.string(),
  ourCost: z.number(),
  sellerCost: z.number().nullable(),
  outsideCalls: z.number().nullable(),
  state: DailyCheckState,
  source: DailyCheckSource.nullable(),
  checkedAt: z.iso.datetime(),
})
export type DailyCheck = z.infer<typeof DailyCheck>

/** The sellers whose usage file an admin uploads, having no cost report to fetch. */
export const UPLOADED_SELLERS = ['meta', 'pixazo'] as const

export const UploadedSeller = z.enum(UPLOADED_SELLERS)
export type UploadedSeller = z.infer<typeof UploadedSeller>

/** A seller's usage file, as an admin uploads it: the CSV's text and its file name. */
export const SellerFileUpload = z.object({
  seller: UploadedSeller,
  name: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(2_000_000),
})
export type SellerFileUpload = z.infer<typeof SellerFileUpload>

/** What an uploaded file covered: the days it gave a figure for. */
export const SellerFileResult = z.object({ days: z.array(UtcDay) })
export type SellerFileResult = z.infer<typeof SellerFileResult>

/** The unknown calls of one seller on one UTC day: how many, and their cost where it is known. */
export const UnknownCalls = z.object({ seller: z.string(), day: UtcDay, calls: z.number().int() })
export type UnknownCalls = z.infer<typeof UnknownCalls>

/** A seller that said it is out of money, and when it last said so. */
export const OutOfMoney = z.object({ seller: z.string(), at: z.iso.datetime() })
export type OutOfMoney = z.infer<typeof OutOfMoney>

/** When each seller checked from uploads was last checked: the last day an uploaded file covered. */
export const LastChecked = z.object({
  seller: UploadedSeller,
  day: UtcDay.nullable(),
  uploadedAt: z.iso.datetime().nullable(),
})
export type LastChecked = z.infer<typeof LastChecked>

/** The feature an AI step belongs to: the part of its name before the first dot, or all of it with none. */
export function featureOf(step: string): string {
  const dot = step.indexOf('.')
  return dot < 0 ? step : step.slice(0, dot)
}

/** How many reference pictures a picture call sends: its pictures, and the marked copy when it has marks. */
export function referenceCount(call: { pictures: string[]; marks?: string | undefined }): number {
  return call.pictures.length + (call.marks ? 1 : 0)
}

/** A call input as saved before picture edits were picture calls: a `picture-edit` becomes a `picture`. */
function carriedOver(input: unknown): unknown {
  return input && typeof input === 'object' && 'kind' in input && input.kind === 'picture-edit'
    ? { ...input, kind: 'picture' }
    : input
}
