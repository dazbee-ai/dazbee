// The AI functions' presets: each stays what it was when it was measured, and each names a model that is sold.
import { describe, expect, it } from 'vitest'

import { AI_FUNCTIONS, type AiFunction } from '@dazbee/schema'

import { REFERENCE_READER } from '../prompts/ads/reference.ts'
import { ROUND_DIRECTOR } from '../prompts/ads/round-director.ts'
import { sellerPricing } from '../seller-route.ts'
import { tierOf } from '../sellers/tiers.ts'
import { db } from '../test-ai.ts'
import { aiFunctionDef, ceilingOf, defaultPreset, isAiFunction, presetOf, promptHash, promptOf } from './ai-function.ts'

/**
 * Each preset's model, settings, ceiling and the SHA-256 of the prompt it runs with, as merged. A preset is never
 * edited: new words, another model, another setting or another ceiling is a new preset under a new name, added here.
 */
const PRESETS: Record<
  string,
  { model: string; settings: Record<string, unknown>; ceiling: number | null; prompt: string | null }
> = {
  'reference-read/luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'low', tier: 'fast' },
    ceiling: 2000,
    prompt: '42dac42b6d07034ecfeae2ed53800dc4dac484a722a93f0711c03d5f2f9becb6',
  },
  'round-plan/light-luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'low', tier: 'fast' },
    ceiling: 12_000,
    prompt: 'd2217e5b700f5b41e5cc64efd9e15d3ee8bf035547420c21f2e5336d29d5ae91',
  },
  'round-plan/full-terra': {
    model: 'gpt-6.1-terra',
    settings: { effort: 'low', tier: 'standard' },
    ceiling: 24_000,
    prompt: 'a491ac956961bf4ea47f7b1fd7d02598ad2a5b2dec31fc0728c482798d637d82',
  },
  'draft/gpt-image-medium': {
    model: 'gpt-image-2.5-sunburst',
    settings: { quality: 'medium' },
    ceiling: null,
    prompt: '322e17447ae22e6b8c729397c9c6314125a8c913dd8bbe5620cb0421f77036f8',
  },
  'refine-plan/luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'low', tier: 'fast' },
    ceiling: 4000,
    prompt: '22b3d630e1fe056dabad7757421d73eee31c38ae40c5649cce0d464f4131d6c8',
  },
  'refine-edit/seedream': { model: 'seedream-5.5', settings: {}, ceiling: null, prompt: null },
  'resize/seedream': {
    model: 'seedream-5.5',
    settings: {},
    ceiling: null,
    prompt: 'c1811c6c05e2aee856db5bac679a2004c0a9c153b1c5a8e001f929aec38692c4',
  },
  'layer-plan/sol': {
    model: 'gpt-6.2-sol',
    settings: { effort: 'medium', tier: 'standard' },
    ceiling: 16_000,
    prompt: 'cc38fc937840c67fc6ed1e34495b2ac2d6431286ac8cefd04f58c4a14eec2a34',
  },
  'layer-split/ming': { model: 'ming-image-0.1-design-layer', settings: {}, ceiling: null, prompt: null },
  'reading/luna': {
    model: 'gpt-6-luna',
    settings: { effort: 'none', tier: 'standard' },
    ceiling: 8000,
    prompt: '1b160606f459f65cd7fb27d45b5d21e7aa31dd6137d0681fa190cf63755ac504',
  },
  'image/muse': { model: 'muse-image-1.0', settings: {}, ceiling: null, prompt: null },
}

/** Every preset of every AI function, by `function/preset`. */
const declared = AI_FUNCTIONS.flatMap((fn) =>
  Object.entries(aiFunctionDef(fn).presets).map(([name, preset]) => ({ fn, name, preset })),
)

describe('AI_FUNCTION_DEFS', () => {
  it('keeps each preset’s model, settings, ceiling and prompt as they were merged under its name', () => {
    expect(
      Object.fromEntries(
        declared.map(({ fn, name, preset }) => [
          `${fn}/${name}`,
          {
            model: preset.model,
            settings: preset.settings,
            ceiling: ceilingOf(fn, preset) ?? null,
            prompt: promptHash(fn, preset),
          },
        ]),
      ),
    ).toEqual(PRESETS)
  })

  it('names each preset in small letters, digits and hyphens, starting with a letter', () => {
    for (const { fn, name } of declared) expect(name, `${fn}/${name}`).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('gives every preset a model sold and priced for its function’s kind at the tier it asks for', async () => {
    for (const { fn, name, preset } of declared) {
      const pricing = await sellerPricing(db, preset.model, aiFunctionDef(fn).kind, tierOf(preset.settings))
      expect(pricing.priced, `${fn}/${name}`).toBeGreaterThan(0)
    }
  })

  it('gives every preset a first guess', () => {
    for (const { fn, name, preset } of declared) {
      expect(preset.guess.cost > 0n && preset.guess.seconds > 0, `${fn}/${name}`).toBe(true)
    }
  })
})

describe('isAiFunction', () => {
  it('knows an AI function’s name from an AI step’s', () => {
    expect(isAiFunction('draft')).toBe(true)
    expect(isAiFunction('flow.draft-fast')).toBe(false)
  })
})

describe('aiFunctionDef', () => {
  it('gives a function’s declaration and fails for a name that is none', () => {
    expect(aiFunctionDef('draft').kind).toBe('picture')
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
    expect(presetOf('no-such-function', 'luna')).toBeNull()
  })
})

describe('promptOf', () => {
  it('is the preset’s own prompt, or else its function’s, and none for a function with no words', () => {
    const full = presetOf('round-plan', 'full-terra')
    const luna = presetOf('reference-read', 'luna')
    const ming = presetOf('layer-split', 'ming')
    expect(full && promptOf('round-plan', full)).toBe(ROUND_DIRECTOR)
    expect(luna && promptOf('reference-read', luna)).toBe(REFERENCE_READER)
    expect(ming && promptOf('layer-split', ming)).toBeUndefined()
  })
})

describe('promptHash', () => {
  it('is null for a function with no words', () => {
    const ming = presetOf('layer-split', 'ming')
    expect(ming && promptHash('layer-split', ming)).toBeNull()
  })
})

describe('ceilingOf', () => {
  it('is the preset’s own ceiling, or else its function’s, and none for a call that isn’t text', () => {
    const ceilings = (['light-luna', 'full-terra'] as const).map((name) => {
      const preset = presetOf('round-plan', name)
      return preset && ceilingOf('round-plan', preset)
    })
    expect(ceilings).toEqual([12_000, 24_000])
    const luna = presetOf('reading', 'luna')
    const draft = presetOf('draft', 'gpt-image-medium')
    expect(luna && ceilingOf('reading', luna)).toBe(8000)
    expect(draft && ceilingOf('draft', draft)).toBeUndefined()
  })
})
