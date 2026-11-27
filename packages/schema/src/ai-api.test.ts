import { describe, expect, it } from 'vitest'

import { LAYERING_CALL } from './ai-api.ts'

describe('LAYERING_CALL', () => {
  it('keeps the first frame’s plan at call 0, and numbers the other frames’ plans after every split and reading', () => {
    expect(LAYERING_CALL.plan(0)).toBe(0)
    expect([LAYERING_CALL.split(0), LAYERING_CALL.read(0), LAYERING_CALL.split(19), LAYERING_CALL.read(19)]).toEqual([
      1, 2, 39, 40,
    ])
    expect([LAYERING_CALL.plan(1), LAYERING_CALL.plan(19)]).toEqual([41, 59])
    const calls = Array.from({ length: 20 }, (_, n) => [
      LAYERING_CALL.plan(n),
      LAYERING_CALL.split(n),
      LAYERING_CALL.read(n),
    ]).flat()
    expect(new Set(calls).size).toBe(60)
  })
})
