// The sweep's inputs for the commands on sections and connectors (test-commands.ts takes them into
// COMMAND_INPUTS), and the section the other inputs pick.
import { type Design, framesOf, sectionsOf } from '@dazbee/schema'

import type { World } from './test-commands.ts'

/** A drawn section, else any section, else an id that names none. */
export const section = (design: Design) =>
  Object.keys(design.pages)
    .map((pageId) => sectionsOf(design, pageId)[0]?.[0])
    .find((id) => id !== undefined) ??
  Object.keys(design.sections)[0] ??
  'no-section'

/** The inputs each command on sections and connectors is swept with, by command name. */
export const SECTION_INPUTS: Partial<Record<string, (world: World) => unknown[]>> = {
  'frame.setSection': ({ design }) => [
    { frameIds: pageFrames(design).slice(-1), sectionId: section(design) },
    { frameIds: pageFrames(design).slice(0, 2), sectionId: null },
  ],
  'section.add': ({ design, made }) => [
    { pageId: framesPage(design), frameIds: pageFrames(design).slice(-2) },
    { pageId: framesPage(design), id: made('made'), title: ' Picked ', frameIds: pageFrames(design).slice(0, 1) },
  ],
  'section.update': ({ design }) => [{ sectionId: section(design), title: 'Renamed' }],
  'section.ungroup': ({ design }) => [{ sectionId: section(design) }],
  'section.delete': ({ design }) => [{ sectionId: section(design) }],
  'section.move': ({ design }) => [{ sectionId: section(design), dx: 30.5, dy: -40 }],
  'section.duplicate': ({ design, made }) => [
    { sectionId: section(design) },
    { sectionId: section(design), newId: made('made') },
  ],
  'connector.add': ({ design, made }) => {
    const [first = '', second = '', third = ''] = pageFrames(design)
    return [
      { pageId: framesPage(design), from: first, to: second },
      { pageId: framesPage(design), from: third || first, to: section(design), id: made('made') },
    ]
  },
  'connector.delete': ({ design }) => [{ connectorId: Object.keys(design.connectors)[0] ?? 'no-connector' }],
}

/** The frames of one page, by order: the first page with two or more, else the first page. */
function pageFrames(design: Design): string[] {
  const pages = Object.keys(design.pages).map((pageId) => framesOf(design, pageId).map(([id]) => id))
  return pages.find((frames) => frames.length > 1) ?? pages[0] ?? []
}

/** The page `pageFrames` gives the frames of. */
function framesPage(design: Design): string {
  return design.frames[pageFrames(design)[0] ?? '']?.pageId ?? (Object.keys(design.pages)[0] as string)
}
