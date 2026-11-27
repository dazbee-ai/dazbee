import { describe, expect, it } from 'vitest'

import { type Design, FRAME_GAP } from '@dazbee/schema'

import type { Camera } from './camera.ts'
import { type Frame, pageFrames } from './frames.ts'
import {
  outlineAbove,
  outlineAround,
  outlineRoom,
  outlineScale,
  outlinesOf,
  sectionAt,
  sectionHit,
  type SectionOutline,
  sectionsOn,
  titleBox,
} from './sections.ts'
import { design } from './test-design.ts'

/** The test design's page `one` with the square and the story in "Sale", the MPU in "Later", and "Gone" named by no frame. */
const sectioned: Design = {
  ...design,
  sections: {
    sale: { pageId: 'one', title: 'Sale', order: 'a0' },
    later: { pageId: 'one', title: 'Later', order: 'a1' },
    gone: { pageId: 'one', title: 'Gone', order: 'a2' },
  },
  frames: {
    ...design.frames,
    'one-sq': { ...(design.frames['one-sq'] as Design['frames'][string]), sectionId: 'sale' },
    'one-story': { ...(design.frames['one-story'] as Design['frames'][string]), sectionId: 'sale' },
    'one-mpu': { ...(design.frames['one-mpu'] as Design['frames'][string]), sectionId: 'later' },
  },
}
const { frames } = pageFrames(sectioned, 'one')
/** Half size, the page's origin 100 px right and 200 px down. */
const CAMERA: Camera = { x: 100, y: 200, zoom: 0.5 }
const frame = (id: string) => frames.find((f) => f.id === id) as Frame

describe('sectionsOn', () => {
  it("lists the page's drawn sections by order, each with its frames as the canvas shows them", () => {
    expect(
      sectionsOn(sectioned, frames).map(({ id, title, frames: held }) => [id, title, held.map((f) => f.id)]),
    ).toEqual([
      ['sale', 'Sale', ['one-sq', 'one-story']],
      ['later', 'Later', ['one-mpu']],
    ])
  })

  it('lists none for a page whose frames name no section', () => {
    expect(sectionsOn(design, frames)).toEqual([])
  })
})

describe('outlineAround', () => {
  it('fits round the frames and their labels on screen, padded 24 px, with 36 px more at the top for the title', () => {
    // The square and the story span 0..2360 by 0..1920 on the page: 100..1280 by 200..1160 on screen,
    // their labels 24 px above.
    expect(outlineAround([frame('one-sq'), frame('one-story')], CAMERA)).toEqual({
      x: 100 - 24,
      y: 200 - 24 - 24 - 36,
      width: 1180 + 48,
      height: 960 + 24 + 48 + 36,
    })
  })

  it('stays the same size on screen at any zoom from 25% up: only the frames scale', () => {
    const near = outlineAround([frame('one-mpu')], { x: 0, y: 0, zoom: 2 })
    const far = outlineAround([frame('one-mpu')], { x: 0, y: 0, zoom: 1 })
    expect([near?.width, far?.width]).toEqual([600 + 48, 300 + 48])
    expect([near?.height, far?.height]).toEqual([500 + 24 + 48 + 36, 250 + 24 + 48 + 36])
  })

  it('shrinks its pad and its title row with the page below 25% zoom, the labels’ row staying 24 px', () => {
    // At 12.5%, half of 25%, the 300 × 250 frame is 37.5 × 31.25 px, the pad 12 px and the title row 18 px.
    expect(outlineAround([frame('one-mpu')], { x: 0, y: 0, zoom: 0.125 })).toEqual({
      x: 320 - 12,
      y: -24 - 12 - 18,
      width: 37.5 + 24,
      height: 31.25 + 24 + 24 + 18,
    })
  })

  it('is none round no frames', () => {
    expect(outlineAround([], CAMERA)).toBeNull()
  })
})

describe('outlineScale', () => {
  it('is 1 from 25% zoom up, and falls in step with the zoom below it', () => {
    expect([1, 0.25, 0.125, 0.05].map(outlineScale)).toEqual([1, 1, 0.5, 0.2])
  })
})

describe('outlineRoom', () => {
  it('is the design pixels the outlines, the title and the labels take at 25% zoom, for sections seen closer', () => {
    // 24 + 24 + 36 px of outline and title and 24 px of labels, at 25%.
    expect(outlineRoom(1)).toBe(108 / 0.25)
    expect(outlineRoom(0.25)).toBe(108 / 0.25)
  })

  it('grows only by the labels’ row for sections seen further out, whose outlines shrink', () => {
    expect(outlineRoom(0.1)).toBe(84 / 0.25 + 24 / 0.1)
  })

  it('keeps two rows of frames placed that far and a frame gap apart from running into each other at any zoom down to 10%', () => {
    const row = (y: number): Frame => ({
      id: `row-${y}`,
      pageId: 'one',
      name: 'Row',
      x: 0,
      y,
      width: 1080,
      height: 1080,
    })
    const lower = 1080 + FRAME_GAP + outlineRoom(1)
    for (const zoom of [2, 1, 0.5, 0.25, 0.2, 0.15, 0.1]) {
      const camera = { x: 0, y: 0, zoom }
      const above = outlineAround([row(0)], camera)
      const below = outlineAround([row(lower)], camera)
      expect((below?.y ?? 0) - ((above?.y ?? 0) + (above?.height ?? 0)), `at ${zoom}`).toBeGreaterThanOrEqual(-1e-9)
    }
  })
})

describe('outlineAbove', () => {
  it('is the screen pixels of the labels’ row, the pad and the title’s row over a section’s frames', () => {
    expect(outlineAbove(1)).toBe(24 + 24 + 36)
    expect(outlineAbove(0.125)).toBe(24 + 12 + 18)
  })
})

describe('outlinesOf', () => {
  it("gives each section's outline and title, by order", () => {
    const outlines = outlinesOf(sectionsOn(sectioned, frames), CAMERA)
    expect(outlines.map((o) => [o.id, o.title])).toEqual([
      ['sale', 'Sale'],
      ['later', 'Later'],
    ])
    expect(outlines[1]?.box).toEqual(outlineAround([frame('one-mpu')], CAMERA))
    expect(outlines.map((o) => o.scale)).toEqual([1, 1])
  })

  it('tells how far the outlines are shrunk, zoomed out below 25%', () => {
    const [outline] = outlinesOf(sectionsOn(sectioned, frames), { x: 0, y: 0, zoom: 0.05 })
    expect(outline?.scale).toBeCloseTo(0.2)
  })
})

describe('titleBox', () => {
  it('sits inside the outline at its top left, as wide as the outline leaves room for', () => {
    const box = { x: 10, y: 20, width: 400, height: 300 }
    const title = titleBox(box)
    expect(title.x).toBeGreaterThan(box.x)
    expect(title.y).toBeGreaterThan(box.y)
    expect(title.x + title.width).toBeLessThan(box.x + box.width)
    expect(title.y + title.height).toBeLessThanOrEqual(box.y + 36)
  })

  it('sits and stands half as far in and half as tall in an outline drawn at half its size', () => {
    const box = { x: 10, y: 20, width: 400, height: 300 }
    const [full, half] = [titleBox(box), titleBox(box, 0.5)]
    expect(half.x - box.x).toBe((full.x - box.x) / 2)
    expect(half.y - box.y).toBe((full.y - box.y) / 2)
    expect(half.height).toBe(full.height / 2)
    expect(half.width).toBe(box.width - 2 * (half.x - box.x))
  })
})

describe('sectionHit', () => {
  const box = { x: 0, y: 0, width: 400, height: 300 }

  it('finds the outline line within 6 px either side of it, along its sides', () => {
    expect(sectionHit(box, { x: 200, y: 0 })).toBe('line')
    expect(sectionHit(box, { x: 200, y: -6 })).toBe('line')
    expect(sectionHit(box, { x: 405, y: 150 })).toBe('line')
    expect(sectionHit(box, { x: 200, y: 294 })).toBe('line')
  })

  it('follows the rounded corner: its square corner is outside', () => {
    expect(sectionHit(box, { x: -1, y: -1 })).toBeNull()
    // On the 22 px arc, about 6.4 px in from the corner along the diagonal.
    expect(sectionHit(box, { x: 6.4, y: 6.4 })).toBe('line')
  })

  it('follows the smaller corner of an outline drawn at half its size', () => {
    // Outside the 22 px arc by more than 6 px, and on the 11 px arc's line.
    expect(sectionHit(box, { x: 1, y: 1 })).toBeNull()
    expect(sectionHit(box, { x: 1, y: 1 }, 0.5)).toBe('line')
  })

  it('finds the inside past the line, and nothing outside it', () => {
    expect(sectionHit(box, { x: 200, y: 150 })).toBe('inside')
    expect(sectionHit(box, { x: 200, y: 310 })).toBeNull()
  })
})

describe('sectionAt', () => {
  const outlines: SectionOutline[] = [
    { id: 'old', title: 'Old', box: { x: 0, y: 0, width: 400, height: 300 }, scale: 1 },
    { id: 'new', title: 'New', box: { x: 200, y: 100, width: 400, height: 300 }, scale: 1 },
  ]

  it('gives the later section where two outlines hold a point', () => {
    expect(sectionAt(outlines, { x: 300, y: 200 })?.id).toBe('new')
    expect(sectionAt(outlines, { x: 100, y: 100 })?.id).toBe('old')
  })

  it('gives a section by its line alone when asked for lines', () => {
    expect(sectionAt(outlines, { x: 300, y: 200 }, ['line'])).toBeUndefined()
    expect(sectionAt(outlines, { x: 300, y: 2 }, ['line'])?.id).toBe('old')
  })

  it('gives none off every outline', () => {
    expect(sectionAt(outlines, { x: 700, y: 700 })).toBeUndefined()
  })
})
