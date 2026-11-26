import { describe, expect, it } from 'vitest'

import { SIZE_PRESETS } from '@dazbee/schema'

import { AI_SIZE_PRESETS, briefKey, briefSaid, otherMode, shapeIn } from './brief-box.ts'

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

describe('briefKey', () => {
  const key = (k: string, shiftKey = false, isComposing = false) => briefKey({ key: k, shiftKey, isComposing })

  it('makes the drafts on Enter and closes the box on Escape', () => {
    expect([key('Enter'), key('Escape')]).toEqual(['make', 'close'])
  })

  it('leaves Shift+Enter to the text, which keeps the line break, and Enter while an input method composes', () => {
    expect([key('Enter', true), key('Enter', false, true), key('a')]).toEqual([null, null, null])
  })
})

describe('otherMode', () => {
  it('turns Fast to Precise and back', () => {
    expect([otherMode('fast'), otherMode('precise')]).toEqual(['precise', 'fast'])
  })
})

describe('shapeIn', () => {
  it('draws a size to fit the box, its longer side the box’s, its shape kept', () => {
    expect(shapeIn({ width: 1080, height: 1920 }, 16)).toEqual({ width: 9, height: 16 })
    expect(shapeIn({ width: 1080, height: 1080 }, 16)).toEqual({ width: 16, height: 16 })
  })

  it('keeps a thin side at least 3 pixels', () => {
    expect(shapeIn({ width: 300, height: 900 }, 6)).toEqual({ width: 3, height: 6 })
  })
})

describe('briefSaid', () => {
  it('names each refusal’s words, and a refusal with none as not started', () => {
    expect(['used-up', 'stopped', 'not-allowed', null].map((r) => briefSaid({ refusal: r as never }))).toEqual([
      'usedUp',
      'paused',
      'notAllowed',
      'notStarted',
    ])
  })

  it('says a job saved whose drafts the design didn’t take is not placed', () => {
    expect(briefSaid({ refusal: null, notPlaced: true })).toBe('notPlaced')
    expect(briefSaid({ refusal: null, unknown: true })).toBe('unknown')
  })
})
