import { describe, expect, it } from 'vitest'

import { CallOutput, CallsInput, referenceCount } from './ai.ts'

/** A layer split's stored output of one split layer, with no split pieces. */
const layers = {
  kind: 'layers',
  layers: [{ key: 'originals/l0', width: 1024, height: 1024, assetId: 'l0' }],
  gpuSeconds: 21.5,
}

/** A stored split piece of a text part, and the backdrop, of no part and not yet recorded as an asset. */
const piece = {
  picture: { key: 'originals/p0', width: 300, height: 80, assetId: 'p0' },
  x: 40,
  y: 60,
  part: 'e1',
  kind: 'text',
  layer: 1,
  turned: { cx: 190, cy: 100, width: 300, height: 80, angle: 0 },
}
const backdrop = {
  picture: { key: 'originals/p1', width: 1024, height: 1024 },
  x: 0,
  y: 0,
  part: null,
  kind: 'background',
  layer: 2,
  turned: null,
}

/** The stored split pieces of a 1024 px picture. */
const pieces = {
  width: 1024,
  height: 1024,
  items: [piece, backdrop],
  stuck: ['e4'],
  closeness: { mean: 1.2, off: 2.7 },
  seconds: 4.6,
}

describe('CallOutput', () => {
  it('reads a split’s stored layers with no split pieces, as stored before there were any', () => {
    const output = CallOutput.parse(layers)
    expect(output.kind === 'layers' && output.pieces).toBeUndefined()
  })

  it('reads a split’s stored layers whose split pieces are null, as the layer split answers with none', () => {
    const output = CallOutput.parse({ ...layers, pieces: null })
    expect(output.kind === 'layers' && output.pieces).toBeNull()
  })

  it('reads a split’s stored layers with its split pieces, each a stored picture and its facts', () => {
    const output = CallOutput.parse({ ...layers, pieces })
    expect(output.kind === 'layers' && output.pieces).toEqual(pieces)
  })

  it('refuses split pieces whose piece has no picture or no place', () => {
    const parse = (item: object) => CallOutput.safeParse({ ...layers, pieces: { ...pieces, items: [item] } }).success
    expect(parse({ ...piece, picture: undefined })).toBe(false)
    expect(parse({ ...piece, x: -1 })).toBe(false)
    expect(parse(piece)).toBe(true)
  })
})

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
