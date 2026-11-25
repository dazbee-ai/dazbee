import { describe, expect, it, vi } from 'vitest'

import type { AiStepModelView } from '@dazbee/schema'

import { modelChoices, stepRowKey } from './ai-step-models.tsx'

vi.mock('@/app/pilot/ai/actions.ts', () => ({}))

/** Resize, running seedream-5.5, with the picture models it may run. */
const RESIZE: AiStepModelView = {
  step: 'flow.resize',
  kind: 'picture',
  model: 'seedream-5.5',
  models: ['gpt-image-2.5-sunburst', 'seedream-5.5'],
  options: {},
  source: 'override',
  updatedAt: '2026-11-25T10:00:00.000Z',
}

describe('stepRowKey', () => {
  it('changes when a step following its kind gets a new default, so its row shows the new model', () => {
    const following: AiStepModelView = { ...RESIZE, source: 'kind', updatedAt: null }
    expect(stepRowKey({ ...following, model: 'gpt-image-2.5-sunburst' })).not.toBe(stepRowKey(following))
  })
})

describe('modelChoices', () => {
  it('offers the step’s models and shows the one picked', () => {
    expect(modelChoices(RESIZE, 'gpt-image-2.5-sunburst')).toEqual({
      choices: ['gpt-image-2.5-sunburst', 'seedream-5.5'],
      shown: 'gpt-image-2.5-sunburst',
    })
  })

  it('shows the step’s own model once the picked one is no longer of its kind', () => {
    expect(modelChoices(RESIZE, 'trial-pic-1').shown).toBe('seedream-5.5')
  })

  it('keeps offering the step’s own model when it is no longer of the step’s kind', () => {
    expect(modelChoices({ ...RESIZE, model: 'gpt-6-luna' }, 'gpt-6-luna')).toEqual({
      choices: ['gpt-6-luna', 'gpt-image-2.5-sunburst', 'seedream-5.5'],
      shown: 'gpt-6-luna',
    })
  })
})
