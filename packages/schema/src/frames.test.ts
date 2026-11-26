import { describe, expect, it } from 'vitest'

import { parseDesign } from './design.ts'
import {
  blankDesign,
  coverFrame,
  FRAME_GAP,
  frameIdOf,
  framesOf,
  freeSpot,
  NEW_FRAME_FILLS,
  newFramePosition,
} from './frames.ts'

const frame = (pageId: string, order: string) => ({
  pageId,
  name: 'F',
  width: 100,
  height: 100,
  x: 0,
  y: 0,
  fills: [],
  order,
})

describe('framesOf', () => {
  it("lists a page's frames by order, ties broken by id", () => {
    const frames = {
      c: frame('p1', 'a2'),
      other: frame('p2', 'a0'),
      b2: frame('p1', 'a1'),
      a: frame('p1', 'a0'),
      b1: frame('p1', 'a1'),
    }
    expect(framesOf({ frames }, 'p1').map(([id]) => id)).toEqual(['a', 'b1', 'b2', 'c'])
    expect(framesOf({ frames }, 'p2')).toEqual([['other', frames.other]])
    expect(framesOf({ frames }, 'p3')).toEqual([])
  })
})

describe('coverFrame', () => {
  it('is the first frame of the first page', () => {
    const pages = { p2: { name: 'Two', order: 'a1' }, p1: { name: 'One', order: 'a0' } }
    const frames = { late: frame('p1', 'a1'), first: frame('p1', 'a0'), two: frame('p2', 'a0') }
    expect(coverFrame({ pages, frames })).toEqual(['first', frames.first])
  })

  it('skips pages with no frame, and is undefined when no page has one', () => {
    const pages = { p1: { name: 'One', order: 'a0' }, p2: { name: 'Two', order: 'a1' } }
    const two = frame('p2', 'a0')
    expect(coverFrame({ pages, frames: { two } })).toEqual(['two', two])
    expect(coverFrame({ pages, frames: {} })).toBeUndefined()
  })
})

describe('newFramePosition', () => {
  it('puts the first frame at 0, 0', () => {
    expect(newFramePosition([])).toEqual({ x: 0, y: 0 })
  })

  it("puts a frame 200 px right of the page's rightmost frame, its top aligned with that frame's", () => {
    expect(FRAME_GAP).toBe(200)
    const frames = [
      { x: 0, y: 40, width: 1080 },
      { x: 600, y: -300, width: 728 },
      { x: 1200, y: 90, width: 100 },
    ]
    expect(newFramePosition(frames)).toEqual({ x: 1528, y: -300 })
  })

  it('takes the first in the list of frames whose right edges tie', () => {
    const frames = [
      { x: 0, y: 10, width: 500 },
      { x: 400, y: 20, width: 100 },
    ]
    expect(newFramePosition(frames)).toEqual({ x: 700, y: 10 })
  })
})

describe('freeSpot', () => {
  const at = (pageId: string, x: number, y: number, width: number, height: number) => ({
    ...frame(pageId, 'a0'),
    x,
    y,
    width,
    height,
  })

  it('is FRAME_GAP right of the source, at its top, where nothing is in the way', () => {
    const frames = { src: at('p1', 0, 50, 100, 100) }
    expect(freeSpot({ frames }, 'p1', { width: 80, height: 80 }, { x: 0, y: 50, width: 100, height: 100 })).toEqual({
      x: 100 + FRAME_GAP,
      y: 50,
    })
  })

  it('moves down below each frame of the page it would overlap, plus FRAME_GAP, until it overlaps none', () => {
    const from = { x: 0, y: 0, width: 100, height: 100 }
    const frames = {
      src: at('p1', 0, 0, 100, 100),
      // In the way at the first try, then the next one is, below it.
      first: at('p1', 350, 50, 100, 100),
      second: at('p1', 250, 300, 100, 100),
      // Clear of the box: right of it, and on another page.
      right: at('p1', 400, 360, 100, 100),
      other: at('p2', 300, 550, 100, 100),
    }
    expect(freeSpot({ frames }, 'p1', { width: 100, height: 100 }, from)).toEqual({ x: 300, y: 400 + FRAME_GAP })
  })

  it('steps around the boxes of the page’s drawn sections, all but the one the copy joins', () => {
    const from = { x: 0, y: 0, width: 100, height: 100 }
    // Section "row" spans 300…400 × 0…600, empty between its two frames; "empty" draws nothing.
    const frames = {
      src: at('p1', 0, 0, 100, 100),
      top: { ...at('p1', 300, 0, 100, 100), sectionId: 'row' },
      bottom: { ...at('p1', 300, 500, 100, 100), sectionId: 'row' },
    }
    const sections = { row: { pageId: 'p1', order: 'a0' }, empty: { pageId: 'p1', order: 'a1' } }
    const size = { width: 100, height: 100 }
    expect(freeSpot({ frames, sections }, 'p1', size, from)).toEqual({ x: 300, y: 600 + FRAME_GAP })
    expect(freeSpot({ frames, sections }, 'p1', size, from, 'row')).toEqual({ x: 300, y: 100 + FRAME_GAP })
  })

  it('takes a frame touching its edge as out of the way', () => {
    const frames = { below: at('p1', 300, 100, 100, 100) }
    expect(freeSpot({ frames }, 'p1', { width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      x: 300,
      y: 0,
    })
  })
})

describe('frameIdOf', () => {
  /** Frame `sq` holds a box `f` with a group `g` inside, which holds `a`; `d` sits in frame `two`; `x` and `y` hold each other. */
  const design = {
    frames: { sq: frame('p1', 'a0'), two: frame('p2', 'a0') },
    nodes: {
      f: { parentId: 'sq' },
      g: { parentId: 'f' },
      a: { parentId: 'g' },
      d: { parentId: 'two' },
      x: { parentId: 'y' },
      y: { parentId: 'x' },
    },
  }

  it('is the frame a layer is in, however deep, and a frame for itself', () => {
    expect(frameIdOf(design, 'a')).toBe('sq')
    expect(frameIdOf(design, 'f')).toBe('sq')
    expect(frameIdOf(design, 'd')).toBe('two')
    expect(frameIdOf(design, 'two')).toBe('two')
  })

  it('is undefined for an id that is neither a layer nor a frame, a page included, and for a loop', () => {
    expect(frameIdOf(design, 'missing')).toBeUndefined()
    expect(frameIdOf(design, 'p1')).toBeUndefined()
    expect(frameIdOf(design, 'constructor')).toBeUndefined()
    expect(frameIdOf(design, 'x')).toBeUndefined()
  })
})

describe('blankDesign', () => {
  it('is one page holding an empty white frame of each size, in a row by the frame rule', () => {
    const design = blankDesign({ designId: 'd1', name: 'Blank' }, [
      { name: 'Feed square', width: 1080, height: 1080 },
      { name: 'Story and Reel', width: 1080, height: 1920 },
    ])
    expect(design).toEqual({
      meta: { designId: 'd1', name: 'Blank' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: {
        f1: {
          pageId: 'p1',
          name: 'Feed square',
          width: 1080,
          height: 1080,
          x: 0,
          y: 0,
          fills: NEW_FRAME_FILLS,
          order: 'a0',
        },
        f2: {
          pageId: 'p1',
          name: 'Story and Reel',
          width: 1080,
          height: 1920,
          x: 1280,
          y: 0,
          fills: NEW_FRAME_FILLS,
          order: 'a1',
        },
      },
      nodes: {},
    })
    expect(NEW_FRAME_FILLS).toEqual([{ type: 'solid', color: '#FFFFFFFF' }])
    expect(parseDesign(design).success).toBe(true)
  })
})
