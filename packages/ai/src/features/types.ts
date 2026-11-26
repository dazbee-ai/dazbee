// What an AI feature declares: the calls it may make, in stages, and what each is built from. The runner, the hold,
// the wait and the estimate all read this one declaration.
import type { Db, Tx } from '@dazbee/db'
import type { AiFunction, AiMode, CallInput, CallOutput, LayerSplitSize } from '@dazbee/schema'

import type { PictureFiles } from '../call.ts'
import type { JobEnd } from '../jobs.ts'

/**
 * What decides which calls a job makes, known from its input and, before it is asked for, from what the screen
 * knows: how many sizes or frames it works on, whether it has a reference ad, and the size its layer splits run
 * at, for a job that splits layers.
 */
export interface Shape {
  count: number
  reference: boolean
  layerSize?: LayerSplitSize
}

/** What a feature's own pieces run on: the database, the workspace's originals and the workspace. */
export interface FeatureRun {
  db: Db
  files: PictureFiles
  workspace: string
}

/** What a call is built from. */
export interface Built<Input, Loaded> {
  input: Input
  /** What the feature loaded before its first call. */
  loaded: Loaded
  /** The output of each earlier call that delivered, by call index. */
  answers: ReadonlyMap<number, CallOutput>
  /** The prompt and the model of the preset the call runs with. */
  prompt: string
  model: string
}

/** One call an AI feature may make. */
export interface FeatureCall<Input, Loaded> {
  /** Its place in the job, the same on every run. */
  index: number
  fn: AiFunction
  /** Whether the job stands on it: the job fails when the call does, or when its answer can't be used. */
  standsOn?: boolean
  /** Why the answer of a call the job stands on can't be used, or null when it can. */
  unusable?(output: CallOutput): string | null
  /** The call's input, or null for a call that is not made. */
  build(from: Built<Input, Loaded>): CallInput | null
  /** The input its hold is worked out from, for a call whose charge depends on its input. */
  held?(shape: Shape): CallInput
}

/** An AI feature: what a person asks the AI for in one go, as the calls it may make, in stages. */
export interface AiFeatureDef<Input, Loaded = undefined> {
  /** The job's shape, from its input. */
  shape(input: Input): Shape
  /** Its stages for a shape: a stage's calls are made side by side, and the next stage starts when they end. */
  stages(shape: Shape): FeatureCall<Input, Loaded>[][]
  /** The mode a job is asked for in; a feature without it is one no mode changes. */
  mode?(db: Db | Tx, workspace: string, input: Input): Promise<AiMode | null> | AiMode | null
  /** Throws for a job that can't be saved. */
  check?(db: Db | Tx, workspace: string, input: Input): Promise<void>
  /** What it loads before its first call, or how the job ends when it can't. */
  load?(on: FeatureRun, input: Input): Promise<{ loaded: Loaded } | { end: JobEnd }>
  /** What its pictures are named. */
  name(on: FeatureRun, input: Input, loaded: Loaded): Promise<string> | string
  /** What it writes once a call's output is kept. */
  kept?(on: FeatureRun, input: Input, index: number, output: CallOutput): Promise<void>
}
