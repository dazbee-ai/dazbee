import { describe, expect, it } from 'vitest'

import { SIZE_PRESETS } from '@dazbee/schema'

import { AI_SIZE_PRESETS, briefSaid } from './brief-box.ts'

describe('AI_SIZE_PRESETS', () => {
  it('keeps the Add a frame card’s sizes from 1:3 to 3:1, in its order, and leaves out the banners past them', () => {
    expect(AI_SIZE_PRESETS.map((p) => p.id)).toEqual(
      SIZE_PRESETS.map((p) => p.id).filter(
        (id) =>
          !['leaderboard', 'mobile-leaderboard', 'billboard', 'large-mobile-banner', 'wide-skyscraper'].includes(id),
      ),
    )
    expect(AI_SIZE_PRESETS.map((p) => p.id)).toContain('half-page')
  })
})

describe('briefSaid', () => {
  it('names each refusal’s words, and a refusal with none as not started', () => {
    expect(['used-up', 'stopped', 'not-allowed', null].map((r) => briefSaid(r as never))).toEqual([
      'usedUp',
      'paused',
      'notAllowed',
      'notStarted',
    ])
  })
})
