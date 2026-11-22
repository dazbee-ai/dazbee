import { describe, expect, it } from 'vitest'

import { topicsOf } from './illustration-topics.ts'

describe('topicsOf', () => {
  it('gives the topics a scene’s words put it in, a topic’s own word and two words joined counting', () => {
    expect(topicsOf(['breakfast'])).toEqual(['food'])
    expect(topicsOf(['Mobile', 'Pay'])).toEqual(expect.arrayContaining(['app', 'payment']))
    expect(topicsOf(['ice', 'cream'])).toEqual(['food'])
    expect(topicsOf(['delivery'])).toEqual(['delivery'])
    expect(topicsOf(['apple'])).toEqual([])
  })
})
