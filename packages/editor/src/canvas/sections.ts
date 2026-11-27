// The sections of the shown page as the stage draws them (ADR-0024): each drawn section with its
// frames, its outline in screen pixels round them and their labels, its title's box, what a point of
// the stage is on, and the section on top at a point. Zoomed out below SHRINK_BELOW, an outline's pad,
// title row and corners shrink with the page, so sections placed with `outlineRoom` between them never
// run into each other.
import { type Design, type Point, type Rect, sectionsOf } from '@dazbee/schema'

import { type Camera, toScreen } from './camera.ts'
import { type Frame, LABEL_ROOM } from './frames.ts'

/** A drawn section of the shown page with the frames in it, as the canvas shows them, by order. */
export interface SectionFrames {
  id: string
  title: string
  frames: Frame[]
}
/** A section's outline on the stage, in screen pixels, with its title, and how much of their full size its pad, title and corners are drawn at. */
export interface SectionOutline {
  id: string
  title: string
  box: Rect
  scale: number
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
/** The zoom below which an outline's pad, title row and corners shrink with the page. */
export const SHRINK_BELOW = 0.25

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

/** How much of their full size an outline's pad, title row and corners are drawn at, at `zoom`: all of it from SHRINK_BELOW up, then in step with the zoom. */
export function outlineScale(zoom: number): number {
  return Math.min(1, zoom / SHRINK_BELOW)
}

/**
 * The design pixels between a section's frames and the frames before them that their outlines, the title's row and
 * the frames' labels take, for sections seen at `zoom` or closer: the room they take on screen at SHRINK_BELOW, where
 * the outlines stop growing, or at `zoom` when that is further out. Further out than that the outlines shrink with
 * the page and only the labels' row, which doesn't, needs more: the frame gap a placement adds covers it down to
 * about 8% zoom.
 */
export function outlineRoom(zoom: number): number {
  return (2 * OUTLINE_PAD + TITLE_ROW) / SHRINK_BELOW + LABEL_ROOM / Math.min(zoom, SHRINK_BELOW)
}

/** The screen pixels an outline takes above its frames at `zoom`: their labels' row, its pad and its title's row. */
export function outlineAbove(zoom: number): number {
  return LABEL_ROOM + (OUTLINE_PAD + TITLE_ROW) * outlineScale(zoom)
}

/**
 * The outline round frames on the stage, in screen pixels: the union of their boxes and their
 * labels' rows, padded OUTLINE_PAD, and TITLE_ROW more at the top, both at the camera's scale
 * (`outlineScale`); null round none.
 */
export function outlineAround(frames: readonly Frame[], camera: Camera): Rect | null {
  if (frames.length === 0) return null
  const pad = OUTLINE_PAD * outlineScale(camera.zoom)
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const frame of frames) {
    const at = toScreen(camera, frame)
    left = Math.min(left, at.x)
    top = Math.min(top, at.y - LABEL_ROOM)
    right = Math.max(right, at.x + frame.width * camera.zoom)
    bottom = Math.max(bottom, at.y + frame.height * camera.zoom)
  }
  const y = top - pad - TITLE_ROW * outlineScale(camera.zoom)
  return { x: left - pad, y, width: right - left + 2 * pad, height: bottom + pad - y }
}

/** Each section's outline at the camera, in their order. */
export function outlinesOf(sections: readonly SectionFrames[], camera: Camera): SectionOutline[] {
  return sections.flatMap(({ id, title, frames }) => {
    const box = outlineAround(frames, camera)
    return box ? [{ id, title, box, scale: outlineScale(camera.zoom) }] : []
  })
}

/**
 * Where a section's title goes inside its outline's top left, as wide as the outline leaves it, in screen pixels,
 * for an outline drawn at `scale` of its full size.
 */
export function titleBox(outline: Rect, scale = 1): Rect {
  return {
    x: outline.x + TITLE_INSET * scale,
    y: outline.y + TITLE_TOP * scale,
    width: Math.max(0, outline.width - 2 * TITLE_INSET * scale),
    height: TITLE_HEIGHT * scale,
  }
}

/**
 * What a stage point is on of an outline drawn at `scale` of its full size: its line, rounded at the corners,
 * within OUTLINE_REACH either side; inside it, past the line; or null outside it.
 */
export function sectionHit(outline: Rect, p: Point, scale = 1): SectionPart | null {
  const away = roundedDistance(outline, p, OUTLINE_RADIUS * scale)
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
    const part = sectionHit(outline.box, p, outline.scale)
    return part !== null && parts.includes(part)
  })
}

/** How far a point is from the edge of a box with corners of `corner` radius: below 0 inside it. */
function roundedDistance(box: Rect, p: Point, corner: number) {
  const radius = Math.min(corner, box.width / 2, box.height / 2)
  const qx = Math.abs(p.x - (box.x + box.width / 2)) - (box.width / 2 - radius)
  const qy = Math.abs(p.y - (box.y + box.height / 2)) - (box.height / 2 - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}
