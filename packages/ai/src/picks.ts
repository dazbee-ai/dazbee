// Picks: an admin's choice of which preset a mode uses for an AI function, as rows only ever added, and the
// presets a mode uses once picks are counted in.
import { asc, desc } from 'drizzle-orm'

import { aiPicks, type Db, type Tx } from '@dazbee/db'
import { AI_FUNCTIONS, type AiFunction, type AiMode } from '@dazbee/schema'

import { defaultPreset, presetOf } from './functions/ai-function.ts'
import { MODE_PRESETS, modeChanges } from './modes.ts'

/** The mode a pick is kept under for an AI function no mode changes. */
export const NO_MODE = ''

/**
 * The preset each AI function uses in `mode`: the newest pick when the code has its preset, otherwise the modes
 * list's, otherwise the function's default. An AI function a mode changes is picked for by mode, any other under
 * no mode; with no mode given, a function a mode changes uses its default.
 */
export async function presetsFor(db: Db | Tx, mode: AiMode | null): Promise<Record<AiFunction, string>> {
  // The newest pick of each function and mode, read through the index on them.
  const picks = await db
    .selectDistinctOn([aiPicks.function, aiPicks.mode], {
      fn: aiPicks.function,
      mode: aiPicks.mode,
      preset: aiPicks.preset,
    })
    .from(aiPicks)
    .orderBy(asc(aiPicks.function), asc(aiPicks.mode), desc(aiPicks.id))
  const presets = {} as Record<AiFunction, string>
  for (const fn of AI_FUNCTIONS) {
    const under = modeChanges(fn) ? mode : NO_MODE
    // The newest pick decides, even when the code has no such preset: an older pick never comes back by itself.
    const newest = under === null ? undefined : picks.find((pick) => pick.fn === fn && pick.mode === under)
    const picked = newest && presetOf(fn, newest.preset) ? newest.preset : undefined
    presets[fn] = picked ?? (mode ? MODE_PRESETS[mode][fn] : undefined) ?? defaultPreset(fn)
  }
  return presets
}
