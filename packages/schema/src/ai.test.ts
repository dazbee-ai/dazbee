import { describe, expect, it } from 'vitest'

import { CallsInput, referenceCount } from './ai.ts'

describe('CallsInput', () => {
  it('refuses marks with no picture, and more than 16 references counting the marked copy', () => {
    const picture = { kind: 'picture', prompt: 'A cup.', width: 1024, height: 1024 }
    const parse = (input: object) =>
      CallsInput.safeParse({ calls: [{ function: 'refine-edit', preset: 'seedream', input }] }).success
    expect(parse({ ...picture, pictures: [], marks: 'm' })).toBe(false)
    expect(parse({ ...picture, pictures: Array.from({ length: 16 }, (_, i) => `k${i}`), marks: 'm' })).toBe(false)
    expect(parse({ ...picture, pictures: Array.from({ length: 15 }, (_, i) => `k${i}`), marks: 'm' })).toBe(true)
    expect(parse(picture)).toBe(true)
  })

  it('refuses a call that names no AI function or no preset', () => {
    const input = { kind: 'text', instructions: 'Read.', prompt: 'An ad.' }
    expect(CallsInput.safeParse({ calls: [{ function: 'reading', preset: 'luna', input }] }).success).toBe(true)
    expect(CallsInput.safeParse({ calls: [{ function: 'reading', input }] }).success).toBe(false)
    expect(CallsInput.safeParse({ calls: [{ preset: 'luna', input }] }).success).toBe(false)
  })
})

describe('referenceCount', () => {
  it('counts the pictures and the marked copy', () => {
    expect(referenceCount({ pictures: ['a', 'b'] })).toBe(2)
    expect(referenceCount({ pictures: ['a'], marks: 'm' })).toBe(2)
  })
})
