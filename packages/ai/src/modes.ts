// The modes: for each one, the preset of every AI function it changes. An AI function no mode names runs its
// default preset in every mode.
import { AI_MODES, type AiFunction, type AiMode } from '@dazbee/schema'

/** The preset each mode gives the AI functions it changes. */
export const MODE_PRESETS: Record<AiMode, Partial<Record<AiFunction, string>>> = {
  fast: { 'round-plan': 'light-luna' },
  precise: { 'round-plan': 'full-terra' },
}

/** Whether a mode changes the AI function's preset. */
export function modeChanges(fn: AiFunction): boolean {
  return AI_MODES.some((mode) => MODE_PRESETS[mode][fn] !== undefined)
}
