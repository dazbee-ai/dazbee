// AI calls and metering (ADR-0022, ADR-0023): the AI functions, the modes, the sellers, the kinds of AI call,
// the units the price list counts usage in, and what each kind of call takes and gives back.
import { z } from 'zod'

import { AssetId } from './primitives.ts'

/**
 * Every AI function: one thing the AI is asked to do, a kind of call with the words it is given and the shape of
 * its answer.
 */
export const AI_FUNCTIONS = [
  'reference-read',
  'round-plan',
  'draft',
  'refine-plan',
  'refine-edit',
  'resize',
  'layer-plan',
  'layer-split',
  'reading',
  'image',
] as const

export const AiFunction = z.enum(AI_FUNCTIONS)
export type AiFunction = z.infer<typeof AiFunction>

/** The AI function of layering that splits a draft into picture layers, at a fixed amount. */
export const LAYER_SPLIT = 'layer-split' satisfies AiFunction

/** The modes a person picks a round by, each a list of the presets its AI functions run. */
export const AI_MODES = ['fast', 'precise'] as const

export const AiMode = z.enum(AI_MODES)
export type AiMode = z.infer<typeof AiMode>

/** The mode a pick is for: a mode, or none (empty) for an AI function no mode changes. */
export const PickMode = z.union([AiMode, z.literal('')])
export type PickMode = z.infer<typeof PickMode>

/** The sellers an AI call can go to. */
export const SELLERS = ['openai', 'meta', 'openrouter', 'zenmux', 'pixazo', 'modal'] as const

export const Seller = z.enum(SELLERS)
export type Seller = z.infer<typeof Seller>

/** The kinds of AI call a seller's adapter makes. */
export const CALL_KINDS = ['text', 'picture', 'layer-split'] as const

export const CallKind = z.enum(CALL_KINDS)
export type CallKind = z.infer<typeof CallKind>

/**
 * The units usage is counted and priced in. A seller that bills its fast tier at a price of its own reports a
 * call that ran on that tier in the fast token units.
 */
export const USAGE_UNITS = [
  'input-token',
  'cached-input-token',
  'output-token',
  'fast-input-token',
  'fast-cached-input-token',
  'fast-output-token',
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
export const PictureKey = z.string().min(1).max(500)

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
 * (ADR-0002): the picture's bytes, base64, the call's size, guidance and plan, and when it was asked for, in
 * milliseconds since 1970, from which a container that starts for the call tells how long its start took.
 */
export const LayerSplitRequest = z.object({
  picture: z.base64().max(40_000_000),
  size: LayerSplitSize,
  guidance: LayerSplitGuidance.optional(),
  plan: LayerPlan.optional(),
  askedAt: z.number().int().positive().optional(),
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
 * call, timed inside the function, with the CPU cores and memory the function declares. The rest of the time the
 * container is billed for falls to its calls: the first call a container serves carries `startSeconds`, from when
 * it was asked for to when the container began it, and `waitSeconds`, how long a container waits for another call
 * before it stops; each later call carries `idleSeconds`, how long the container had waited for it.
 */
export const LayerSplitResult = z.object({
  layers: z.array(SplitLayer).min(1).max(20),
  seconds: z.number().nonnegative(),
  cpuCores: z.number().positive(),
  memoryGib: z.number().positive(),
  startSeconds: z.number().nonnegative().nullable().optional(),
  idleSeconds: z.number().nonnegative().nullable().optional(),
  waitSeconds: z.number().nonnegative().optional(),
})
export type LayerSplitResult = z.infer<typeof LayerSplitResult>

/** What an AI call is asked to do. */
export const CallInput = z.discriminatedUnion('kind', [TextCall, PictureCall, LayerSplitCall])
export type CallInput = z.infer<typeof CallInput>

/** A stored picture an AI call made, with its size, and the brand asset recorded on its key when there is one. */
export const MadePicture = z.object({
  key: PictureKey,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  assetId: AssetId.optional(),
})
export type MadePicture = z.infer<typeof MadePicture>

/** What an AI call gave back: text (and its JSON when a schema was asked for), stored pictures, or layers. */
export const CallOutput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string(), json: z.unknown().optional() }),
  z.object({ kind: z.literal('pictures'), pictures: z.array(MadePicture) }),
  z.object({ kind: z.literal('layers'), layers: z.array(MadePicture), gpuSeconds: z.number().nonnegative() }),
])
export type CallOutput = z.infer<typeof CallOutput>

/** The AI features, each what a person asks the AI for in one go (input contracts in `ai-flow.ts`). */
export const AI_FEATURES = ['round', 'more-like-this', 'try-again', 'refine', 'resize', 'layering', 'image'] as const

export const AiFeature = z.enum(AI_FEATURES)
export type AiFeature = z.infer<typeof AiFeature>

/** The job kinds of AI job. `calls` runs a list of AI calls given when it is saved; the rest are the flow's. */
export const AI_JOB_KINDS = ['calls', ...AI_FEATURES] as const

export const AiJobKind = z.enum(AI_JOB_KINDS)
export type AiJobKind = z.infer<typeof AiJobKind>

/** What an AI job's pg-boss job carries: the AI job's id. */
export const AiJobMessage = z.object({ job: z.string().min(1) })
export type AiJobMessage = z.infer<typeof AiJobMessage>

/**
 * One call of a `calls` job: its AI function, the name of the preset it runs with, its input, and the only sellers
 * to try, in order, when given.
 */
export const JobCall = z.object({
  function: z.string().min(1).max(100),
  preset: z.string().min(1).max(100),
  input: CallInput,
  sellers: z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
})
export type JobCall = z.infer<typeof JobCall>

/** What a `calls` job runs: its calls, by call index. */
export const CallsInput = z.object({ calls: z.array(JobCall).min(1).max(50) })
export type CallsInput = z.infer<typeof CallsInput>

/** What a done `calls` job gave back: each call's output, by call index. */
export const CallsOutput = z.object({ outputs: z.array(CallOutput) })
export type CallsOutput = z.infer<typeof CallsOutput>

/** Why saving an AI job was refused: the member may not use AI, the allowance is used up, or the day's spending stop is in force. */
export const AI_JOB_REFUSALS = ['not-allowed', 'used-up', 'stopped'] as const

export const AiJobRefusal = z.enum(AI_JOB_REFUSALS)
export type AiJobRefusal = z.infer<typeof AiJobRefusal>

/**
 * Why a call ended without a result, as its workspace reads it: no seller made it, its answer was cut off at its
 * ceiling, or it is an unknown call, which its seller may have made but whose result wasn't kept.
 */
export const AI_CALL_FAILURES = ['not-made', 'cut-off', 'unknown'] as const

export const AiCallFailure = z.enum(AI_CALL_FAILURES)
export type AiCallFailure = z.infer<typeof AiCallFailure>

/** Where one call of a job sits: its place in the job and its AI function. */
const CallPlace = z.object({
  index: z.number().int().nonnegative(),
  function: z.string(),
})

/** One call of an AI job as its workspace reads it: being made, made with its output, or failed with why. */
export const AiCallView = z.discriminatedUnion('state', [
  CallPlace.extend({ state: z.literal('running') }),
  CallPlace.extend({ state: z.literal('done'), output: CallOutput }),
  CallPlace.extend({ state: z.literal('failed'), failure: AiCallFailure }),
])
export type AiCallView = z.infer<typeof AiCallView>

/**
 * An AI job as its workspace reads it: its state, its output once done or why it failed, and each call it has
 * started, by call index, so a tab can show each picture as soon as it is made.
 */
export const AiJobView = z.object({
  id: z.string(),
  kind: AiJobKind,
  state: AiJobState,
  output: CallsOutput.nullable(),
  calls: z.array(AiCallView),
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

/** How many reference pictures a picture call sends: its pictures, and the marked copy when it has marks. */
export function referenceCount(call: { pictures: string[]; marks?: string | undefined }): number {
  return call.pictures.length + (call.marks ? 1 : 0)
}
