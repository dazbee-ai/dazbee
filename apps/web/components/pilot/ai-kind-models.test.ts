import { describe, expect, it, vi } from 'vitest'

import type { AiKindModelView } from '@dazbee/schema'

import { warnsBeforeSwitch } from './ai-kind-models.tsx'

vi.mock('@/app/pilot/ai/actions.ts', () => ({}))

/** The picture default, Muse, followed by the Fast draft. */
const PICTURE: AiKindModelView = {
  kind: 'picture',
  model: 'muse-image-1.0',
  models: ['muse-image-1.0', 'seedream-5.5'],
  options: {},
  steps: ['flow.draft-fast'],
  updatedAt: '2026-11-25T10:00:00.000Z',
}

describe('warnsBeforeSwitch', () => {
  it('warns once before a default with steps following it changes model', () => {
    expect(warnsBeforeSwitch(PICTURE, 'seedream-5.5', null)).toBe(true)
    expect(warnsBeforeSwitch(PICTURE, 'seedream-5.5', 'seedream-5.5')).toBe(false)
  })

  it('saves at once when the model stays or no step follows the default', () => {
    expect(warnsBeforeSwitch(PICTURE, 'muse-image-1.0', null)).toBe(false)
    expect(warnsBeforeSwitch({ ...PICTURE, steps: [] }, 'seedream-5.5', null)).toBe(false)
  })
})
