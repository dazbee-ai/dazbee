import { describe, expect, it } from 'vitest'

import { renameFieldBox } from './section-title.ts'

describe('renameFieldBox', () => {
  it('is the title’s own box at its full size', () => {
    const title = { x: 30, y: 34, width: 360, height: 18 }
    expect(renameFieldBox(title)).toEqual(title)
  })

  it('keeps a full title’s height over a title drawn smaller, zoomed far out, so its text shows whole', () => {
    expect(renameFieldBox({ x: 22, y: 28.4, width: 376, height: 10.8 })).toEqual({
      x: 22,
      y: 28.4,
      width: 376,
      height: 18,
    })
  })
})
