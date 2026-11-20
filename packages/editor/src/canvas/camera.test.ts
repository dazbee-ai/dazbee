import { describe, expect, it } from 'vitest'

import { intersects } from '@dazbee/doc'
import { FRAME_GAP, type Rect } from '@dazbee/schema'

import {
  coverOf,
  fit,
  framesInView,
  MAX_ZOOM,
  MIN_ZOOM,
  reveal,
  revealBeside,
  revealLabel,
  revealWhole,
  toScreen,
  toWorld,
  under,
  visibleRect,
  widen,
  ZOOM_STEPS,
  zoomAt,
  zoomPercent,
  zoomStep,
} from './camera.ts'
import { pageFrames } from './frames.ts'
import { design } from './test-design.ts'

const page = pageFrames(design, 'one')
const bounds = page.bounds as Rect
const frames = page.frames

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed while zooming', () => {
    const camera = { x: 40, y: -12, zoom: 0.3 }
    const at = { x: 517, y: 233 }
    const before = toWorld(camera, at)
    for (const zoom of [0.05, 1, 7.5]) {
      const after = toWorld(zoomAt(camera, at, zoom), at)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  })
})

describe('zoomPercent', () => {
  it('is the zoom in whole percent, a half rounded up', () => {
    expect([0.8, 1, 0.126, 0.125, 0.124, 0.015, 63.996].map(zoomPercent)).toEqual([80, 100, 13, 13, 12, 2, 6400])
  })
})

describe('zoomStep', () => {
  it('goes from each step to the one above and the one below, and nowhere past the first and the last', () => {
    expect(ZOOM_STEPS).toEqual([1, 2, 3, 6, 13, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400])
    const zooms = ZOOM_STEPS.map((percent) => percent / 100)
    expect(zooms.map((zoom) => zoomStep(zoom, 'in'))).toEqual([...zooms.slice(1), null])
    expect(zooms.map((zoom) => zoomStep(zoom, 'out'))).toEqual([null, ...zooms.slice(0, -1)])
  })

  it('goes from between two steps to the step above and the one below the percent shown', () => {
    // [zoom in percent, the step zoom in goes to, the step zoom out goes to], in percent.
    const cases: [number, number, number | null][] = [
      [1.4, 2, null],
      [2.4, 3, 1],
      [4, 6, 3],
      [10, 13, 6],
      [12.4, 13, 6],
      [12.6, 25, 6],
      [20, 25, 13],
      [40, 50, 25],
      [80, 100, 50],
      [150, 200, 100],
      [300, 400, 200],
      [600, 800, 400],
      [1000, 1600, 800],
      [2500, 3200, 1600],
      [5000, 6400, 3200],
    ]
    for (const [percent, up, down] of cases) {
      expect(zoomStep(percent / 100, 'in'), `${percent}% in`).toBe(up / 100)
      expect(zoomStep(percent / 100, 'out'), `${percent}% out`).toBe(down === null ? null : down / 100)
    }
  })

  it('goes nowhere in from a zoom shown as the top step, nor out from one shown as the bottom', () => {
    expect(zoomStep(MAX_ZOOM, 'in')).toBeNull()
    expect(zoomStep(63.996, 'in')).toBeNull()
    expect(zoomStep(MIN_ZOOM, 'out')).toBeNull()
    expect(zoomStep(0.0104, 'out')).toBeNull()
  })
})

describe('fit', () => {
  it('fits a rect inside the viewport, centred, and sees what it fits', () => {
    const viewport = { width: 1280, height: 800 }
    const camera = fit(bounds, viewport, 48)
    const topLeft = toScreen(camera, bounds)
    const bottomRight = toScreen(camera, { x: bounds.width, y: bounds.height })
    expect(topLeft.x).toBeGreaterThanOrEqual(48 - 1e-9)
    expect(topLeft.y).toBeGreaterThanOrEqual(48 - 1e-9)
    expect(bottomRight.x).toBeLessThanOrEqual(1280 - 48 + 1e-9)
    expect(bottomRight.y).toBeLessThanOrEqual(800 - 48 + 1e-9)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(640)
    for (const frame of frames) expect(intersects(frame, visibleRect(camera, viewport))).toBe(true)
  })

  it('fits between the floating chrome, centred in the clear part of the stage', () => {
    const viewport = { width: 1440, height: 850 }
    const insets = { top: 0, right: 320, bottom: 72, left: 76 }
    const camera = fit(bounds, viewport, 48, insets)
    const topLeft = toScreen(camera, bounds)
    const bottomRight = toScreen(camera, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })
    expect(topLeft.x).toBeGreaterThanOrEqual(76 + 48 - 1e-9)
    expect(bottomRight.x).toBeLessThanOrEqual(1440 - 320 - 48 + 1e-9)
    expect(bottomRight.y).toBeLessThanOrEqual(850 - 72 - 48 + 1e-9)
    // Centred between the capsule and the cards, not on the whole stage.
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(76 + (1440 - 76 - 320) / 2)
    expect(fit(bounds, viewport, 48, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual(fit(bounds, viewport, 48))
  })

  it('on a phone fits the ads to its width and puts them at the top of the clear part', () => {
    const viewport = { width: 390, height: 760 }
    const insets = { top: 64, right: 0, bottom: 150, left: 0 }
    const camera = fit(bounds, viewport, undefined, insets)
    const topLeft = toScreen(camera, bounds)
    const bottomRight = toScreen(camera, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })
    expect(topLeft.y).toBeCloseTo(64 + 32)
    expect(topLeft.x).toBeGreaterThanOrEqual(16 - 1e-9)
    expect(bottomRight.x).toBeLessThanOrEqual(390 - 16 + 1e-9)
    expect(bottomRight.y).toBeLessThanOrEqual(760 - 150 - 16 + 1e-9)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(195)
  })
})

describe('reveal', () => {
  const viewport = { width: 1000, height: 800 }
  const insets = { top: 60, right: 300, bottom: 0, left: 0 }
  const camera = { x: 100, y: 100, zoom: 0.5 }

  it('keeps the camera when the clear part of the stage shows the rect whole, with room for its label', () => {
    expect(reveal(camera, { x: 0, y: 0, width: 1080, height: 1080 }, viewport, insets)).toBe(camera)
  })

  it('pans, at the same zoom, to centre a rect that runs off the clear part of the stage, with its label over it', () => {
    const next = reveal(camera, { x: 1280, y: 0, width: 1080, height: 1080 }, viewport, insets)
    expect(next.zoom).toBe(0.5)
    const topLeft = toScreen(next, { x: 1280, y: 0 })
    const bottomRight = toScreen(next, { x: 2360, y: 1080 })
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(350)
    // The label's 24 px row and the rect are centred together between the top inset and the bottom.
    expect((topLeft.y - 24 + bottomRight.y) / 2).toBeCloseTo(430)
  })

  it('keeps the zoom for a rect too big for the clear part, centring it with its label over it', () => {
    const story = { x: 1280, y: 0, width: 1080, height: 1920 }
    const next = reveal(camera, story, viewport, insets)
    expect(next.zoom).toBe(0.5)
    const topLeft = toScreen(next, story)
    const bottomRight = toScreen(next, { x: 2360, y: 1920 })
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(350)
    expect((topLeft.y - 24 + bottomRight.y) / 2).toBeCloseTo(430)
  })
})

describe('revealBeside', () => {
  // A phone, its chrome at the top keeping 190 px clear, and the layers panel covering all below 233.
  const viewport = { width: 390, height: 844 }
  const insets = { top: 190, right: 0, bottom: 0, left: 0 }
  const cover = { bottom: 611 }
  const camera = { x: 16, y: 222, zoom: 0.1 }
  const square = { x: 0, y: 0, width: 1080, height: 1080 }

  it('centres a rect that fits between the chrome and the panel, with its label over it', () => {
    const next = revealBeside(camera, square, viewport, { ...insets, top: 60 }, cover)
    expect(next.zoom).toBe(0.1)
    expect((toScreen(next, square).y - 24 + toScreen(next, { x: 0, y: 1080 }).y) / 2).toBeCloseTo((60 + 233) / 2)
  })

  it('keeps a rect too tall for the room above the panel clear of the panel, its top under the chrome', () => {
    const next = revealBeside(camera, square, viewport, insets, cover)
    expect(next.zoom).toBe(0.1)
    expect(toScreen(next, { x: 0, y: 1080 }).y).toBeCloseTo(233)
    expect(toScreen(next, square).y).toBeLessThan(190)
  })

  it('gives back the camera it returned, so a rect revealed again stays put, its label under the chrome or not', () => {
    const tall = revealBeside(camera, square, viewport, insets, cover)
    expect(toScreen(tall, square).y - 24).toBeLessThan(190)
    expect(revealBeside(tall, square, viewport, insets, cover)).toEqual(tall)
    const roomy = revealBeside(camera, square, viewport, { ...insets, top: 60 }, cover)
    expect(toScreen(roomy, square).y - 24).toBeGreaterThanOrEqual(60)
    expect(revealBeside(roomy, square, viewport, { ...insets, top: 60 }, cover)).toEqual(roomy)
  })

  it('keeps a rect too wide for the room beside a side panel clear of the panel', () => {
    const wide = { x: 0, y: 0, width: 4000, height: 400 }
    const next = revealBeside({ x: 0, y: 0, zoom: 0.5 }, wide, { width: 1440, height: 1000 }, insets, { left: 472 })
    expect(toScreen(next, wide).x).toBeCloseTo(472)
    const sideways = revealBeside({ x: 0, y: 0, zoom: 0.5 }, wide, { width: 1440, height: 1000 }, insets, {
      right: 472,
    })
    expect(toScreen(sideways, { x: 4000, y: 0 }).x).toBeCloseTo(968)
  })

  it('keeps the camera when the clear part shows the rect whole, with room for its label', () => {
    const low = { x: 0, y: 0, zoom: 0.1 }
    expect(revealBeside({ ...low, y: 100 }, square, viewport, { ...insets, top: 0 }, cover)).toEqual({ ...low, y: 100 })
  })
})

describe('revealWhole', () => {
  const viewport = { width: 1000, height: 800 }
  const insets = { top: 60, right: 300, bottom: 0, left: 0 }
  /** Whether a rect shows whole on the stage, 16 px in from the clear part's edges, with its label's row over it. */
  const clear = (
    c: { x: number; y: number; zoom: number },
    rect: Rect,
    size: typeof viewport,
    edges: typeof insets,
  ) => {
    const topLeft = toScreen(c, rect)
    const bottomRight = toScreen(c, { x: rect.x + rect.width, y: rect.y + rect.height })
    return (
      topLeft.x >= edges.left + 16 - 1e-9 &&
      topLeft.y - 24 >= edges.top + 16 - 1e-9 &&
      bottomRight.x <= size.width - edges.right - 16 + 1e-9 &&
      bottomRight.y <= size.height - edges.bottom - 16 + 1e-9
    )
  }

  it('keeps the camera when the clear part of the stage shows the rect whole, with room for its label', () => {
    const camera = { x: 100, y: 100, zoom: 0.5 }
    expect(revealWhole(camera, { x: 0, y: 0, width: 1080, height: 1080 }, viewport, insets)).toBe(camera)
  })

  it('pans the least that brings a rect and its label 16 px in from the edges they are past, never centring them', () => {
    // At 50% the rect is 1000 to 1200 across and 0 to 200 down: past the panel's edge at 700, and
    // over the top, whose label row needs 60 + 24.
    const camera = { x: 0, y: 0, zoom: 0.5 }
    const offRight = { x: 2000, y: 0, width: 400, height: 400 }
    expect(revealWhole(camera, offRight, viewport, insets)).toEqual({ x: 684 - 1200, y: 100, zoom: 0.5 })
    // Along an axis that shows it already, the camera stays.
    const below = { x: 200, y: 2000, width: 400, height: 400 }
    expect(revealWhole(camera, below, viewport, insets)).toEqual({ x: 0, y: 784 - 1200, zoom: 0.5 })
  })

  it('zooms out about the middle of the stage, then pans the least', () => {
    const desk = { width: 1280, height: 760 }
    const deskInsets = { top: 136, right: 0, bottom: 72, left: 96 }
    const half = { x: 2680, y: 0, width: 300, height: 600 }
    const zoom = (760 - 136 - 72 - 24 - 32) / 600
    const next = revealWhole({ x: 0, y: 0, zoom: 1 }, half, desk, deskInsets)
    // Its end 16 px in from the stage's right edge, its top 16 px under its label's row.
    expect(next.zoom).toBeCloseTo(zoom)
    expect(next.x).toBeCloseTo(1264 - (2680 + 300) * zoom)
    expect(next.y).toBeCloseTo(136 + 24 + 16)
    // Where a part of the rect shows after the zoom along an axis, that axis keeps where the zoom put it.
    const below = { x: 0, y: 2000, width: 300, height: 600 }
    const zoomed = revealWhole({ x: 200, y: 0, zoom: 1 }, below, desk, deskInsets)
    expect(zoomed.zoom).toBeCloseTo(zoom)
    expect(zoomed.x).toBeCloseTo(640 - (640 - 200) * zoom)
  })

  it('zooms out only as far as a rect too big for the clear part needs to show whole, its label clear of the top', () => {
    // A phone at 100%, under the islands and Pages, over the tab bar: a 1080 square.
    const phone = { width: 390, height: 844 }
    const phoneInsets = { top: 132, right: 0, bottom: 84, left: 0 }
    const square = { x: 0, y: 0, width: 1080, height: 1080 }
    const next = revealWhole({ x: 0, y: 0, zoom: 1 }, square, phone, phoneInsets)
    // The width is what limits it: 390 less 16 on each side.
    expect(next.zoom).toBeCloseTo(358 / 1080)
    expect(clear(next, square, phone, phoneInsets)).toBe(true)
    // A desktop at 100% under the islands, over the dock: a 300 × 600 half page.
    const desk = { width: 1280, height: 760 }
    const deskInsets = { top: 136, right: 0, bottom: 72, left: 96 }
    const half = { x: 2680, y: 0, width: 300, height: 600 }
    const fitted = revealWhole({ x: 0, y: 0, zoom: 1 }, half, desk, deskInsets)
    expect(fitted.zoom).toBeCloseTo((760 - 136 - 72 - 24 - 32) / 600)
    expect(clear(fitted, half, desk, deskInsets)).toBe(true)
  })

  it('never zooms in, and keeps the zoom for a rect that fits', () => {
    const story = { x: 1280, y: 0, width: 1080, height: 1920 }
    const tablet = { width: 820, height: 1180 }
    const tabletInsets = { top: 136, right: 0, bottom: 72, left: 96 }
    const far = revealWhole({ x: 0, y: 0, zoom: 0.25 }, story, tablet, tabletInsets)
    expect(far.zoom).toBe(0.25)
    expect(clear(far, story, tablet, tabletInsets)).toBe(true)
    const half = revealWhole({ x: 0, y: 0, zoom: 0.5 }, story, tablet, tabletInsets)
    expect(half.zoom).toBeLessThan(0.5)
    expect(clear(half, story, tablet, tabletInsets)).toBe(true)
  })

  it('without zooming out, pans the least at the same zoom', () => {
    // A phone under the islands, over a low sheet whose top is 437 px down: a 150 px tall layer at 400 to 550.
    const phone = { width: 390, height: 844 }
    const overSheet = { top: 190, right: 0, bottom: 844 - 437 + 12, left: 0 }
    const layer = { x: 100, y: 400, width: 200, height: 150 }
    // Its bottom 16 px over the sheet's 12 px gap, at 409.
    expect(revealWhole({ x: 0, y: 0, zoom: 1 }, layer, phone, overSheet, { zoomOut: false })).toEqual({
      x: 0,
      y: 409 - 550,
      zoom: 1,
    })
  })

  it('without zooming out, brings the top of a rect taller than the room 16 px under its label row, unless it is there already', () => {
    const phone = { width: 390, height: 844 }
    const overSheet = { top: 190, right: 0, bottom: 844 - 437 + 12, left: 0 }
    const tall = { x: 16, y: 500, width: 358, height: 358 }
    const next = revealWhole({ x: 0, y: 0, zoom: 1 }, tall, phone, overSheet, { zoomOut: false })
    expect(next).toEqual({ x: 0, y: 190 + 24 + 16 - 500, zoom: 1 })
    // A whole frame fitted at the top, 32 px under the islands: its top shows, so nothing moves.
    const fitted = { x: 0, y: 0, zoom: 1 }
    const background = { x: 16, y: 222, width: 358, height: 358 }
    expect(revealWhole(fitted, background, phone, overSheet, { zoomOut: false })).toBe(fitted)
  })
})

describe('revealLabel', () => {
  const viewport = { width: 1000, height: 800 }
  const insets = { top: 60, right: 0, bottom: 80, left: 90 }
  const square = { x: 0, y: 0, width: 1080, height: 1080 }

  it('keeps the camera when the clear part of the stage shows the label over the frame’s top start corner', () => {
    const camera = { x: 200, y: 160, zoom: 0.5 }
    expect(revealLabel(camera, square, viewport, insets)).toBe(camera)
  })

  it('pans down and along, at the same zoom, to a label above and before the stage, as at 375% on the frame’s middle', () => {
    const camera = { x: 500 - 540 * 3.75, y: 400 - 540 * 3.75, zoom: 3.75 }
    const next = revealLabel(camera, square, viewport, insets)
    expect(next.zoom).toBe(3.75)
    expect(toScreen(next, { x: 0, y: 0 })).toEqual({ x: 106, y: 100 })
  })

  it('pans only down to a label above the stage whose corner is in from the start', () => {
    const next = revealLabel({ x: 300, y: -300, zoom: 0.5 }, square, viewport, insets)
    expect(next).toEqual({ x: 300, y: 100, zoom: 0.5 })
  })

  it('pans up and back to a label past the stage’s end and bottom, leaving room for its name', () => {
    const next = revealLabel({ x: 1200, y: 900, zoom: 1 }, square, viewport, insets)
    expect(toScreen(next, { x: 0, y: 0 })).toEqual({ x: 864, y: 704 })
  })
})

describe('coverOf', () => {
  const stage = { x: 0, y: 0, width: 1440, height: 1000 }

  it('covers the side a panel floats on, past its edge by the gap', () => {
    expect(coverOf({ x: 116, y: 80, width: 344, height: 600 }, stage)).toEqual({ left: 472 })
    expect(coverOf({ x: 980, y: 80, width: 344, height: 600 }, stage)).toEqual({ right: 472 })
  })

  it('covers the bottom for a panel across most of the stage, as on a phone', () => {
    expect(coverOf({ x: 12, y: 245, width: 366, height: 472 }, { x: 0, y: 0, width: 390, height: 844 })).toEqual({
      bottom: 611,
    })
  })

  it('measures from the stage, wherever it is on the page', () => {
    expect(coverOf({ x: 216, y: 180, width: 344, height: 600 }, { ...stage, x: 100, y: 100 })).toEqual({ left: 472 })
  })
})

describe('under', () => {
  const camera = { x: 100, y: 200, zoom: 0.5 }
  const stage = { x: 0, y: 50, width: 820, height: 1130 }
  const panel = { x: 116, y: 120, width: 301, height: 200 }

  it('says whether a rect shows under a panel over the stage, both at their places on the page', () => {
    // On screen at 100,200 to 640,740 on the stage, 250 down the page: under the panel's start.
    expect(under(camera, { x: 0, y: 0, width: 1080, height: 1080 }, panel, stage)).toBe(true)
    // Below the panel, from 350 down the page, past its bottom at 320.
    expect(under(camera, { x: 0, y: 200, width: 1080, height: 1080 }, panel, stage)).toBe(false)
    // Past its end.
    expect(under(camera, { x: 700, y: 0, width: 400, height: 400 }, panel, stage)).toBe(false)
  })
})

describe('widen', () => {
  it('keeps each edge clear of the chrome and of what covers it, the larger of the two', () => {
    const chrome = { top: 70, right: 12, bottom: 90, left: 96 }
    expect(widen(chrome, { left: 472 })).toEqual({ top: 70, right: 12, bottom: 90, left: 472 })
    expect(widen(chrome, { bottom: 40, top: 20 })).toEqual(chrome)
    expect(widen(chrome, {})).toEqual(chrome)
  })
})

describe('framesInView', () => {
  it('draws the frames the viewport shows any part of, and only those', () => {
    const viewport = { width: 1000, height: 600 }
    // At 100%, from one-story's top start corner: a 1000 × 600 part of it only.
    const story = frames.find((f) => f.id === 'one-story') ?? { x: 0, y: 0 }
    expect(framesInView(frames, { x: -story.x, y: -story.y, zoom: 1 }, viewport).map((f) => f.id)).toEqual([
      'one-story',
    ])
    // Moved the gap and one pixel toward the start, one-sq's last column of pixels shows too.
    expect(
      framesInView(frames, { x: -story.x + FRAME_GAP + 1, y: -story.y, zoom: 1 }, viewport).map((f) => f.id),
    ).toEqual(['one-sq', 'one-story'])
    expect(framesInView(frames, fit(bounds, viewport), viewport)).toHaveLength(3)
  })
})
