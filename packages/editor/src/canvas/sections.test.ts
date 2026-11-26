import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import type { Camera } from './camera.ts'
import { type Frame, pageFrames } from './frames.ts'
import {
  outlineAround,
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

  it('stays the same size on screen at any zoom: only the frames scale', () => {
    const near = outlineAround([frame('one-mpu')], { x: 0, y: 0, zoom: 2 })
    const far = outlineAround([frame('one-mpu')], { x: 0, y: 0, zoom: 1 })
    expect([near?.width, far?.width]).toEqual([600 + 48, 300 + 48])
    expect([near?.height, far?.height]).toEqual([500 + 24 + 48 + 36, 250 + 24 + 48 + 36])
  })

  it('is none round no frames', () => {
    expect(outlineAround([], CAMERA)).toBeNull()
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

  it('finds the inside past the line, and nothing outside it', () => {
    expect(sectionHit(box, { x: 200, y: 150 })).toBe('inside')
    expect(sectionHit(box, { x: 200, y: 310 })).toBeNull()
  })
})

describe('sectionAt', () => {
  const outlines: SectionOutline[] = [
    { id: 'old', title: 'Old', box: { x: 0, y: 0, width: 400, height: 300 } },
    { id: 'new', title: 'New', box: { x: 200, y: 100, width: 400, height: 300 } },
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
