import { describe, expect, it } from 'vitest'

import type { TurnedRect } from '@dazbee/renderer'

import { shownBox, shownCaret } from './shown-box.ts'

/** A text's box in its frame. */
const TEXT = { x: 100, y: 200, width: 400, height: 300 }
/** Mirrored on each axis, and on neither. */
const FLIPS = [{ flipX: true }, { flipY: true }, { flipX: true, flipY: true }, {}]

/** A box's corners, clockwise from its top left, turned about it. */
function corners({ x, y, width, height, turn = 0 }: TurnedRect) {
  const [cos, sin] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)]
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([a = 0, d = 0]) => [x + cos * a - sin * d, y + sin * a + cos * d] as const)
}
/** A point mirrored about the text's centre as `flips` say. */
function mirrored([x, y]: readonly [number, number], flips: { flipX?: boolean; flipY?: boolean }) {
  return [flips.flipX ? 2 * TEXT.x + TEXT.width - x : x, flips.flipY ? 2 * TEXT.y + TEXT.height - y : y] as const
}

describe('shownBox', () => {
  it('moves a box to the text’s place, and leaves a straight one unturned', () => {
    expect(shownBox({ x: 10, y: 20, width: 30, height: 40 }, TEXT, 5)).toEqual({
      x: 110,
      y: 225,
      width: 30,
      height: 40,
    })
  })

  it('mirrors a turned box as the text is flipped: its corners are the mirrored corners', () => {
    const box = { x: 50, y: 60, width: 30, height: 40, turn: 25 }
    const moved = corners({ ...box, x: TEXT.x + box.x, y: TEXT.y + 7 + box.y })
    for (const flips of FLIPS) {
      const want = moved.map((corner) => mirrored(corner, flips))
      for (const [x, y] of corners(shownBox(box, { ...TEXT, ...flips }, 7))) {
        expect(Math.min(...want.map(([wx, wy]) => Math.hypot(wx - x, wy - y)))).toBeLessThan(1e-9)
      }
    }
  })
})

describe('shownCaret', () => {
  it('moves a caret to the text’s place, with no turn on straight text', () => {
    expect(shownCaret({ x: 10, y: 20, height: 40 }, TEXT, 5)).toEqual({ x: 110, y: 225, height: 40 })
  })

  it('keeps a turned caret on its line as the text is flipped, its ends mirrored', () => {
    const caret = { x: 50, y: 60, height: 40, turn: -30 }
    const ends = corners({ ...caret, x: TEXT.x + caret.x, y: TEXT.y + caret.y, width: 0 })
    for (const flips of FLIPS) {
      const want = ends.map((corner) => mirrored(corner, flips))
      for (const [x, y] of corners({ ...shownCaret(caret, { ...TEXT, ...flips }, 0), width: 0 })) {
        expect(Math.min(...want.map(([wx, wy]) => Math.hypot(wx - x, wy - y)))).toBeLessThan(1e-9)
      }
    }
  })
})
