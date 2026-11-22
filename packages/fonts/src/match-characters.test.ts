import { describe, expect, it } from 'vitest'

import { coversAll, MATCH_CHARACTERS } from './match-characters.ts'

describe('MATCH_CHARACTERS', () => {
  it('holds the 1,855 characters, each once, in the ranges’ order', () => {
    expect(MATCH_CHARACTERS).toHaveLength(1855)
    expect(new Set(MATCH_CHARACTERS).size).toBe(1855)
    expect(MATCH_CHARACTERS.slice(0, 2)).toEqual([0x20, 0x21])
    expect(MATCH_CHARACTERS.at(-1)).toBe(0x214f)
  })
})

describe('coversAll', () => {
  it('covers Latin, Hindi and Arabic text, and not an arrow', () => {
    expect(coversAll('Summer Sale — 50% off, €9.99!\nÇa coûte peu')).toBe(true)
    expect(coversAll('नमस्ते दुनिया')).toBe(true)
    expect(coversAll('مرحبا بالعالم')).toBe(true)
    expect(coversAll('→')).toBe(false)
    expect(coversAll('Go → now')).toBe(false)
  })
})
