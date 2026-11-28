// The ids of the layers and groups Make editable's finish places.
import { describe, expect, it } from 'vitest'

import { pieceGroupId, pieceId } from './layer-pieces.ts'

describe('pieceId', () => {
  it('comes from the job, the frame and the layer, at most 64 characters', () => {
    expect(pieceId('job', 'frame', 2)).toBe('job-frame-2')
    expect(pieceId('j'.repeat(40), 'f'.repeat(40), 12)).toHaveLength(64)
  })

  it('gives the first layer a matcher rebuilt a piece as the piece’s own id, and the others ids no piece has', () => {
    expect(pieceId('job', 'frame', 2, 0)).toBe('job-frame-2')
    expect(pieceId('job', 'frame', 2, 1)).toBe('job-frame-2_1')
    expect(pieceId('j'.repeat(40), 'f'.repeat(40), 12, 3)).toHaveLength(64)
    expect(pieceId('j'.repeat(40), 'f'.repeat(40), 12, 3).endsWith('-12_3')).toBe(true)
  })
})

describe('pieceGroupId', () => {
  it('comes from the job, the frame and the piece, is no layer’s id, and is at most 64 characters', () => {
    expect(pieceGroupId('job', 'frame', 2)).toBe('job-frame-2_group')
    const layers = [0, 1, 2, 3].map((nth) => pieceId('job', 'frame', 2, nth))
    expect(layers).not.toContain(pieceGroupId('job', 'frame', 2))
    expect(pieceGroupId('j'.repeat(40), 'f'.repeat(40), 12)).toHaveLength(64)
    expect(pieceGroupId('j'.repeat(40), 'f'.repeat(40), 12).endsWith('-12_group')).toBe(true)
  })
})
