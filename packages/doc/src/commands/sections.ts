// Commands on a page's sections (ADR-0024): make one of some frames, rename it, ungroup it, delete
// it with its frames, move it, copy it beside itself, and put frames in a section or in none. Each
// that empties a section deletes it with its connectors in the same step.
import { z } from 'zod'

import {
  type Design,
  FrameId,
  framesInSection,
  framesOf,
  freeSpot,
  inOrder,
  MAX_SECTION_TITLE,
  PageId,
  sectionBox,
  SectionId,
} from '@dazbee/schema'

import { framesOnPageProblem, idProblem, pageProblem, sectionOnPageProblem, sectionProblem } from './checks.ts'
import { defineCommand } from './define.ts'
import { copyFrameTo, deleteFrame } from './frames.ts'
import {
  forgetFrame,
  type PageRecords,
  pageRecords,
  removeConnectorsBetween,
  removeSection,
  setFrameSection,
  sweepPage,
} from './tidy-page.ts'
import { writeOrder } from './tree.ts'

/** A section's title as a command takes it: trimmed, then 1 to 120 characters. */
export const SectionTitle = z.string().trim().min(1).max(MAX_SECTION_TITLE)

/**
 * Makes a section of frames of one page, after the page's sections. Frames it takes from other
 * sections can empty them; those are deleted with their connectors. Returns the section's id.
 */
export const sectionAdd = defineCommand({
  name: 'section.add',
  description:
    'Makes a titled section of some frames of one page, taking them out of the sections they were in, and returns its id; a section it leaves with no frame is deleted with its connectors. It refuses a missing page, an id already in use, and a frame that is missing or on another page.',
  step: 'addSection',
  input: z.strictObject({
    pageId: PageId.describe('The page the section goes on.'),
    id: SectionId.optional().describe('The new section’s id; a fresh one is made when left out.'),
    title: SectionTitle.optional().describe(
      'Its title, 1 to 120 characters; the first free “Section N” of the page when left out.',
    ),
    frameIds: FrameId.array().min(1).describe('The frames it holds, all on that page.'),
  }),
  check: (ctx, { pageId, id, frameIds }) =>
    pageProblem(ctx.design, pageId) ?? idProblem(ctx, id) ?? framesOnPageProblem(ctx.design, pageId, frameIds),
  apply: ({ w, design, newId }, { pageId, id = newId(), title, frameIds }) => {
    const records = pageRecords(design, pageId)
    const moving = new Set(frameIds)
    const kept = new Set([...records.frames].filter(([frameId]) => !moving.has(frameId)).map(([, s]) => s))
    const orderOf = writeOrder(w, 'section', [...sectionSlots(design, pageId), [id, null]], new Set([id]))
    w.create('section', id, { pageId, title: title ?? freeTitle(design, records, kept), order: orderOf(id) })
    records.sections.add(id)
    for (const frameId of moving) setFrameSection(w, records, frameId, id)
    sweepPage(w, records)
    return id
  },
})

/** Renames a section. */
export const sectionUpdate = defineCommand({
  name: 'section.update',
  description: 'Renames a section. It refuses a missing section and a title that is blank or over 120 characters.',
  step: 'renameSection',
  input: z.strictObject({
    sectionId: SectionId.describe('The section to rename.'),
    title: SectionTitle.describe('Its new title, 1 to 120 characters.'),
  }),
  check: ({ design }, { sectionId }) => sectionProblem(design, sectionId),
  apply: ({ w }, { sectionId, title }) => w.set('section', sectionId, 'title', title),
})

/** Takes a section's frames out of it, where they are, and deletes it with its connectors. */
export const sectionUngroup = defineCommand({
  name: 'section.ungroup',
  description:
    'Ungroups a section: its frames stay where they are, in no section, and the section is deleted with its connectors. It refuses a missing section.',
  step: 'ungroupSection',
  input: z.strictObject({ sectionId: SectionId.describe('The section to ungroup.') }),
  check: ({ design }, { sectionId }) => sectionProblem(design, sectionId),
  apply: ({ w, design }, { sectionId }) => {
    const records = recordsOfSection(design, sectionId)
    for (const [frameId] of framesInSection(design, sectionId)) setFrameSection(w, records, frameId, undefined)
    removeSection(w, records, sectionId)
  },
})

/** Deletes a section with its frames, their layers and every connector touching any of them. */
export const sectionDelete = defineCommand({
  name: 'section.delete',
  description:
    'Deletes a section with its frames, their layers and every connector touching any of them, as one step one undo brings back; their linked copies in other frames stay. It refuses a missing section.',
  step: 'deleteSection',
  input: z.strictObject({ sectionId: SectionId.describe('The section to delete with its frames.') }),
  check: ({ design }, { sectionId }) => sectionProblem(design, sectionId),
  apply: ({ w, design }, { sectionId }) => {
    const records = recordsOfSection(design, sectionId)
    for (const [frameId] of framesInSection(design, sectionId)) {
      forgetFrame(w, records, frameId)
      deleteFrame(w, design, frameId)
    }
    removeSection(w, records, sectionId)
  },
})

/** Moves each frame of a section by an offset, to whole pixels. */
export const sectionMove = defineCommand({
  name: 'section.move',
  description:
    'Moves each frame of a section by dx and dy, its place rounded to whole pixels, its layers with it. It refuses a missing section and a move past where a frame can be.',
  step: 'move',
  input: z.strictObject({
    sectionId: SectionId.describe('The section to move.'),
    dx: z.number().describe('How far right to move it, in design pixels; left when below 0.'),
    dy: z.number().describe('How far down to move it, in design pixels; up when below 0.'),
  }),
  check: ({ design }, input) => {
    const problem = sectionProblem(design, input.sectionId)
    if (problem) return problem
    const far = movedFrames(design, input).find(([, x, y]) => !Number.isFinite(x) || !Number.isFinite(y))
    return far ? `frame "${far[0]}" would be moved past where a frame can be` : undefined
  },
  apply: ({ w, design }, input) => {
    for (const [frameId, x, y] of movedFrames(design, input)) {
      w.set('frame', frameId, 'x', x)
      w.set('frame', frameId, 'y', y)
    }
  },
})

/**
 * Copies a section beside itself: its frames as frame.duplicate copies them, with linked copies of
 * their layers, moved as one block keeping their layout to the free spot right of the section
 * (`freeSpot`), in a new section titled "<title> copy". The copies are not starred, and no
 * connector is copied. Returns the new section's id.
 */
export const sectionDuplicate = defineCommand({
  name: 'section.duplicate',
  description:
    'Copies a section and its frames, with linked copies of their layers, as one block keeping their layout, right of the section below any frame in the way, into a new section titled “<title> copy”, and returns its id. The copies are not starred and no connector is copied. It refuses a missing section, one with no frames, and an id already in use.',
  step: 'duplicateSection',
  input: z.strictObject({
    sectionId: SectionId.describe('The section to copy.'),
    newId: SectionId.optional().describe('The new section’s id; a fresh one is made when left out.'),
  }),
  check: (ctx, { sectionId, newId }) => {
    const problem = sectionProblem(ctx.design, sectionId) ?? idProblem(ctx, newId)
    if (problem) return problem
    return framesInSection(ctx.design, sectionId).length === 0 ? `section "${sectionId}" has no frames` : undefined
  },
  apply: (ctx, { sectionId, newId = ctx.newId() }) => {
    const { w, design } = ctx
    const { pageId, title } = design.sections[sectionId] as Design['sections'][string]
    const box = sectionBox(design, sectionId) as NonNullable<ReturnType<typeof sectionBox>>
    const spot = freeSpot(design, pageId, box, box)
    const sectionOrder = writeOrder(w, 'section', [...sectionSlots(design, pageId), [newId, null]], new Set([newId]))
    const copyTitle = `${title} copy`.slice(0, MAX_SECTION_TITLE).trimEnd()
    w.create('section', newId, { pageId, title: copyTitle, order: sectionOrder(newId) })
    const frames = framesInSection(design, sectionId).map(([frameId, frame]) => ({ frameId, frame, copy: ctx.newId() }))
    const slots = framesOf(design, pageId).map(([id, frame]): [string, string | null] => [id, frame.order])
    const copies = frames.map(({ copy }): [string, null] => [copy, null])
    const orderOf = writeOrder(w, 'frame', [...slots, ...copies], new Set(copies.map(([id]) => id)))
    for (const { frameId, frame, copy } of frames) {
      const at = { x: frame.x + spot.x - box.x, y: frame.y + spot.y - box.y }
      copyFrameTo(ctx, frameId, copy, { ...at, order: orderOf(copy), sectionId: newId })
    }
    return newId
  },
})

/**
 * Puts frames of one page in a section, or in none with null. A section it leaves with no frame is
 * deleted with its connectors, and so is any connector between a frame and the section it joins.
 */
export const frameSetSection = defineCommand({
  name: 'frame.setSection',
  description:
    'Puts frames of one page in a section of that page, or in none with null. A section it leaves with no frame is deleted with its connectors, and so is a connector between a frame and the section it joins. It refuses a missing frame, frames on two pages, and a section that is missing or on another page.',
  step: 'setSection',
  input: z.strictObject({
    frameIds: FrameId.array().min(1).describe('The frames to move, all on one page.'),
    sectionId: SectionId.nullable().describe('The section they go in, or null for none.'),
  }),
  check: ({ design }, { frameIds, sectionId }) => {
    const pageId = design.frames[frameIds[0] ?? '']?.pageId ?? ''
    const problem = framesOnPageProblem(design, pageId, frameIds)
    if (problem) return problem
    return sectionId === null ? undefined : sectionOnPageProblem(design, pageId, sectionId)
  },
  apply: ({ w, design }, { frameIds, sectionId }) => {
    const records = pageRecords(design, design.frames[frameIds[0] ?? '']?.pageId ?? '')
    for (const frameId of new Set(frameIds)) {
      setFrameSection(w, records, frameId, sectionId ?? undefined)
      if (sectionId !== null) removeConnectorsBetween(w, records, frameId, sectionId)
    }
    sweepPage(w, records)
  },
})

/** Each frame of a section with the place a move by `dx`, `dy` gives it, in whole pixels. */
function movedFrames(design: Design, { sectionId, dx, dy }: { sectionId: string; dx: number; dy: number }) {
  return framesInSection(design, sectionId).map(
    ([frameId, frame]) => [frameId, Math.round(frame.x + dx) + 0, Math.round(frame.y + dy) + 0] as const,
  )
}

/** The records of the page section `sectionId` is on. */
function recordsOfSection(design: Design, sectionId: string): PageRecords {
  return pageRecords(design, design.sections[sectionId]?.pageId ?? '')
}

/** A page's sections as slots, in order, those no frame names among them. */
function sectionSlots(design: Design, pageId: string): [string, string][] {
  return inOrder(design.sections)
    .filter(([, section]) => section.pageId === pageId)
    .map(([id, section]) => [id, section.order])
}

/** The first "Section N" from 1 up that no section of the page that keeps a frame (`kept`) is titled. */
function freeTitle(design: Design, records: PageRecords, kept: ReadonlySet<string | undefined>): string {
  const taken = new Set([...records.sections].filter((id) => kept.has(id)).map((id) => design.sections[id]?.title))
  for (let n = 1; ; n++) if (!taken.has(`Section ${n}`)) return `Section ${n}`
}
