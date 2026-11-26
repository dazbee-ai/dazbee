// A page's sections and connectors (ADR-0024): the two records, and where they are on a design. A
// section is a title and an order, drawn around the frames that name it; a connector joins two of
// a page's frames or sections. Their references are loose: readers take a missing one as absent.
import { z } from 'zod'

import { FractionalIndex, Id, inOrder, PageId } from './primitives.ts'

export const SectionId = Id
export type SectionId = z.infer<typeof SectionId>
export const ConnectorId = Id
export type ConnectorId = z.infer<typeof ConnectorId>

/** The longest section title, as a frame's name. */
export const MAX_SECTION_TITLE = 120

/** A titled group of a page's frames: each frame in it names it (`sectionId`). Its outline fits around them. */
export const Section = z.object({
  pageId: PageId,
  /** Stored as written, so it is checked, not trimmed: commands trim what they take. */
  title: z
    .string()
    .min(1)
    .max(MAX_SECTION_TITLE)
    .refine((title) => title === title.trim(), 'a section title has no space at either end'),
  /** Orders the page's sections: a later one is drawn on top. */
  order: FractionalIndex,
})
export type Section = z.infer<typeof Section>

/** A curve from one of a page's frames or sections to another: `from` and `to` are each a frame's or a section's id. */
export const Connector = z.object({
  pageId: PageId,
  from: Id,
  to: Id,
  /** Orders the page's connectors. */
  order: FractionalIndex,
})
export type Connector = z.infer<typeof Connector>

/** A box on a page, in design pixels. */
export interface PageBox {
  x: number
  y: number
  width: number
  height: number
}

/** What the helpers read of a frame. */
type FrameLike = Readonly<PageBox> & {
  readonly pageId: string
  readonly order: string
  readonly sectionId?: string | undefined
}
type SectionLike = { readonly pageId: string; readonly order: string }
type ConnectorLike = { readonly pageId: string; readonly order: string; readonly from: string; readonly to: string }

type WithSections<F, S> = {
  readonly frames: Readonly<Record<string, F>>
  readonly sections: Readonly<Record<string, S>>
}

/** A page's sections that some frame of the page names, by order, ties broken by id: those drawn. */
export function sectionsOf<F extends FrameLike, S extends SectionLike>(
  design: WithSections<F, S>,
  pageId: string,
): [string, S][] {
  const named = new Set<string>()
  for (const frame of Object.values(design.frames)) {
    if (frame.pageId === pageId && frame.sectionId !== undefined) named.add(frame.sectionId)
  }
  return inOrder(design.sections).filter(([id, section]) => section.pageId === pageId && named.has(id))
}

/** The frames in section `sectionId`: those of its page that name it, by order; none for a missing section. */
export function framesInSection<F extends FrameLike, S extends SectionLike>(
  design: WithSections<F, S>,
  sectionId: string,
): [string, F][] {
  const section = own(design.sections, sectionId)
  if (!section) return []
  return inOrder(design.frames).filter(([, frame]) => frame.sectionId === sectionId && frame.pageId === section.pageId)
}

/** The section frame `frameId` is in: undefined when it names none, or one that is missing or on another page. */
export function sectionOf<F extends FrameLike, S extends SectionLike>(
  design: WithSections<F, S>,
  frameId: string,
): string | undefined {
  const frame = own(design.frames, frameId)
  const sectionId = frame?.sectionId
  if (sectionId === undefined) return undefined
  return own(design.sections, sectionId)?.pageId === frame?.pageId ? sectionId : undefined
}

/**
 * A page's connectors with both ends drawn on it, by order, ties broken by id: each end a frame of
 * the page or a section some frame of the page names.
 */
export function connectorsOf<F extends FrameLike, S extends SectionLike, C extends ConnectorLike>(
  design: WithSections<F, S> & { readonly connectors: Readonly<Record<string, C>> },
  pageId: string,
): [string, C][] {
  const ends = new Set(sectionsOf(design, pageId).map(([id]) => id))
  for (const [id, frame] of Object.entries(design.frames)) if (frame.pageId === pageId) ends.add(id)
  return inOrder(design.connectors).filter(
    ([, connector]) => connector.pageId === pageId && ends.has(connector.from) && ends.has(connector.to),
  )
}

/** Every connector with an end at `id`, a frame's or a section's, drawn or not, by order. */
export function connectorsTouching<C extends ConnectorLike>(
  design: { readonly connectors: Readonly<Record<string, C>> },
  id: string,
): [string, C][] {
  return inOrder(design.connectors).filter(([, connector]) => connector.from === id || connector.to === id)
}

/** The union of the boxes of the frames in section `sectionId`, on its page; undefined when it has none. */
export function sectionBox<F extends FrameLike, S extends SectionLike>(
  design: WithSections<F, S>,
  sectionId: string,
): PageBox | undefined {
  const frames = framesInSection(design, sectionId)
  if (frames.length === 0) return undefined
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [, { x, y, width, height }] of frames) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + width)
    bottom = Math.max(bottom, y + height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** A page's drawn sections by the top of their box, then its left, then their order: as the Pages card and Export list them. */
export function sectionsByPlace<F extends FrameLike, S extends SectionLike>(
  design: WithSections<F, S>,
  pageId: string,
): [string, S][] {
  const placed = sectionsOf(design, pageId).map((entry) => ({ entry, box: sectionBox(design, entry[0]) as PageBox }))
  return placed.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x).map(({ entry }) => entry)
}

/** A record's own value at `id`: never one an object inherits, such as `constructor`. */
function own<T>(records: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(records, id) ? records[id] : undefined
}
