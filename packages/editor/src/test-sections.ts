// The sections' and connectors' test fixtures: one page of five frames in a row, two of them in
// section "Sale", one alone in section "Solo", the same with a connector from the third frame to the
// fifth, and where to press on the stage for a frame's label, a section's title, its outline line,
// the bare space inside it, a connector's dot or a connector's curve.
import type { DesignInput, Point } from '@dazbee/schema'

import { connectorsShown, frameEndBox } from './canvas/connectors.ts'
import { labelBox } from './canvas/frames.ts'
import { outlineScale, outlinesOf, sectionsOn, titleBox } from './canvas/sections.ts'
import type { EditorCore } from './core-interface.ts'
import { dotsOf } from './gestures/drawing/connecting.ts'

/** A white 400 × 400 frame of page p1 at x, in a section or none. */
const frame = (name: string, x: number, order: string, sectionId?: string) => ({
  pageId: 'p1',
  name,
  width: 400,
  height: 400,
  x,
  y: 0,
  order,
  ...(sectionId ? { sectionId } : {}),
})

/**
 * Five frames 200 apart on page p1: f1 and f2 in "Sale", f3 in none, f4 alone in "Solo", f5 in none;
 * and an empty second page.
 */
export const SECTIONS: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' }, p2: { name: 'Two', order: 'a1' } },
  frames: {
    f1: frame('One', 0, 'a0', 'sale'),
    f2: frame('Two', 600, 'a1', 'sale'),
    f3: frame('Three', 1200, 'a2'),
    f4: frame('Four', 1800, 'a3', 'solo'),
    f5: frame('Five', 2400, 'a4'),
  },
  sections: {
    sale: { pageId: 'p1', title: 'Sale', order: 'a0' },
    solo: { pageId: 'p1', title: 'Solo', order: 'a1' },
  },
  nodes: {
    dot: {
      type: 'graphic',
      parentId: 'f1',
      link: 'dot',
      index: 'a0',
      name: 'Dot',
      props: { x: 10, y: 10, width: 40, height: 40, rotation: 0, shape: { kind: 'ellipse' } },
    },
  },
}

/** The sections' design with connector "link" from f3 to f5, which runs under f4. */
export const CONNECTED: DesignInput = {
  ...SECTIONS,
  connectors: { link: { pageId: 'p1', from: 'f3', to: 'f5', order: 'a0' } },
}

/** The outline of a section as the stage draws it now; throws for one it draws none of. */
export function outlineOf(core: EditorCore, sectionId: string) {
  const outline = outlinesOf(sectionsOn(core.design(), core.frames()), core.camera()).find((o) => o.id === sectionId)
  if (!outline) throw new Error(`section ${sectionId} has no outline on the stage`)
  return outline.box
}

/** A stage point on a section's title. */
export function titlePoint(core: EditorCore, sectionId: string): Point {
  const box = titleBox(outlineOf(core, sectionId), outlineScale(core.camera().zoom))
  return { x: box.x + 6, y: box.y + box.height / 2 }
}

/** A stage point on the middle of a section's outline line along its bottom. */
export function linePoint(core: EditorCore, sectionId: string): Point {
  const box = outlineOf(core, sectionId)
  return { x: box.x + box.width / 2, y: box.y + box.height }
}

/** A stage point on bare space inside a section: below its title, left of its first frame. */
export function insidePoint(core: EditorCore, sectionId: string): Point {
  const box = outlineOf(core, sectionId)
  return { x: box.x + 12, y: box.y + box.height / 2 }
}

/** A stage point on a frame's label. */
export function labelPoint(core: EditorCore, frameId: string): Point {
  const frame = core.frames().find((f) => f.id === frameId)
  const row = frame && labelBox(frame, core.camera())
  if (!row) throw new Error(`frame ${frameId} has no label on the stage`)
  return { x: row.x + 4, y: row.y + row.height / 2 }
}

/** Where frame `frameId` is on the page and the section it names. */
export function placeOf(core: EditorCore, frameId: string) {
  const frame = core.design().frames[frameId]
  return frame && { x: frame.x, y: frame.y, sectionId: frame.sectionId }
}

/** The stage point of a frame's or a section's dot a connector starts from: its top, right, bottom or left. */
export function dotPoint(core: EditorCore, endId: string, side: 'top' | 'right' | 'bottom' | 'left'): Point {
  const frame = core.frames().find((f) => f.id === endId)
  const box = frame ? frameEndBox(frame, core.camera()) : outlineOf(core, endId)
  const dot = dotsOf(box)[['top', 'right', 'bottom', 'left'].indexOf(side)]
  if (!dot) throw new Error(`no ${side} dot`)
  return dot
}

/** A stage point on a connector's curve as the stage draws it now, `t` of the way along; throws for one it draws none of. */
export function curvePoint(core: EditorCore, connectorId: string, t = 0.5): Point {
  const outlines = outlinesOf(sectionsOn(core.design(), core.frames()), core.camera())
  const shown = connectorsShown(core.design(), core.frames(), outlines, core.camera()).find((c) => c.id === connectorId)
  if (!shown) throw new Error(`connector ${connectorId} is not drawn`)
  const { from, c1, c2, to } = shown.curve
  const u = 1 - t
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y }
}
