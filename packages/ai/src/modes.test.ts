// The modes list names only presets the code has.
import { describe, expect, it } from 'vitest'

import { AI_FUNCTIONS, AI_MODES } from '@dazbee/schema'

import { presetOf } from './functions/ai-function.ts'
import { MODE_PRESETS, modeChanges } from './modes.ts'

describe('MODE_PRESETS', () => {
  it('names, for every mode, only presets its AI functions declare', () => {
    for (const mode of AI_MODES) {
      for (const fn of AI_FUNCTIONS) {
        const name = MODE_PRESETS[mode][fn]
        if (name !== undefined) expect(presetOf(fn, name), `${mode} ${fn}/${name}`).not.toBeNull()
      }
    }
  })

  it('gives every mode a preset for each AI function any mode changes', () => {
    for (const fn of AI_FUNCTIONS.filter(modeChanges)) {
      expect(
        AI_MODES.filter((mode) => MODE_PRESETS[mode][fn] === undefined),
        fn,
      ).toEqual([])
    }
  })
})

describe('modeChanges', () => {
  it('is true for the round plan alone', () => {
    expect(AI_FUNCTIONS.filter(modeChanges)).toEqual(['round-plan'])
  })
})
