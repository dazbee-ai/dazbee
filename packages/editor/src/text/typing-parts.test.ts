import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Rect } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { textParts } from './typing-parts.ts'

/** An element as the parts build one: its class, the box it was placed over and its style. */
interface Fake {
  className: string
  box?: Rect
  style: Record<string, string>
}
const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
/** Places a part as the overlay does: its box kept, and its width set as a style. */
const placeBox = (el: HTMLElement, _frame: Frame, box: Rect) => {
  const part = el as unknown as Fake
  part.box = box
  part.style.width = `${box.width}px`
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (): Fake => ({ className: '', style: {} }) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('textParts', () => {
  it('builds nothing with no text shown', () => {
    expect(textParts(null, placeBox)).toEqual([])
  })

  it('places a box over each part of the selected range', () => {
    const range = [
      { x: 10, y: 10, width: 80, height: 24 },
      { x: 10, y: 34, width: 30, height: 24 },
    ]
    const parts = textParts({ frame: SQUARE, range, caret: null }, placeBox) as unknown as Fake[]
    expect(parts.map((part) => [part.className, part.box])).toEqual(range.map((box) => ['text-selection', box]))
  })

  it('places a line under each part of a composition, with no height of its own, and the caret', () => {
    const lines = [
      { x: 10, y: 30, width: 80, height: 0 },
      { x: 10, y: 54, width: 30, height: 0 },
    ]
    const caret = { x: 40, y: 34, height: 24 }
    const parts = textParts({ frame: SQUARE, range: [], caret, composition: lines }, placeBox) as unknown as Fake[]
    expect(parts.map((part) => [part.className, part.box, part.style.height])).toEqual([
      ...lines.map((box) => ['text-composition', box, '']),
      ['caret', { ...caret, width: 0 }, undefined],
    ])
  })

  it('places the caret with no width of its own, so its style sheet gives it one', () => {
    const [caret] = textParts(
      { frame: SQUARE, range: [], caret: { x: 40, y: 10, height: 24 } },
      placeBox,
    ) as unknown as Fake[]
    expect(caret).toEqual({ className: 'caret', box: { x: 40, y: 10, width: 0, height: 24 }, style: { width: '' } })
  })

  it('turns a part of a curved text about its corner, as its box is turned', () => {
    const box = { x: 10, y: 10, width: 30, height: 24, turn: 20 }
    const caret = { x: 40, y: 10, height: 24, turn: -15 }
    const [selected] = textParts({ frame: SQUARE, range: [box], caret: null }, placeBox) as unknown as Fake[]
    expect(selected?.style).toMatchObject({ transform: 'rotate(20deg)', transformOrigin: '0 0' })
    const [shown] = textParts({ frame: SQUARE, range: [], caret }, placeBox) as unknown as Fake[]
    expect(shown?.style).toMatchObject({ transform: 'rotate(-15deg)', transformOrigin: '0 0' })
  })
})
