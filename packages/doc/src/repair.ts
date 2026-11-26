import type { z } from 'zod'

import {
  byCodeUnits,
  canHold,
  Connector,
  type Design,
  DesignMeta,
  type DesignRecords,
  Frame,
  Id,
  isRecord,
  type Layer,
  LinkId,
  Page,
  parseLayer,
  Section,
} from '@dazbee/schema'

/** A design as its document holds it, before it is read: the schema's `DesignRecords`. */
export type Snapshot = DesignRecords

/**
 * A part of a design that a read left out because of a value the schema does not take: the part
 * holding the value, or a part that went with the one holding it. For `meta` the part is a field,
 * which took its default.
 */
export interface LeftOut {
  part: 'meta' | 'page' | 'frame' | 'layer' | 'section' | 'connector'
  /** The part's id, or the meta field's name. */
  id: string
  /** The schema's issue with the part, or the part holding it that was left out. */
  issue: string
}

/** A snapshot read as a design, with what the read changed to make it one. */
export interface Repaired {
  design: Design
  /** What the rules for concurrent edits changed, in words. */
  repairs: string[]
  /** The parts left out for a value the schema does not take. */
  leftOut: LeftOut[]
}

type Issues = { path: PropertyKey[]; message: string }[]

/** The longest part of a layer id a new link id keeps: a link id's longest, less room for `-<n>` up to 999. */
const LINK_STEM = (LinkId.maxLength ?? 64) - 4

/** The page a design with no page left gets; the page commands write it with their next edit. */
const EMPTY_PAGE: Page = { name: 'Page 1', order: 'a0' }

/** What a meta field that can't be read takes; an optional field without one is left absent. */
const META_DEFAULTS: DesignMeta = { designId: 'unknown', name: '' }

/** The ids found to be ids, so each is checked once. */
const validIds = new Set<string>()

/**
 * Reads a snapshot as a design, whatever it holds, the same way on every device. It reads only
 * the snapshot and never writes: the next edit carries on from the design it gives.
 *
 * A part whose value the schema does not take is left out and reported, since only a bug writes
 * one: a meta field takes its default, a page goes with its frames, sections and connectors, a
 * frame with its layers, and a layer with what it holds.
 *
 * Concurrent edits can merge into a state no single command allows: two tabs each deleting one
 * of the last two pages, a frame added to a page another tab deleted, a layer added to a frame or
 * group another tab deleted, two moves that put layers inside each other (whose links may then
 * reach another page), two layers of one frame with one link id, a key an undo left unset. The
 * numbered rules turn any merged state into a valid one.
 *
 * Each layer is validated once, and a layer object seen before is not validated again
 * (`parseLayer`); a layer a rule changes is a copy, so a layer it leaves alone is the same object
 * in every read.
 */
export function repair(snapshot: Snapshot): Repaired {
  const repairs: string[] = []
  const leftOut: LeftOut[] = []
  /** The pages, frames and layers left out, by id: what they hold is left out with them. */
  const unread = { page: new Set<string>(), frame: new Set<string>(), layer: new Set<string>() }
  const leaveOut = (part: LeftOut['part'], id: string, issue: string) => {
    if (part === 'page' || part === 'frame' || part === 'layer') unread[part].add(id)
    leftOut.push({ part, id, issue })
  }

  const meta = { ...META_DEFAULTS }
  for (const key of Object.keys(DesignMeta.shape) as (keyof DesignMeta)[]) {
    const parsed = DesignMeta.shape[key].safeParse(snapshot.meta[key])
    if (!parsed.success) leftOut.push({ part: 'meta', id: key, issue: issueOf(parsed.error.issues) })
    else if (parsed.data !== undefined) Object.assign(meta, { [key]: parsed.data })
  }

  const pages = new Map<string, Page>()
  for (const [id, value] of Object.entries(snapshot.pages)) {
    const parsed = Page.safeParse(value)
    const issue = idIssue(id) ?? (parsed.success ? undefined : issueOf(parsed.error.issues))
    if (issue === undefined && parsed.success) pages.set(id, parsed.data)
    else leaveOut('page', id, issue as string)
  }

  // 0. A design keeps a page: with none left it gets one empty page, at an id no frame or layer
  // has, nor a page left out.
  if (pages.size === 0) {
    const taken = (id: string) =>
      [snapshot.pages, snapshot.frames, snapshot.nodes].some((held) => Object.hasOwn(held, id))
    let id = 'page'
    for (let n = 2; taken(id); n++) id = `page-${n}`
    repairs.push(`no page was left; added the empty page "${id}"`)
    pages.set(id, EMPTY_PAGE)
  }

  // 1. A frame whose page is gone goes: a tab added it while another deleted the page.
  const frames = new Map<string, Frame>()
  for (const [id, value] of Object.entries(snapshot.frames)) {
    const parsed = Frame.safeParse(value)
    const issue = idIssue(id) ?? (parsed.success ? undefined : issueOf(parsed.error.issues))
    if (issue !== undefined || !parsed.success) leaveOut('frame', id, issue as string)
    else if (pages.has(parsed.data.pageId)) frames.set(id, parsed.data)
    else if (unread.page.has(parsed.data.pageId)) leaveOut('frame', id, heldBy(parsed.data.pageId))
    else repairs.push(`dropped frame "${id}", whose page "${parsed.data.pageId}" is gone`)
  }
  const isFrame = (id: string) => frames.has(id)

  // 1b. A section or connector whose page is gone goes, as a frame does. Its other references are
  // loose: a frame naming a missing section is in none, and a connector with a missing end is not
  // drawn (ADR-0024).
  /** Whether a page, a frame, a layer, or both a section and a connector are stored under `id`. */
  const idTaken = (id: string) =>
    [snapshot.pages, snapshot.frames, snapshot.nodes].some((held) => Object.hasOwn(held, id)) ||
    (Object.hasOwn(snapshot.sections ?? {}, id) && Object.hasOwn(snapshot.connectors ?? {}, id))
  const onPages = <T extends { pageId: string }>(part: 'section' | 'connector', schema: z.ZodType<T>) => {
    const kept = new Map<string, T>()
    const held = part === 'section' ? snapshot.sections : snapshot.connectors
    for (const [id, value] of Object.entries(held ?? {})) {
      const parsed = schema.safeParse(value)
      const taken = idTaken(id) ? `"${id}" is a ${part} and another record` : undefined
      const issue = idIssue(id) ?? taken ?? (parsed.success ? undefined : issueOf(parsed.error.issues))
      if (issue !== undefined || !parsed.success) leaveOut(part, id, issue as string)
      else if (pages.has(parsed.data.pageId)) kept.set(id, parsed.data)
      else if (unread.page.has(parsed.data.pageId)) leaveOut(part, id, heldBy(parsed.data.pageId))
      else repairs.push(`dropped ${part} "${id}", whose page "${parsed.data.pageId}" is gone`)
    }
    return kept
  }
  const sections = onPages('section', Section)
  const connectors = onPages('connector', Connector)

  // 2. A layer that lost its index goes to the back. Then the layers the schema does not take
  // go, before anyone looks for parents among them.
  const nodes = new Map<string, Layer>()
  for (const id of Object.keys(snapshot.nodes).sort(byCodeUnits)) {
    let value = snapshot.nodes[id]
    if (isRecord(value) && typeof value.type === 'string' && isRecord(value.props) && typeof value.index !== 'string') {
      repairs.push(`"${id}" lost its index; put at the back`)
      value = { ...value, index: 'a0' }
    }
    const parsed = parseLayer(value)
    const both = Object.hasOwn(snapshot.frames, id) ? `"${id}" is both a frame and a layer` : undefined
    const issue = idIssue(id) ?? both ?? (parsed.success ? undefined : parsed.errors.join('; '))
    if (issue === undefined && parsed.success) nodes.set(id, parsed.layer)
    else leaveOut('layer', id, issue as string)
  }
  const change = (id: string, patch: { parentId: string } | { link: string }) =>
    nodes.set(id, Object.freeze({ ...(nodes.get(id) as Layer), ...patch }))

  // 3. A cycle breaks at its smallest id, so all devices pick the same layer. It has no frame to
  // go back to, so it goes to the top of the first frame there is.
  /** The layers a broken cycle moved into a frame. */
  const outOfCycles = new Set<string>()
  const byOrder = ([a, x]: [string, { order: string }], [b, y]: [string, { order: string }]) =>
    byCodeUnits(x.order, y.order) || byCodeUnits(a, b)
  const fallback = [...pages]
    .sort(byOrder)
    .map(([pageId]) => [...frames].filter(([, frame]) => frame.pageId === pageId).sort(byOrder)[0]?.[0])
    .find((id) => id !== undefined)
  for (const id of [...nodes.keys()]) {
    const path: string[] = []
    for (let up: string | undefined = id; up !== undefined && nodes.has(up); up = nodes.get(up)?.parentId) {
      const at = path.indexOf(up)
      if (at === -1) {
        path.push(up)
        continue
      }
      const cycle = path.slice(at).sort(byCodeUnits)
      if (fallback === undefined) {
        for (const inside of cycle) {
          repairs.push(`dropped "${inside}", which was inside itself, with no frame to move it to`)
          nodes.delete(inside)
        }
      } else {
        repairs.push(`"${cycle[0]}" was inside itself; moved to frame "${fallback}"`)
        change(cycle[0] as string, { parentId: fallback })
        outOfCycles.add(cycle[0] as string)
      }
      break
    }
  }

  // Where each layer's chain of parents ends: at a frame, or at an id that is neither a frame nor
  // a layer. Moving a layer to the top of the frame its chain ends at changes no layer's frame.
  const ends = new Map<string, string>()
  const endOf = (id: string): string => {
    const known = ends.get(id)
    if (known !== undefined) return known
    const parentId = (nodes.get(id) as Layer).parentId
    const end = nodes.has(parentId) ? endOf(parentId) : parentId
    ends.set(id, end)
    return end
  }
  const frameOf = (id: string) => (isFrame(endOf(id)) ? endOf(id) : undefined)

  // 4. A layer whose parent can't hold it goes to the top of the frame that parent is in.
  for (const [id, node] of nodes) {
    const parent = nodes.get(node.parentId)
    if (!parent || canHold(parent.type, node.type)) continue
    const frame = frameOf(node.parentId)
    if (frame === undefined) continue
    repairs.push(`"${id}" can't be held by "${node.parentId}"; moved to frame "${frame}"`)
    change(id, { parentId: frame })
  }

  // 5. A layer in no frame goes, with everything under it: a tab added it to a frame or group
  // that another tab deleted. The delete wins; its undo brings the layer back. One whose chain of
  // parents ends at a part left out is left out with it.
  for (const [id, end] of [...nodes.keys()].map((id) => [id, endOf(id)] as const)) {
    if (isFrame(end)) continue
    if (unread.layer.has(end) || unread.frame.has(end)) leaveOut('layer', id, heldBy(end))
    else repairs.push(`dropped "${id}", which is in no frame`)
    nodes.delete(id)
  }

  // 6. A broken cycle may bring layers from another page into the fallback frame, while their
  // linked copies stay there. So each layer it brought keeps its link only when no other layer
  // holds it, else takes its own id, or that id numbered from 2, whichever no layer holds.
  const holders = new Map<string, number>()
  for (const node of nodes.values()) holders.set(node.link, (holders.get(node.link) ?? 0) + 1)
  const cameOut = (id: string) => {
    const seen = new Set<string>()
    for (
      let up: string | undefined = id;
      up !== undefined && nodes.has(up) && !seen.has(up);
      up = nodes.get(up)?.parentId
    ) {
      if (outOfCycles.has(up)) return true
      seen.add(up)
    }
    return false
  }
  for (const id of [...nodes.keys()].filter(cameOut).sort(byCodeUnits)) {
    const link = (nodes.get(id) as Layer).link
    if ((holders.get(link) ?? 0) < 2) continue
    const fresh = ownLink(id, (taken) => holders.has(taken))
    holders.set(link, (holders.get(link) ?? 1) - 1)
    holders.set(fresh, 1)
    repairs.push(
      `"${id}" came out of a cycle with link "${link}", which another layer holds; its link is now "${fresh}"`,
    )
    change(id, { link: fresh })
  }

  // 7. No frame holds a link id twice: the holder whose id sorts first keeps it, and each other
  // one takes its own id, or that id numbered from 2, whichever its frame doesn't hold yet.
  const held = new Map<string, Map<string, string[]>>()
  for (const [id, node] of nodes) {
    const frame = endOf(id)
    const links = held.get(frame) ?? new Map<string, string[]>()
    held.set(frame, links)
    links.set(node.link, [...(links.get(node.link) ?? []), id])
  }
  const relinked: [string, string, string, string][] = []
  for (const [frame, links] of held) {
    for (const [link, holders] of links) {
      if (holders.length < 2) continue
      const [keeper, ...others] = holders
      for (const id of others) relinked.push([id, link, frame, keeper as string])
    }
  }
  for (const [id, link, frame, keeper] of relinked.sort(([a], [b]) => byCodeUnits(a, b))) {
    const links = held.get(frame) as Map<string, string[]>
    const fresh = ownLink(id, (taken) => links.has(taken))
    links.set(fresh, [id])
    repairs.push(`"${id}" held link "${link}" in frame "${frame}" with "${keeper}"; its link is now "${fresh}"`)
    change(id, { link: fresh })
  }

  // The layers in the order the snapshot holds them, whatever the rules did.
  const layers = Object.keys(snapshot.nodes).flatMap((id): [string, Layer][] => {
    const layer = nodes.get(id)
    return layer ? [[id, layer]] : []
  })
  const design = {
    meta,
    pages: Object.fromEntries(pages),
    frames: Object.fromEntries(frames),
    nodes: Object.fromEntries(layers),
    sections: Object.fromEntries(sections),
    connectors: Object.fromEntries(connectors),
  }
  return { design, repairs, leftOut }
}

/**
 * The link a layer takes when the one it has is held already: its own id, or that id numbered
 * from 2, whichever `held` doesn't hold.
 */
export function ownLink(id: string, held: (link: string) => boolean): string {
  let fresh = id
  for (let n = 2; held(fresh); n++) fresh = `${id.slice(0, LINK_STEM)}-${n}`
  return fresh
}

/**
 * The schema's issue with a key as an id, if it has one: the one rule every read applies to the
 * key a page, a frame or a layer is stored under. A valid id is remembered unless `remember` is
 * false: the sync server, which checks every id ever pasted, keeps none.
 */
export function idIssue(id: string, remember = true): string | undefined {
  if (validIds.has(id)) return undefined
  const parsed = Id.safeParse(id)
  if (!parsed.success) return `id: ${parsed.error.issues.map((i) => i.message).join('; ')}`
  if (remember) validIds.add(id)
  return undefined
}

function issueOf(issues: Issues) {
  return issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
}

/** Why a part goes with the part holding it. */
function heldBy(id: string) {
  return `"${id}", which holds it, was left out`
}
