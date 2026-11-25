import { describe, expect, it } from 'vitest'

import { AiStepsInput, referenceCount } from './ai.ts'

describe('AiStepsInput', () => {
  it('reads a call saved as a picture edit as a picture call with its references', () => {
    const saved = {
      calls: [
        {
          step: 'refine',
          input: { kind: 'picture-edit', prompt: 'Make it square.', pictures: ['k'], width: 1024, height: 1024 },
        },
      ],
    }
    expect(AiStepsInput.parse(saved).calls[0]?.input).toEqual({
      kind: 'picture',
      prompt: 'Make it square.',
      pictures: ['k'],
      width: 1024,
      height: 1024,
    })
  })

  it('refuses marks with no picture, and more than 16 references counting the marked copy', () => {
    const picture = { kind: 'picture', prompt: 'A cup.', width: 1024, height: 1024 }
    const parse = (input: object) => AiStepsInput.safeParse({ calls: [{ step: 'refine', input }] }).success
    expect(parse({ ...picture, pictures: [], marks: 'm' })).toBe(false)
    expect(parse({ ...picture, pictures: Array.from({ length: 16 }, (_, i) => `k${i}`), marks: 'm' })).toBe(false)
    expect(parse({ ...picture, pictures: Array.from({ length: 15 }, (_, i) => `k${i}`), marks: 'm' })).toBe(true)
    expect(parse(picture)).toBe(true)
  })
})

describe('referenceCount', () => {
  it('counts the pictures and the marked copy', () => {
    expect(referenceCount({ pictures: ['a', 'b'] })).toBe(2)
    expect(referenceCount({ pictures: ['a'], marks: 'm' })).toBe(2)
  })
})
