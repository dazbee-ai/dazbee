// The sections of the shown page as the stage draws them (ADR-0024): each drawn section with its
// frames, its outline in screen pixels round them and their labels, its title's box, what a point of
// the stage is on, and the section on top at a point.
import { type Design, type Point, type Rect, sectionsOf } from '@dazbee/schema'

import { type Camera, toScreen } from './camera.ts'
import { type Frame, LABEL_ROOM } from './frames.ts'

/** A drawn section of the shown page with the frames in it, as the canvas shows them, by order. */
export interface SectionFrames {
  id: string
  title: string
  frames: Frame[]
}
/** A section's outline on the stage, in screen pixels, with its title. */
export interface SectionOutline {
  id: string
  title: string
  box: Rect
}
/** The sections as the stage shows them: their outlines, by order, and the one lit as a drop's target. */
export interface ShownSections {
  outlines: SectionOutline[]
  lit: string | null
}
/** What a point of the stage is on, of a section: its outline line, or inside it. */
export type SectionPart = 'line' | 'inside'

/** Screen pixels an outline keeps round its frames and their labels, and more at its top for the title's row. */
export const OUTLINE_PAD = 24
export const TITLE_ROW = 36
/** The outline's corner radius, in screen pixels. */
export const OUTLINE_RADIUS = 22
/** How far either side of the outline's line a press still takes it, in screen pixels. */
export const OUTLINE_REACH = 6

/** Where the title sits inside the outline's top left, and its height, in screen pixels. */
const TITLE_INSET = 20
const TITLE_TOP = 14
const TITLE_HEIGHT = 18

/** The page's drawn sections, by order, ties by id, each with its frames of `frames` (the shown page's), by order. */
export function sectionsOn(design: Design, frames: readonly Frame[]): SectionFrames[] {
  const [first] = frames
  if (!first) return []
  const held = new Map<string, Frame[]>()
  for (const frame of frames) {
    const sectionId = design.frames[frame.id]?.sectionId
    if (sectionId !== undefined) held.set(sectionId, [...(held.get(sectionId) ?? []), frame])
  }
  return sectionsOf(design, first.pageId).flatMap(([id, { title }]) => {
    const inside = held.get(id)
    return inside ? [{ id, title, frames: inside }] : []
  })
}

/**
 * The outline round frames on the stage, in screen pixels: the union of their boxes and their
 * labels' rows, padded OUTLINE_PAD, and TITLE_ROW more at the top; null round none.
 */
export function outlineAround(frames: readonly Frame[], camera: Camera): Rect | null {
  if (frames.length === 0) return null
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const frame of frames) {
    const at = toScreen(camera, frame)
    left = Math.min(left, at.x)
    top = Math.min(top, at.y - LABEL_ROOM)
    right = Math.max(right, at.x + frame.width * camera.zoom)
    bottom = Math.max(bottom, at.y + frame.height * camera.zoom)
  }
  const y = top - OUTLINE_PAD - TITLE_ROW
  return { x: left - OUTLINE_PAD, y, width: right - left + 2 * OUTLINE_PAD, height: bottom + OUTLINE_PAD - y }
}

/** Each section's outline at the camera, in their order. */
export function outlinesOf(sections: readonly SectionFrames[], camera: Camera): SectionOutline[] {
  return sections.flatMap(({ id, title, frames }) => {
    const box = outlineAround(frames, camera)
    return box ? [{ id, title, box }] : []
  })
}

/** Where a section's title goes inside its outline's top left, as wide as the outline leaves it, in screen pixels. */
export function titleBox(outline: Rect): Rect {
  return {
    x: outline.x + TITLE_INSET,
    y: outline.y + TITLE_TOP,
    width: Math.max(0, outline.width - 2 * TITLE_INSET),
    height: TITLE_HEIGHT,
  }
}

/**
 * What a stage point is on of an outline: its line, rounded at the corners, within OUTLINE_REACH
 * either side; inside it, past the line; or null outside it.
 */
export function sectionHit(outline: Rect, p: Point): SectionPart | null {
  const away = roundedDistance(outline, p)
  if (Math.abs(away) <= OUTLINE_REACH) return 'line'
  return away < 0 ? 'inside' : null
}

/** The section on top at a stage point, the later of those whose part there is one of `parts`: their line or their inside unless told. */
export function sectionAt(
  outlines: readonly SectionOutline[],
  p: Point,
  parts: readonly SectionPart[] = ['line', 'inside'],
): SectionOutline | undefined {
  return outlines.findLast((outline) => {
    const part = sectionHit(outline.box, p)
    return part !== null && parts.includes(part)
  })
}

/** How far a point is from the edge of a box with OUTLINE_RADIUS corners: below 0 inside it. */
function roundedDistance(box: Rect, p: Point) {
  const radius = Math.min(OUTLINE_RADIUS, box.width / 2, box.height / 2)
  const qx = Math.abs(p.x - (box.x + box.width / 2)) - (box.width / 2 - radius)
  const qy = Math.abs(p.y - (box.y + box.height / 2)) - (box.height / 2 - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}
