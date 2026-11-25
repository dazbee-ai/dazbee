// AI calls and metering (ADR-0022, ADR-0023): the AI steps, the modes, the sellers, the kinds of AI call,
// the units the price list counts usage in, and what each kind of call takes and gives back.
import { z } from 'zod'

/** Every AI step the AI flow runs, each priced and logged on its own. */
export const AI_STEPS = [
  'round-plan',
  'read',
  'draft-fast',
  'draft-precise',
  'refine',
  'resize',
  'layer-plan',
  'layer-split',
] as const

export const AiStep = z.enum(AI_STEPS)
export type AiStep = z.infer<typeof AiStep>

/** The draft's two modes, each the model of one draft AI step. */
export const AI_MODES = ['fast', 'precise'] as const

export const AiMode = z.enum(AI_MODES)
export type AiMode = z.infer<typeof AiMode>

/** The sellers an AI call can go to. */
export const SELLERS = ['openai', 'meta', 'openrouter', 'zenmux', 'pixazo', 'modal'] as const

export const Seller = z.enum(SELLERS)
export type Seller = z.infer<typeof Seller>

/** The kinds of AI call a seller's adapter makes. */
export const CALL_KINDS = ['text', 'picture', 'picture-edit', 'layer-split'] as const

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

/** A picture call: one picture from a prompt, at a size. */
export const PictureCall = z.object({
  kind: z.literal('picture'),
  prompt: z.string().max(100_000),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
})
export type PictureCall = z.infer<typeof PictureCall>

/** A picture edit: a prompt over reference pictures, with an optional picture of marks showing where to change it. */
export const PictureEditCall = z.object({
  kind: z.literal('picture-edit'),
  prompt: z.string().max(100_000),
  pictures: z.array(PictureKey).min(1).max(16),
  marks: PictureKey.optional(),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
})
export type PictureEditCall = z.infer<typeof PictureEditCall>

/** The layer split's two sizes: 512 px for people not paying, 1024 px for those paying. */
export const LayerSplitSize = z.union([z.literal(512), z.literal(1024)])
export type LayerSplitSize = z.infer<typeof LayerSplitSize>

/** A layer split: a draft picture split into layers at a size, with no guidance unless one is given. */
export const LayerSplitCall = z.object({
  kind: z.literal('layer-split'),
  picture: PictureKey,
  size: LayerSplitSize,
  guidance: z.number().positive().max(20).optional(),
})
export type LayerSplitCall = z.infer<typeof LayerSplitCall>

/** What an AI call is asked to do. */
export const CallInput = z.discriminatedUnion('kind', [TextCall, PictureCall, PictureEditCall, LayerSplitCall])
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
