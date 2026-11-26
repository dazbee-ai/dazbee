// What an AI function and a preset declare.
import type { answerSchema, CallInput, CallKind } from '@dazbee/schema'

import type { AiSettings } from '../settings.ts'

/**
 * A preset: a model, its settings and the prompt tested with it, under one name, for one AI function. It is never
 * edited once merged; a change is a new preset.
 */
export interface Preset {
  model: string
  /** What the call passes its seller beside the model: reasoning effort, speed tier, a picture's quality. */
  settings: Record<string, unknown>
  /** The preset's own prompt, where the AI function's prompt differs by preset. */
  prompt?: string
  /** The preset's own ceiling, where it differs from the AI function's. */
  ceiling?: number
  /**
   * What one call is taken to cost, in millionths of a rupee of real cost, and how many seconds it takes, while the
   * preset has no done call of its own to measure.
   */
  guess: { cost: bigint; seconds: number }
}

/** An AI function: its kind of call, its prompt, the shape of its answer, and its presets, the first its default. */
export interface AiFunctionDef {
  kind: CallKind
  /** The words every preset is given, unless a preset brings its own. */
  prompt?: string
  /** The contract of a text function's answer. */
  answer?: Parameters<typeof answerSchema>[0]
  /** The most output one call of a text function may write, sent to the seller as a hard limit. */
  ceiling?: number
  /** How long one try may take, in place of the seller's or the kind's time. */
  timeoutMs?: number
  presets: Record<string, Preset>
  /** The real cost the workspace is charged in place of the priced usage. */
  fixedCharge?(settings: AiSettings, input: CallInput): bigint
}
