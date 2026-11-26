// A design's synced state: its records by part, with what each holder holds and which layers share
// each link id. A state can be an overlay on another: it reads through to its base and keeps its own
// writes, which `commit` writes into the base. The server tries a change set on an overlay instead of
// copying the design, and a client's view is an overlay on the state the server confirmed.
import {
  type Change,
  type DesignRecords,
  designRecords,
  type HeldPart,
  isRecord,
  type Part,
  type Placed,
  type RejectReason,
  type Target,
} from '@dazbee/schema'

import {
  describe,
  holderOf,
  META_ID,
  type Rec,
  type RecordKey,
  recordKey,
  RECORDS_OF,
  targetIssue,
  valueAt,
  withValue,
} from './changes.ts'

/** How `apply` takes a change it can't apply: reject it (it throws), or skip it. */
export type Mode = 'strict' | 'lenient'

/** What a client's view and confirmed state give to read (DesignState's reads). */
export interface ReadState {
  get(part: Part, id: string): Rec | undefined
  getKey(key: RecordKey): Rec | undefined
  partOf(id: string): HeldPart | undefined
  childrenOf(holder: string): ReadonlySet<string>
  linkHolders(link: string): ReadonlySet<string>
  ids(part: HeldPart): string[]
  count(part: HeldPart): number
  valueOf(target: Target): unknown
  subtree(id: string): string[]
  toRecords(): DesignRecords
}

/** A change set rejected: why, as a code for the tab, and in words for the log. */
export class ChangeRejected extends Error {
  readonly reason: RejectReason

  constructor(reason: RejectReason, words: string) {
    super(words)
    this.reason = reason
  }
}

const PARTS = ['meta', 'page', 'frame', 'layer', 'section', 'connector'] as const
const HELD_PARTS = ['page', 'frame', 'layer', 'section', 'connector'] as const
/** The keys the indexes follow: what holds a record, and a layer's link. */
const INDEXED = new Set(['pageId', 'parentId', 'link'])
const NONE: ReadonlySet<string> = new Set()

/** Sets by key, copied on write over a base index: what holders hold, or which layers share a link. */
class Index {
  readonly #base: Index | undefined
  readonly #own = new Map<string, Set<string>>()

  constructor(base?: Index) {
    this.#base = base
  }

  get(key: string): ReadonlySet<string> {
    return this.#own.get(key) ?? (this.#base === undefined ? NONE : this.#base.get(key))
  }

  add(key: string, id: string) {
    this.#owned(key).add(id)
  }

  remove(key: string, id: string) {
    if (this.get(key).has(id)) this.#owned(key).delete(id)
  }

  /** Empties the set at `key`, without copying it. */
  clear(key: string) {
    if (this.get(key).size > 0) this.#own.set(key, new Set())
  }

  /** Writes this overlay's sets into its base. */
  commit() {
    const base = this.#base as Index
    for (const [key, set] of this.#own) {
      if (set.size === 0 && base.#base === undefined) base.#own.delete(key)
      else base.#own.set(key, set)
    }
    this.#own.clear()
  }

  #owned(key: string): Set<string> {
    let set = this.#own.get(key)
    if (!set) {
      set = new Set(this.get(key))
      this.#own.set(key, set)
    }
    return set
  }
}

export class DesignState implements ReadState {
  readonly #base: DesignState | undefined
  /** Records by part and id; null marks one this overlay deleted. */
  readonly #records: Record<Part, Map<string, Rec | null>>
  /** What each holder holds: frames, sections and connectors by page id, layers by frame or parent layer id. */
  readonly #children: Index
  /** The layers holding each link id. */
  readonly #links: Index
  #counts: Record<HeldPart, number>
  /** In the state no overlay is over (the server's), each record's placement by id (C46). */
  readonly #placed: Map<string, Placed> | undefined
  /** The ids this overlay created, a record deleted and made again among them. */
  readonly #created = new Set<string>()
  /**
   * In an overlay nobody reads records from until it commits (`owning`), the copies it made: a
   * later set on one of them, or on its props, writes into it instead of copying it again.
   */
  readonly #owned: Set<Rec> | undefined

  private constructor(base?: DesignState, owning = false) {
    this.#base = base
    this.#owned = owning ? new Set() : undefined
    this.#records = {
      meta: new Map(),
      page: new Map(),
      frame: new Map(),
      layer: new Map(),
      section: new Map(),
      connector: new Map(),
    }
    this.#children = new Index(base && base.#children)
    this.#links = new Index(base && base.#links)
    this.#counts = base ? { ...base.#counts } : { page: 0, frame: 0, layer: 0, section: 0, connector: 0 }
    this.#placed = base ? undefined : new Map()
  }

  /**
   * A state holding the records of `records`, as they are (the server checks what it loads), with
   * the placements saved with them. Records without sections or connectors hold none.
   */
  static fromRecords(records: DesignRecords, placed: Readonly<Record<string, Placed>> = {}): DesignState {
    const state = new DesignState()
    state.#records.meta.set(META_ID, records.meta)
    for (const part of HELD_PARTS) {
      for (const [id, record] of Object.entries(records[RECORDS_OF[part]] ?? {}))
        state.#put(part, id, record as Rec, undefined)
    }
    for (const [id, at] of Object.entries(placed)) state.#placed?.set(id, at)
    return state
  }

  /**
   * A state over this one: it reads through to this one and keeps its own writes until `commit`.
   * `owning`: nobody keeps a record read from it before it commits (the server's change set), so
   * a record is copied once however many of its values the change set sets.
   */
  overlay(owning = false): DesignState {
    return new DesignState(this, owning)
  }

  /**
   * Writes this overlay's writes into its base, which must not have changed since the overlay was
   * made. `by`: the change set the writes are, whose sequence number and author become the
   * placement of each record it created or moved to another holder; only the server's state, which
   * no overlay is over, keeps placements.
   */
  commit(by?: Placed) {
    const base = this.#base
    if (!base) throw new Error('only an overlay commits')
    if (by && base.#placed) this.#place(base, base.#placed, by)
    for (const part of PARTS) {
      const into = base.#records[part]
      for (const [id, record] of this.#records[part]) {
        if (record === null && base.#base === undefined) into.delete(id)
        else into.set(id, record)
      }
      this.#records[part].clear()
    }
    this.#children.commit()
    this.#links.commit()
    base.#counts = { ...this.#counts }
    this.#created.clear()
    // Its copies are the base's now: a later write copies them again.
    this.#owned?.clear()
  }

  /** The change set that last created record `id` or moved it to another holder, if the state keeps it. */
  placedAt(id: string): Placed | undefined {
    return this.#base ? this.#base.placedAt(id) : this.#placed?.get(id)
  }

  /** Every placement the state keeps, by record id, to save with its records. */
  placements(): Record<string, Placed> {
    return this.#base ? this.#base.placements() : Object.fromEntries(this.#placed ?? [])
  }

  get(part: Part, id: string): Rec | undefined {
    const record = this.#records[part].get(id)
    if (record !== undefined) return record ?? undefined
    return this.#base === undefined ? undefined : this.#base.get(part, id)
  }

  /** The record a key names. */
  getKey(key: RecordKey): Rec | undefined {
    const at = key.indexOf('/')
    return this.get(key.slice(0, at) as Part, key.slice(at + 1))
  }

  /** The part holding a live record with this id, if any: ids are unique across every held part. */
  partOf(id: string): HeldPart | undefined {
    if (this.get('layer', id)) return 'layer'
    if (this.get('frame', id)) return 'frame'
    if (this.get('section', id)) return 'section'
    if (this.get('connector', id)) return 'connector'
    return this.get('page', id) ? 'page' : undefined
  }

  /** The ids of the records whose holder is `holder`: a page's frames, sections and connectors, or a frame's or layer's layers. */
  childrenOf(holder: string): ReadonlySet<string> {
    return this.#children.get(holder)
  }

  /** The layers holding link id `link`. */
  linkHolders(link: string): ReadonlySet<string> {
    return this.#links.get(link)
  }

  /** The ids of every record of a part. */
  ids(part: HeldPart): string[] {
    if (this.#base === undefined) return [...this.#records[part].keys()]
    const own = this.#records[part]
    const below = this.#base.ids(part).filter((id) => !own.has(id))
    return [...below, ...[...own].flatMap(([id, record]) => (record === null ? [] : [id]))]
  }

  /** How many records of a part there are. */
  count(part: HeldPart): number {
    return this.#counts[part]
  }

  valueOf(target: Target): unknown {
    const record = this.get(target.part, target.id)
    return record ? valueAt(record, target) : undefined
  }

  /**
   * The record `id` and every record it holds, holders before what they hold, each once: a view
   * replayed leniently can hold layers inside each other until the server rejects the change set.
   */
  subtree(id: string): string[] {
    const seen = new Set([id])
    for (const at of seen) for (const inside of this.#children.get(at)) seen.add(inside)
    return [...seen]
  }

  /** The records this overlay wrote: created, changed or deleted. */
  ownKeys(): RecordKey[] {
    return PARTS.flatMap((part) => [...this.#records[part].keys()].map((id) => recordKey(part, id)))
  }

  /**
   * Applies one change and returns the records it wrote. A change that can't apply (a set or a
   * create naming a record that is gone or live, or a key the record has no place for) throws a
   * ChangeRejected in strict mode and writes nothing in lenient mode. The design's rules (the
   * schema, the tree) are checked over a whole change set afterwards (checks.ts), not here.
   */
  apply(change: Change, mode: Mode): RecordKey[] {
    const written: RecordKey[] = []
    const issue = this.#applyOne(change, written)
    if (issue !== undefined && mode === 'strict') throw new ChangeRejected('cannotApply', issue)
    return written
  }

  /** The records as plain JSON, as a design's document holds them (`designRecords`: sections and connectors only while it holds some). */
  toRecords(): DesignRecords {
    const held = (part: HeldPart) => Object.fromEntries(this.ids(part).map((id) => [id, this.get(part, id)]))
    return designRecords({
      meta: this.get('meta', META_ID) ?? {},
      pages: held('page'),
      frames: held('frame'),
      nodes: held('layer'),
      sections: held('section'),
      connectors: held('connector'),
    })
  }

  /** Notes in `placed` the records this overlay created or moved to another holder, as placed `by`, and drops the deleted. */
  #place(base: DesignState, placed: Map<string, Placed>, by: Placed) {
    // The deleted first: a live record may have taken a deleted one's id in another part.
    for (const part of HELD_PARTS) for (const [id, now] of this.#records[part]) if (!now) placed.delete(id)
    for (const part of HELD_PARTS) {
      for (const [id, now] of this.#records[part]) {
        if (!now) continue
        const was = base.get(part, id)
        if (this.#created.has(id) || !was || holderOf(part, was) !== holderOf(part, now)) {
          placed.set(id, { seq: by.seq, author: by.author })
        }
      }
    }
  }

  #applyOne(change: Change, written: RecordKey[]): string | undefined {
    if (change.op === 'create') {
      if (this.partOf(change.id) !== undefined) return `${describe(change.part, change.id)} already exists`
      this.#put(change.part, change.id, change.record, undefined)
      this.#created.add(change.id)
      written.push(recordKey(change.part, change.id))
      return undefined
    }
    if (change.op === 'set') {
      const t = change.value
      const record = this.get(t.part, t.id)
      if (!record) return `${describe(t.part, t.id)} was deleted by someone else`
      const issue = targetIssue(record, t)
      if (issue !== undefined) return issue
      const owned = this.#owned
      if (!owned) this.#put(t.part, t.id, withValue(record, t, change.to), record)
      else {
        // Written into its own copy, the holder and link it had are what the indexes need.
        const inPlace = owned.has(record)
        const before =
          inPlace && INDEXED.has(t.key)
            ? { pageId: record.pageId, parentId: record.parentId, link: record.link }
            : record
        const next = withValue(record, t, change.to, owned)
        owned.add(next)
        // A prop's or binding's set leaves the props or bindings a copy of their own (or takes the
        // bindings out); a key's set shares them with the record it copied.
        const inner = t.prop === undefined ? undefined : next[t.key]
        if (isRecord(inner)) owned.add(inner)
        if (!inPlace || before !== record) this.#put(t.part, t.id, next, before)
      }
      written.push(recordKey(t.part, t.id))
      return undefined
    }
    const root = this.get(change.part, change.id)
    if (!root) return undefined
    const gone = this.subtree(change.id)
    this.#put(change.part, change.id, null, root)
    for (const id of gone) {
      const part = id === change.id ? change.part : (this.partOf(id) as HeldPart)
      if (id !== change.id) this.#put(part, id, null, this.get(part, id) as Rec, false)
      this.#children.clear(id)
      written.push(recordKey(part, id))
    }
    return undefined
  }

  /**
   * Writes a record (null deletes it) and keeps the indexes and counts. `unhold` false leaves the
   * record in its holder's set: a delete empties every deleted holder's set at once.
   */
  #put(part: Part, id: string, next: Rec | null, prev: Rec | undefined, unhold = true) {
    if (next === null && this.#base === undefined) this.#records[part].delete(id)
    else this.#records[part].set(id, next)
    if (part === 'meta') return
    const was = prev ? holderOf(part, prev) : undefined
    const now = next ? holderOf(part, next) : undefined
    if (was !== now || !next) {
      if (was !== undefined && unhold) this.#children.remove(was, id)
      if (now !== undefined) this.#children.add(now, id)
    }
    if (part === 'layer') {
      const [old, link] = [prev?.link, next?.link]
      if (old !== link || !next) {
        if (typeof old === 'string') this.#links.remove(old, id)
        if (typeof link === 'string') this.#links.add(link, id)
      }
    }
    this.#counts[part] += (next ? 1 : 0) - (prev ? 1 : 0)
  }
}

/** The key of every record in any of `states`, the meta's first. */
export function recordKeys(...states: ReadState[]): RecordKey[] {
  const keys = new Set<RecordKey>([recordKey('meta', 'meta')])
  for (const state of states)
    for (const part of HELD_PARTS) for (const id of state.ids(part)) keys.add(recordKey(part, id))
  return [...keys]
}
