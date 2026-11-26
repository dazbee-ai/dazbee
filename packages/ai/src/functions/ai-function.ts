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

/** Every AI function's declaration, by name; a test adds functions of its own. */
export const AI_FUNCTION_DEFS: Record<string, AiFunctionDef> = {
  'reference-read': referenceRead,
  'round-plan': roundPlan,
  draft,
  'refine-plan': refinePlan,
  'refine-edit': refineEdit,
  resize,
  'layer-plan': layerPlan,
  'layer-split': layerSplit,
  reading,
} satisfies Record<AiFunction, AiFunctionDef>

/** Whether `name` is one of the AI functions, not a test's own. */
export function isAiFunction(name: string): name is AiFunction {
  return (AI_FUNCTIONS as readonly string[]).includes(name)
}

/** The AI function `name`'s declaration; fails for a name that is none. */
export function aiFunctionDef(name: string): AiFunctionDef {
  const def = Object.hasOwn(AI_FUNCTION_DEFS, name) ? AI_FUNCTION_DEFS[name] : undefined
  if (!def) throw new Error(`no AI function ${name}`)
  return def
}

/**
 * The AI function's default preset: the first it declares. A preset's name starts with a letter, so the order
 * its function declares its presets in is the order they are listed in.
 */
export function defaultPreset(fn: string): string {
  const [first] = Object.keys(aiFunctionDef(fn).presets)
  if (!first) throw new Error(`the AI function ${fn} has no preset`)
  return first
}

/** The AI function's preset `name`, or null when the code has none by that name. */
export function presetOf(fn: string, name: string): Preset | null {
  const presets = aiFunctionDef(fn).presets
  return Object.hasOwn(presets, name) ? (presets[name] ?? null) : null
}

/** The prompt a preset runs with: its own, or else its AI function's; none for a function that has no words. */
export function promptOf(fn: string, preset: Preset): string | undefined {
  return preset.prompt ?? aiFunctionDef(fn).prompt
}

/** The SHA-256 of the prompt a preset runs with, as hex; null for a function that has no words. */
export function promptHash(fn: string, preset: Preset): string | null {
  const prompt = promptOf(fn, preset)
  return prompt === undefined ? null : createHash('sha256').update(prompt).digest('hex')
}

/** The ceiling a preset's call is held to: its own, or else its AI function's; none for a call that isn't text. */
export function ceilingOf(fn: string, preset: Preset): number | undefined {
  return preset.ceiling ?? aiFunctionDef(fn).ceiling
}
