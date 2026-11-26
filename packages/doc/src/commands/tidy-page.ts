// What a command leaves of a page's sections and connectors (ADR-0024): the section each frame of
// the page names, its sections and its connectors, each change written as the command makes it,
// and the sweep that deletes, on the page, any section no frame names and any connector with an
// end that is gone, which races and undo can leave behind.
import type { Design } from '@dazbee/schema'

import type { StoreWrite } from '../store.ts'

/** A page's frames with the section each names, its sections and its connectors, as a command leaves them. */
export interface PageRecords {
  readonly pageId: string
  /** Each frame of the page with the section it names: undefined for none. */
  readonly frames: Map<string, string | undefined>
  readonly sections: Set<string>
  /** Each connector of the page with its two ends. */
  readonly connectors: Map<string, { from: string; to: string }>
}

/** Page `pageId`'s records as the design holds them. */
export function pageRecords(design: Design, pageId: string): PageRecords {
  const frames = new Map<string, string | undefined>()
  for (const [id, frame] of Object.entries(design.frames)) if (frame.pageId === pageId) frames.set(id, frame.sectionId)
  const sections = new Set(Object.keys(design.sections).filter((id) => design.sections[id]?.pageId === pageId))
  const connectors = new Map<string, { from: string; to: string }>()
  for (const [id, { pageId: on, from, to }] of Object.entries(design.connectors))
    if (on === pageId) connectors.set(id, { from, to })
  return { pageId, frames, sections, connectors }
}

/** The records of the page frame `frameId` is on. */
export function recordsOfFrame(design: Design, frameId: string): PageRecords {
  return pageRecords(design, design.frames[frameId]?.pageId ?? '')
}

/** Whether a connector joins `a` and `b`, either way. */
export function joins({ from, to }: { from: string; to: string }, a: string, b: string): boolean {
  return (from === a && to === b) || (from === b && to === a)
}

/** Puts a frame of the page in section `sectionId`, or in none with undefined. */
export function setFrameSection(w: StoreWrite, records: PageRecords, frameId: string, sectionId: string | undefined) {
  if (records.frames.get(frameId) === sectionId) return
  records.frames.set(frameId, sectionId)
  if (sectionId === undefined) w.unset('frame', frameId, 'sectionId')
  else w.set('frame', frameId, 'sectionId', sectionId)
}

/** Deletes a connector of the page. */
function removeConnector(w: StoreWrite, records: PageRecords, connectorId: string) {
  records.connectors.delete(connectorId)
  w.remove('connector', connectorId)
}

/** Deletes every connector of the page with an end at `id`, a frame's or a section's. */
function removeConnectorsAt(w: StoreWrite, records: PageRecords, id: string) {
  for (const [connectorId, { from, to }] of records.connectors)
    if (from === id || to === id) removeConnector(w, records, connectorId)
}

/** Deletes every connector of the page between `a` and `b`, either way. */
export function removeConnectorsBetween(w: StoreWrite, records: PageRecords, a: string, b: string) {
  for (const [connectorId, ends] of records.connectors) if (joins(ends, a, b)) removeConnector(w, records, connectorId)
}

/** Deletes a section of the page and its connectors; frames naming it stay as they are. */
export function removeSection(w: StoreWrite, records: PageRecords, sectionId: string) {
  removeConnectorsAt(w, records, sectionId)
  records.sections.delete(sectionId)
  w.remove('section', sectionId)
}

/** Takes a frame the command removes out of the records, deleting its connectors; the caller removes the frame. */
export function forgetFrame(w: StoreWrite, records: PageRecords, frameId: string) {
  records.frames.delete(frameId)
  removeConnectorsAt(w, records, frameId)
}

/**
 * Deletes, on the page, every section no frame names, with its connectors, and every connector
 * with an end that is neither a frame nor a section of the page.
 */
export function sweepPage(w: StoreWrite, records: PageRecords) {
  const named = new Set(records.frames.values())
  for (const sectionId of records.sections) if (!named.has(sectionId)) removeSection(w, records, sectionId)
  const isEnd = (id: string) => records.frames.has(id) || records.sections.has(id)
  for (const [connectorId, { from, to }] of records.connectors)
    if (!isEnd(from) || !isEnd(to)) removeConnector(w, records, connectorId)
}
