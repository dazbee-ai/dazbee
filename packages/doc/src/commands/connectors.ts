// Commands on a page's connectors (ADR-0024): join two of a page's frames or sections, and delete
// a connector.
import { z } from 'zod'

import { ConnectorId, type Design, Id, inOrder, PageId, sectionOf, sectionsOf } from '@dazbee/schema'

import { connectorProblem, idProblem, pageProblem } from './checks.ts'
import { defineCommand } from './define.ts'
import { joins } from './tidy-page.ts'
import { writeOrder } from './tree.ts'

/** Joins two frames or sections of a page, after the page's connectors. Returns the connector's id. */
export const connectorAdd = defineCommand({
  name: 'connector.add',
  description:
    'Draws a connector on a page from one of its frames or sections to another, and returns its id. It refuses a missing page, an id already in use, an end that is missing, on another page or a section with no frames, the same end twice, a frame joined to its own section, and two ends already joined either way.',
  step: 'addConnector',
  input: z.strictObject({
    pageId: PageId.describe('The page the connector goes on.'),
    from: Id.describe('The frame or section it starts from.'),
    to: Id.describe('The frame or section it points to.'),
    id: ConnectorId.optional().describe('The new connector’s id; a fresh one is made when left out.'),
  }),
  check: (ctx, { pageId, from, to, id }) => {
    const { design } = ctx
    const problem =
      pageProblem(design, pageId) ??
      idProblem(ctx, id) ??
      endProblem(design, pageId, from) ??
      endProblem(design, pageId, to)
    if (problem) return problem
    if (from === to) return 'a connector joins two different frames or sections'
    if (sectionOf(design, from) === to || sectionOf(design, to) === from)
      return 'a connector does not join a frame to its own section'
    const joined = Object.values(design.connectors).some((c) => c.pageId === pageId && joins(c, from, to))
    return joined ? `"${from}" and "${to}" are already joined` : undefined
  },
  apply: ({ w, design, newId }, { pageId, from, to, id = newId() }) => {
    const slots = inOrder(design.connectors)
      .filter(([, connector]) => connector.pageId === pageId)
      .map(([other, connector]): [string, string | null] => [other, connector.order])
    const orderOf = writeOrder(w, 'connector', [...slots, [id, null]], new Set([id]))
    w.create('connector', id, { pageId, from, to, order: orderOf(id) })
    return id
  },
})

/** Deletes a connector. */
export const connectorDelete = defineCommand({
  name: 'connector.delete',
  description: 'Deletes a connector. It refuses a missing connector.',
  step: 'deleteConnector',
  input: z.strictObject({ connectorId: ConnectorId.describe('The connector to delete.') }),
  check: ({ design }, { connectorId }) => connectorProblem(design, connectorId),
  apply: ({ w }, { connectorId }) => w.remove('connector', connectorId),
})

/** Why `id` can't be a connector's end on page `pageId`, if it can't: a frame or a drawn section of that page. */
function endProblem(design: Design, pageId: string, id: string): string | undefined {
  const frame = Object.hasOwn(design.frames, id) ? design.frames[id] : undefined
  if (frame) return frame.pageId === pageId ? undefined : `frame "${id}" is on another page`
  const section = Object.hasOwn(design.sections, id) ? design.sections[id] : undefined
  if (!section) return `no frame or section "${id}"`
  if (section.pageId !== pageId) return `section "${id}" is on another page`
  return sectionsOf(design, pageId).some(([drawn]) => drawn === id) ? undefined : `section "${id}" has no frames`
}
