// The AI functions' presets: each stays what it was when it was measured, and each names a model that is sold.
import { describe, expect, it } from 'vitest'

import { AI_FUNCTIONS, type AiFunction } from '@dazbee/schema'

import { tierOf } from '../sellers/tiers.ts'
import { sellerPricing } from '../steps.ts'
import { db } from '../test-ai.ts'
import {
  AI_FUNCTION_DEFS,
  aiFunctionDef,
  ceilingOf,
  defaultPreset,
  isAiFunction,
  presetOf,
  promptHash,
} from './ai-function.ts'

/**
 * Each preset's model, settings and the SHA-256 of the prompt it runs with, as merged. A preset is never edited:
 * new words, another model or another setting is a new preset under a new name, added here.
 */
const PRESETS: Record<string, { model: string; settings: Record<string, unknown>; prompt: string }> = {
  'reference-read/luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'low', tier: 'fast' },
    prompt: '42dac42b6d07034ecfeae2ed53800dc4dac484a722a93f0711c03d5f2f9becb6',
  },
  'round-plan/light-luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'low', tier: 'fast' },
    prompt: '7b9d85c434f544665efceba141e2b622463117baaaa2530506b7d8438169c595',
  },
  'round-plan/full-terra': {
    model: 'gpt-6.1-terra',
    settings: { effort: 'low', tier: 'standard' },
    prompt: 'b30db0c9d8e5c26a5791918d9f6fe2e8c15f3e72215880213bb42697c245b61f',
  },
  'draft/gpt-image-medium': {
    model: 'gpt-image-2.5-sunburst',
    settings: { quality: 'medium' },
    prompt: '322e17447ae22e6b8c729397c9c6314125a8c913dd8bbe5620cb0421f77036f8',
  },
  'refine-plan/luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'low', tier: 'fast' },
    prompt: '22b3d630e1fe056dabad7757421d73eee31c38ae40c5649cce0d464f4131d6c8',
  },
  'refine-edit/seedream': { model: 'seedream-5.5', settings: {}, prompt: '' },
  'resize/seedream': {
    model: 'seedream-5.5',
    settings: {},
    prompt: 'c1811c6c05e2aee856db5bac679a2004c0a9c153b1c5a8e001f929aec38692c4',
  },
  'layer-plan/sol': {
    model: 'gpt-6.2-sol',
    settings: { effort: 'medium', tier: 'standard' },
    prompt: 'cc38fc937840c67fc6ed1e34495b2ac2d6431286ac8cefd04f58c4a14eec2a34',
  },
  'layer-split/ming': { model: 'ming-image-0.1-design-layer', settings: {}, prompt: '' },
  'reading/luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'none', tier: 'standard' },
    prompt: '1b160606f459f65cd7fb27d45b5d21e7aa31dd6137d0681fa190cf63755ac504',
  },
}

/** Every preset of every AI function, by `function/preset`. */
const declared = AI_FUNCTIONS.flatMap((fn) =>
  Object.entries(AI_FUNCTION_DEFS[fn].presets).map(([name, preset]) => ({ fn, name, preset })),
)

describe('AI_FUNCTION_DEFS', () => {
  it('keeps each preset’s model, settings and prompt as they were merged under its name', () => {
    expect(
      Object.fromEntries(
        declared.map(({ fn, name, preset }) => [
          `${fn}/${name}`,
          { model: preset.model, settings: preset.settings, prompt: promptHash(fn, preset) },
        ]),
      ),
    ).toEqual(PRESETS)
  })

  it('gives every preset a model sold and priced for its function’s kind at the tier it asks for', async () => {
    for (const { fn, name, preset } of declared) {
      const pricing = await sellerPricing(db, preset.model, AI_FUNCTION_DEFS[fn].kind, tierOf(preset.settings))
      expect(pricing.priced, `${fn}/${name}`).toBeGreaterThan(0)
    }
  })

  it('gives every text function a ceiling and every preset a first guess', () => {
    for (const { fn, name, preset } of declared) {
      const ceiling = ceilingOf(fn, preset)
      if (AI_FUNCTION_DEFS[fn].kind === 'text') expect(ceiling, `${fn}/${name}`).toBeGreaterThan(0)
      else expect(ceiling, `${fn}/${name}`).toBeUndefined()
      expect(preset.guess.cost > 0n && preset.guess.seconds > 0, `${fn}/${name}`).toBe(true)
    }
    const ceilings = ['light-luna', 'full-terra'].map((name) => {
      const preset = presetOf('round-plan', name)
      return preset && ceilingOf('round-plan', preset)
    })
    expect(ceilings).toEqual([12_000, 24_000])
  })
})

describe('aiFunctionDef', () => {
  it('gives a function’s declaration and fails for a name that is none', () => {
    expect(aiFunctionDef('draft').kind).toBe('picture')
    expect(isAiFunction('draft')).toBe(true)
    expect(isAiFunction('flow.draft-fast')).toBe(false)
    expect(() => aiFunctionDef('flow.draft-fast')).toThrow('no AI function')
  })
})

describe('defaultPreset', () => {
  it('is the first preset a function declares', () => {
    const defaults = Object.fromEntries(AI_FUNCTIONS.map((fn): [AiFunction, string] => [fn, defaultPreset(fn)]))
    expect(defaults['round-plan']).toBe('light-luna')
    expect(defaults.draft).toBe('gpt-image-medium')
  })
})

describe('presetOf', () => {
  it('gives a preset the code has, and null for one it doesn’t', () => {
    expect(presetOf('round-plan', 'full-terra')?.model).toBe('gpt-6.1-terra')
    expect(presetOf('round-plan', 'full-sol')).toBeNull()
    expect(presetOf('round-plan', 'toString')).toBeNull()
  })
})
