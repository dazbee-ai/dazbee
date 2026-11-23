import { describe, expect, it } from 'vitest'

import { nearestNames } from './nearest-names.ts'

describe('nearestNames', () => {
  it('gives the names nearest in spelling, nearest first, ties in the order given', () => {
    const names = ['frame.add', 'frame.update', 'node.create', 'frame.delete', 'page.move']
    expect(nearestNames('frame.create', names, 3)).toEqual(['frame.update', 'node.create', 'frame.delete'])
  })

  it('gives every name when there are no more than it is asked for', () => {
    expect(nearestNames('x', ['b', 'a'], 5)).toEqual(['b', 'a'])
  })
})
