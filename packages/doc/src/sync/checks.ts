// The checks a change set must pass, on the state after it over the records it wrote only (I1):
// first its caps, before it is applied; then each record it wrote as the schema's own parser takes
// it; then the schema's structure rules (`checkStructure`'s, written once, C29) over what it wrote.
// The server checks every change set with them; a tab checks with them what its undo or redo writes.
import {
  carryOverLayer,
  type Change,
  checkFrame,
  checkLayer,
  checkPages,
  DesignMeta,
  type Fail,
  Frame,
  type FrameEnd,
  frameOfLayer,
  type HeldPart,
  Layer,
  Page,
  type Part,
  type RejectReason,
  type StructureLookup,
  SYNC_LIMITS,
} from '@dazbee/schema'

import { idIssue } from '../repair.ts'
import { describe, type Rec, type RecordKey, recordOf } from './changes.ts'
import type { DesignState, ReadState } from './state.ts'

/** Why a change set is rejected: a code for the tab, and words for the log. */
export interface Issue {
  reason: RejectReason
  words: string
}

/** The most records of each part one change set may write: as many as a design may hold (C37). */
export const CHANGE_SET_CAPS: Readonly<Record<HeldPart, number>> = {
  page: SYNC_LIMITS.designPages,
  frame: SYNC_LIMITS.designFrames,
  layer: SYNC_LIMITS.designLayers,
}

const PARSERS = { meta: DesignMeta, page: Page, frame: Frame, layer: Layer } as const
const HELD_PARTS: readonly HeldPart[] = ['page', 'frame', 'layer']
/** What a record adds to its JSON in a design's JSON: its id's quotes, the colon and a comma. */
const RECORD_OVERHEAD = 4

/** Records found to keep the schema: a record is never changed once read, so each is parsed once. */
const kept = new WeakSet<Rec>()
/** The UTF-8 size of each record's JSON. */
const sizes = new WeakMap<Rec, number>()

/**
 * Why a change set holds more than one may, if it does: more changes than a change set may hold, or
 * more records of a part than a design may hold. Run before the change set is applied.
 */
export function capIssue(changes: readonly Change[]): Issue | undefined {
  if (changes.length > SYNC_LIMITS.changeSetChanges) {
    return { reason: 'tooManyChanges', words: `${changes.length} changes, past ${SYNC_LIMITS.changeSetChanges}` }
  }
  const named: Record<HeldPart, Set<string>> = { page: new Set(), frame: new Set(), layer: new Set() }
  for (const change of changes) {
    const { part, id } = change.op === 'set' ? change.value : change
    if (part !== 'meta') named[part].add(id)
  }
  for (const part of HELD_PARTS) {
    if (named[part].size > CHANGE_SET_CAPS[part]) {
      return { reason: 'tooManyChanges', words: `${named[part].size} ${part}s, past ${CHANGE_SET_CAPS[part]}` }
    }
  }
  return undefined
}

/**
 * Why the change set that turned `before` into `after` breaks a rule, if it does. It looks only at
 * the records the change set wrote (`written`) and what the structure rules reach from them:
 * - each record written is what the schema's parser takes, with a valid id and no key it has no place for;
 * - the design keeps a page, a frame's page exists, and each layer moved, with every layer it
 *   holds, passes `checkLayer`.
 *
 * A layer counts as moved when it is new or its type, parent or link changed (a change set may
 * delete a layer and make it again as another type). A layer whose type, parent and link are as
 * they were keeps every structure rule it kept; a moved one can close a cycle, bring a link into a
 * frame that holds it, or no longer hold what it holds, so the layers it holds are checked too.
 * The rules run once the whole change set is in, so moves that pass through a cycle midway and end
 * in a tree pass in any order.
 */
export function changeSetIssue(
  after: DesignState,
  before: DesignState,
  written: Iterable<RecordKey>,
): Issue | undefined {
  const live: { part: Part; id: string; record: Rec }[] = []
  for (const key of written) {
    const { part, id } = recordOf(key)
    const record = after.get(part, id)
    if (!record) continue
    const issue = recordIssue(part, id, record)
    if (issue !== undefined) return { reason: 'invalidRecord', words: issue }
    live.push({ part, id, record })
  }
  let found: string | undefined
  const fail: Fail = (path, message) => {
    found ??= `${path.join('.')}: ${message}`
  }
  const lookup = stateLookup(after)
  checkPages(lookup, fail)
  const checked = new Set<string>()
  for (const { part, id, record } of live) {
    if (found !== undefined) break
    if (part === 'frame') checkFrame(lookup, id, fail)
    if (part !== 'layer' || checked.has(id)) continue
    const old = before.get('layer', id)
    if (old && old.type === record.type && old.parentId === record.parentId && old.link === record.link) continue
    for (const layer of after.subtree(id)) {
      if (checked.has(layer)) continue
      checked.add(layer)
      checkLayer(lookup, layer, fail)
      if (found !== undefined) break
    }
  }
  return found === undefined ? undefined : { reason: 'structure', words: found }
}

/** The size of the design's JSON in UTF-8 bytes, as the sum of its records' sizes. */
export function designBytes(state: DesignState): number {
  let bytes = sizeOf('meta', state.get('meta', 'meta') ?? {})
  for (const part of HELD_PARTS) for (const id of state.ids(part)) bytes += sizeOf(part, state.get(part, id) ?? {}, id)
  return bytes
}

/**
 * How many bytes the change set that turned `before` into `after` adds to the design's size (less
 * than zero when it shrinks it), from the records it wrote only: a design's size is kept by adding
 * this to it.
 */
export function bytesWritten(after: DesignState, before: DesignState, written: Iterable<RecordKey>): number {
  let bytes = 0
  for (const key of written) {
    const { part, id } = recordOf(key)
    const [now, was] = [after.get(part, id), before.get(part, id)]
    bytes += (now ? sizeOf(part, now, id) : 0) - (was ? sizeOf(part, was, id) : 0)
  }
  return bytes
}

/** The size of a record in the design's JSON, in UTF-8 bytes. */
export function sizeOf(part: Part, record: Rec, id = ''): number {
  let size = sizes.get(record)
  if (size === undefined) {
    size = utf8Length(JSON.stringify(record))
    sizes.set(record, size)
  }
  return size + (part === 'meta' ? 0 : utf8Length(id) + RECORD_OVERHEAD)
}

/** How many bytes `text` takes in UTF-8. */
export function utf8Length(text: string): number {
  let bytes = text.length
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 2
      i++
    } else if (code >= 0x800) bytes += 2
    else if (code >= 0x80) bytes += 1
  }
  return bytes
}

/** Why a record breaks the schema, if it does: its id, a key it has no place for, or a value. */
export function recordIssue(part: Part, id: string, record: Rec): string | undefined {
  if (kept.has(record)) return undefined
  const issue = (part === 'meta' ? undefined : idIssue(id, false)) ?? schemaIssue(part, record)
  if (issue !== undefined) return `${describe(part, id)}: ${issue}`
  kept.add(record)
  return undefined
}

/**
 * The structure rules' lookup over a state: a link is taken when another layer of the same frame
 * holds it. The holders of each link read are put by frame once per check, so a link held in
 * every frame of a full design costs one pass however many of its layers the change set wrote.
 */
export function stateLookup(state: ReadState): StructureLookup {
  const byFrame = new Map<string, Map<FrameEnd, string[]>>()
  const lookup: StructureLookup = {
    frames: new Map(),
    pageCount: () => state.count('page'),
    hasPage: (id) => state.get('page', id) !== undefined,
    frame: (id) => state.get('frame', id) as Frame | undefined,
    layer: (id) => state.get('layer', id) as Layer | undefined,
    linkTakenBy: (frameId, link, id) =>
      holdersIn(link)
        .get(frameId)
        ?.find((other) => other !== id),
  }
  return lookup

  /** The layers holding `link`, by the frame each is in. */
  function holdersIn(link: string) {
    let frames = byFrame.get(link)
    if (!frames) {
      frames = new Map()
      for (const holder of state.linkHolders(link)) {
        const frame = frameOfLayer(lookup, holder)
        const holders = frames.get(frame)
        if (holders) holders.push(holder)
        else frames.set(frame, [holder])
      }
      byFrame.set(link, frames)
    }
    return frames
  }
}

function schemaIssue(part: Part, record: Rec): string | undefined {
  // Parsed only to check: the record is kept as sent, so a value's default is never written in. A
  // layer is checked carried over to this schema's version, as every reader reads it, so a value it
  // stored before a change of the schema still passes.
  const checked = part === 'layer' ? carryOverLayer(record) : record
  const parsed = PARSERS[part].safeParse(checked)
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  return droppedIssue(checked, parsed.data)
}

/**
 * Why `sent` holds what its parse (`parsed`) does not, if it does: a key at any depth that the
 * parse dropped, having no place for it (the record is kept as sent, so it would be stored). The
 * design's schema holds no value of unknown shape, so whatever the parse kept is no deeper than the
 * schema allows; the walk keeps its own stack and never follows a dropped key, so a value nested
 * however deep under one is refused without being walked.
 */
function droppedIssue(sent: unknown, parsed: unknown): string | undefined {
  const stack: { sent: unknown; parsed: unknown; path: string }[] = [{ sent, parsed, path: '' }]
  for (let at = stack.pop(); at; at = stack.pop()) {
    if (typeof at.sent !== 'object' || at.sent === null) continue
    const into = at.parsed as Record<string, unknown>
    for (const key of Object.keys(at.sent)) {
      const path = at.path === '' ? key : `${at.path}.${key}`
      if (typeof into !== 'object' || into === null || !Object.hasOwn(into, key)) return `no place for "${path}"`
      stack.push({ sent: (at.sent as Record<string, unknown>)[key], parsed: into[key], path })
    }
  }
  return undefined
}
