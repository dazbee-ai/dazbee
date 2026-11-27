// The round plan's call: what every call of a preset starts with alike, and what a brief adds after it.
import { describe, expect, it } from 'vitest'

import type { RoundInput } from '@dazbee/schema'

import { LIKED_DRAFT, ROUND_DIRECTOR } from '../prompts/ads/round-director.ts'
import { planCall } from './round-plan.ts'

/** A round's input with `changes` over a plain brief. */
function roundOf(changes: Partial<RoundInput>): RoundInput {
  return {
    words: 'A spring sale for a coffee shop',
    pictures: [],
    size: { width: 1080, height: 1080 },
    mode: 'precise',
    brand: { name: 'Harbour Coffee', colors: ['#103b2a'], fonts: ['Fraunces'], voice: 'Warm and plain' },
    ...changes,
  } as RoundInput
}

describe('planCall', () => {
  it('starts every call of a preset alike: the director and the answer’s shape, whatever the brief', () => {
    const plain = planCall(roundOf({}), null, ROUND_DIRECTOR)
    const other = planCall(
      roundOf({
        words: 'Winter boots, 30% off',
        pictures: ['a'],
        logoKey: 'logo',
        size: { width: 1080, height: 1920 },
      }),
      { kind: 'liked', key: 'liked' },
      ROUND_DIRECTOR,
    )
    expect(plain.kind === 'text' && other.kind === 'text').toBe(true)
    if (plain.kind !== 'text' || other.kind !== 'text') return
    expect(plain.instructions).toBe(ROUND_DIRECTOR)
    expect(other.instructions).toBe(ROUND_DIRECTOR)
    expect(other.schema).toEqual(plain.schema)
    // Nothing of a brief is in the part the calls share.
    expect(other.instructions).not.toContain('Winter boots')
  })

  it('puts what a brief adds after the director, the advertiser’s own words last', () => {
    const call = planCall(
      roundOf({ pictures: ['a'], logoKey: 'logo' }),
      { kind: 'liked', key: 'liked' },
      ROUND_DIRECTOR,
    )
    if (call.kind !== 'text') throw new Error('the round plan is a text call')
    const at = (part: string) => call.prompt.indexOf(part)
    const order = [
      at('The canvas: square, 1080 × 1080 px.'),
      at("The brand's facts:"),
      at('The attached pictures, in order:'),
      at(LIKED_DRAFT),
      at('What the advertiser asks for:\nA spring sale for a coffee shop'),
    ]
    expect(order.every((position) => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(call.prompt.endsWith('What the advertiser asks for:\nA spring sale for a coffee shop')).toBe(true)
    expect(call.pictures).toEqual(['liked', 'a', 'logo'])
  })
})
