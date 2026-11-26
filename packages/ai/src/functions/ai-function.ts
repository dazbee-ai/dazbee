// The AI functions: each one's declaration by name, its presets, and what a preset runs with.
import { createHash } from 'node:crypto'

import { AI_FUNCTIONS, type AiFunction } from '@dazbee/schema'

import { draft } from './draft.ts'
import { layerPlan } from './layer-plan.ts'
import { layerSplit } from './layer-split.ts'
import { reading } from './reading.ts'
import { referenceRead } from './reference-read.ts'
import { refineEdit } from './refine-edit.ts'
import { refinePlan } from './refine-plan.ts'
import { resize } from './resize.ts'
import { roundPlan } from './round-plan.ts'
import type { AiFunctionDef, Preset } from './types.ts'

/** Every AI function's declaration. */
export const AI_FUNCTION_DEFS: Record<AiFunction, AiFunctionDef> = {
  'reference-read': referenceRead,
  'round-plan': roundPlan,
  draft,
  'refine-plan': refinePlan,
  'refine-edit': refineEdit,
  resize,
  'layer-plan': layerPlan,
  'layer-split': layerSplit,
  reading,
}

/** Whether `name` is an AI function. */
export function isAiFunction(name: string): name is AiFunction {
  return (AI_FUNCTIONS as readonly string[]).includes(name)
}

/** The AI function `name`'s declaration; fails for a name that is none. */
export function aiFunctionDef(name: string): AiFunctionDef {
  if (!isAiFunction(name)) throw new Error(`no AI function ${name}`)
  return AI_FUNCTION_DEFS[name]
}

/** The AI function's default preset: the first it declares. */
export function defaultPreset(fn: AiFunction): string {
  const [first] = Object.keys(AI_FUNCTION_DEFS[fn].presets)
  if (!first) throw new Error(`the AI function ${fn} has no preset`)
  return first
}

/** The AI function's preset `name`, or null when the code has none by that name. */
export function presetOf(fn: AiFunction, name: string): Preset | null {
  const presets = AI_FUNCTION_DEFS[fn].presets
  return Object.hasOwn(presets, name) ? (presets[name] ?? null) : null
}

/** The prompt a preset runs with: its own, or else its AI function's; none for a function that has no words. */
export function promptOf(fn: AiFunction, preset: Preset): string | undefined {
  return preset.prompt ?? AI_FUNCTION_DEFS[fn].prompt
}

/** The SHA-256 of the prompt a preset runs with, as hex; empty for a function that has no words. */
export function promptHash(fn: AiFunction, preset: Preset): string {
  const prompt = promptOf(fn, preset)
  return prompt === undefined ? '' : createHash('sha256').update(prompt).digest('hex')
}

/** The ceiling a preset's call is held to: its own, or else its AI function's; none for a call that isn't text. */
export function ceilingOf(fn: AiFunction, preset: Preset): number | undefined {
  return preset.ceiling ?? AI_FUNCTION_DEFS[fn].ceiling
}
