import { describe, expect, it } from 'vitest'

import { type DesignSize, FRAME_GAP, ROUND_DRAFTS, SYNC_LIMITS } from '@dazbee/schema'

import { BRIEF_SCREEN_ROOM, briefPassesWarning, moreLikeSpot } from './place-brief.ts'

const EMPTY: DesignSize = { layers: 0, frames: 0, pages: 1, sections: 0, connectors: 0, bytes: 1000 }

describe('moreLikeSpot', () => {
  const square = { width: 100, height: 100 }
  const frame = (x: number, y: number, sectionId?: string) => ({
    pageId: 'p1',
    order: 'a0',
    x,
    y,
    ...square,
    sectionId,
  })
  const gap = Math.ceil(FRAME_GAP + BRIEF_SCREEN_ROOM)

  it('goes right of the liked frame’s section, at its top, below a frame in the way', () => {
    const design = {
      frames: { a: frame(0, 0, 's'), b: frame(300, 0, 's'), c: frame(400 + gap, 0) },
      sections: { s: { pageId: 'p1', title: 'Brief', order: 'a0' } },
    }
    expect(moreLikeSpot(design, 'a', square, () => 1)).toEqual({ x: 400 + gap, y: 100 + gap })
  })

  it('leaves room for the outlines at the zoom the whole page fits at, so sections apart stay apart zoomed out', () => {
    const design = { frames: { a: frame(0, 0), far: frame(20_000, 5000) }, sections: {} }
    // The page is seen at the zoom that fits 1000 px of it on screen.
    const zoomFor = (area: { width: number; height: number }) => 1000 / Math.max(area.width, area.height)
    expect(moreLikeSpot(design, 'a', square, zoomFor)?.x).toBe(100 + Math.ceil(FRAME_GAP + BRIEF_SCREEN_ROOM * 20.1))
  })

  it('goes right of the frame itself when it is in no section, and is null for a frame the design hasn’t', () => {
    const design = { frames: { a: frame(0, 0) }, sections: {} }
    expect(moreLikeSpot(design, 'a', square, () => 1)).toEqual({ x: 100 + gap, y: 0 })
    expect(moreLikeSpot(design, 'gone', square, () => 1)).toBeNull()
  })
})

describe('briefPassesWarning', () => {
  it('is false for a design well within its limits', () => {
    expect(briefPassesWarning(EMPTY)).toBe(false)
  })

  it('is true when four more frames and layers would reach the warning on layers', () => {
    const at = SYNC_LIMITS.designLayers * SYNC_LIMITS.warnAt
    expect(briefPassesWarning({ ...EMPTY, layers: at - ROUND_DRAFTS - 1 })).toBe(false)
    expect(briefPassesWarning({ ...EMPTY, layers: at - ROUND_DRAFTS })).toBe(true)
  })

  it('is true when one more section would reach the warning on sections', () => {
    expect(briefPassesWarning({ ...EMPTY, sections: SYNC_LIMITS.designSections * SYNC_LIMITS.warnAt - 1 })).toBe(true)
  })

  it('is true when the brief’s bytes would reach the warning on bytes', () => {
    expect(briefPassesWarning({ ...EMPTY, bytes: SYNC_LIMITS.designBytes * SYNC_LIMITS.warnAt - 1000 })).toBe(true)
  })
})
