// One tab's undo and redo, as in FigCraft's history.rs, with D5's departures. Each undoable change
// set of the tab is a step: by target, the value it wrote and the value it replaced, and the records
// it created or deleted, whole. An undo writes the replaced values back, but only where no other tab
// wrote after the step in server order; a redo goes the other way. Other tabs' change sets never
// become steps.
import {
  BindableProperty,
  type Change,
  type ChangeSetKind,
  frameOfLayer,
  type HeldPart,
  type Target,
} from '@dazbee/schema'

import { ownLink } from '../repair.ts'
import { sameValue } from '../same-value.ts'
import {
  BINDINGS_KEY,
  depthAmong,
  holderOf,
  holderTarget,
  orderTarget,
  type Rec,
  type RecordKey,
  recordKey,
  setOf,
  targetKey,
  valueAt,
} from './changes.ts'
import { stateLookup } from './checks.ts'
import { applyChangeSet } from './journal.ts'
import type { DesignState, ReadState } from './state.ts'

/** A side of a step: the state before it (`BACK`) or after it (`FWD`). */
export type Side = 0 | 1

/** A step as plain JSON, for the device copy: a value or record absent on a side is left out. */
export interface SavedStep {
  name: string
  confirmed: boolean
  settledForward: boolean
  apart?: true
  inFlight?: { mine: string[]; seen: { targets: string[]; records: string[] } }
  writes: { target: Target; before?: unknown; after?: unknown }[]
  records: { part: HeldPart; id: string; before?: Rec; after?: Rec; frame?: string }[]
  taken: string[]
  takenRecords: string[]
}

/** A value a step wrote, on each side of it. */
interface Write {
  target: Target
  sides: [unknown, unknown]
}

/** A record a step created or deleted, whole on the side it exists on. */
interface Whole {
  part: HeldPart
  id: string
  sides: [Rec | undefined, Rec | undefined]
  /** For a layer, the frame it was in on that side. */
  frame: string | undefined
}

export const BACK: Side = 0
export const FWD: Side = 1

/** What another tab's change set wrote, to mark the steps it conflicts with. */
export class Touches {
  readonly targets = new Set<string>()
  /** Records created (or created again): every value they hold is written. */
  readonly records = new Set<RecordKey>()

  static of(changes: readonly Change[]): Touches {
    const touches = new Touches()
    for (const change of changes) {
      if (change.op === 'set') touches.targets.add(targetKey(change.value))
      else if (change.op === 'create') touches.records.add(recordKey(change.part, change.id))
    }
    return touches
  }

  absorb(other: Touches) {
    for (const key of other.targets) this.targets.add(key)
    for (const key of other.records) this.records.add(key)
  }

  /**
   * Whether these writes change `target`. A layer's bindings set whole write each of its bindings,
   * and a binding set writes the layer's bindings whole.
   */
  hits(target: Target): boolean {
    if (this.targets.has(targetKey(target)) || this.records.has(recordKey(target.part, target.id))) return true
    if (target.part !== 'layer' || target.key !== BINDINGS_KEY) return false
    if (target.prop !== undefined) return this.targets.has(targetKey({ ...target, prop: undefined }))
    return BindableProperty.options.some((prop) => this.targets.has(targetKey({ ...target, prop })))
  }
}

/** One step of the undo history: what a step wrote and what it replaced, to take back or do again. */
export class Step {
  /** The step name Undo and Redo show. */
  readonly name: string
  /** The server confirmed the step's last change set sent, and none of it is in flight: others' later change sets conflict with it. */
  confirmed = false
  /** That confirmed change set went towards the after side (the edit or a redo; false: an undo). */
  settledForward = true
  /**
   * What is left of a step taken back, or redone, only in part: it leaves alone what the tab's
   * other steps write after it, as it does what others write. Its own writes are the step's, which
   * the steps below it may take back as ever.
   */
  apart = false
  /** While an undo or redo of it is in flight: the targets it writes, and what others wrote meanwhile. */
  #inFlight: { mine: Set<string>; seen: Touches } | undefined
  #writes: Map<string, Write>
  #records: Map<RecordKey, Whole>
  /** Targets others wrote after this step: it never writes them again. */
  readonly #taken = new Set<string>()
  /** Records others created again after this step: it never deletes them. */
  readonly #takenRecords = new Set<RecordKey>()

  private constructor(name: string, writes: Map<string, Write>, records: Map<RecordKey, Whole>) {
    this.name = name
    this.#writes = writes
    this.#records = records
  }

  /** The step of the change set that turned `pre` into `post` with `changes`. */
  static of(name: string, pre: ReadState, post: ReadState, changes: readonly Change[]): Step {
    const { writes, records } = capture(pre, post, changes, false)
    return new Step(name, writes, records)
  }

  /** A step from its device copy. */
  static restore(saved: SavedStep): Step {
    const writes = new Map(
      saved.writes.map(({ target, before, after }): [string, Write] => [
        targetKey(target),
        { target, sides: [before, after] },
      ]),
    )
    const records = new Map(
      saved.records.map(({ part, id, before, after, frame }): [RecordKey, Whole] => [
        recordKey(part, id),
        { part, id, sides: [before, after], frame },
      ]),
    )
    const step = new Step(saved.name, writes, records)
    step.confirmed = saved.confirmed
    step.settledForward = saved.settledForward
    step.apart = saved.apart === true
    for (const key of saved.taken) step.#taken.add(key)
    for (const key of saved.takenRecords) step.#takenRecords.add(key)
    if (saved.inFlight) {
      const seen = new Touches()
      for (const key of saved.inFlight.seen.targets) seen.targets.add(key)
      for (const key of saved.inFlight.seen.records) seen.records.add(key)
      step.#inFlight = { mine: new Set(saved.inFlight.mine), seen }
    }
    return step
  }

  /** The step as plain JSON. */
  save(): SavedStep {
    const side = (value: unknown, name: 'before' | 'after') => (value === undefined ? {} : { [name]: value })
    const inFlight = this.#inFlight
    return {
      name: this.name,
      confirmed: this.confirmed,
      settledForward: this.settledForward,
      ...(this.apart ? { apart: true as const } : {}),
      ...(inFlight
        ? {
            inFlight: {
              mine: [...inFlight.mine],
              seen: { targets: [...inFlight.seen.targets], records: [...inFlight.seen.records] },
            },
          }
        : {}),
      writes: [...this.#writes.values()].map(({ target, sides }) => ({
        target,
        ...side(sides[0], 'before'),
        ...side(sides[1], 'after'),
      })),
      records: [...this.#records.values()].map(({ part, id, sides, frame }) => ({
        part,
        id,
        ...(side(sides[0], 'before') as { before?: Rec }),
        ...(side(sides[1], 'after') as { after?: Rec }),
        ...(frame === undefined ? {} : { frame }),
      })),
      taken: [...this.#taken],
      takenRecords: [...this.#takenRecords],
    }
  }

  /**
   * A change set of the step (its edit, an undo or a redo: `kind`) applied again, now on `pre` (giving
   * `post`): what it replaced is now taken from `pre`, what it wrote from `post`. The edit's records
   * become those it now creates and deletes (a layer someone put inside one it deletes comes back
   * with an undo); an undo or redo only updates the step's own records.
   */
  refresh(pre: ReadState, post: ReadState, changes: readonly Change[], kind: ChangeSetKind) {
    const { writes, records } = capture(pre, post, changes, true)
    const [p, q] = kind === 'undo' ? [FWD, BACK] : [BACK, FWD]
    for (const [key, { sides }] of writes) {
      const mine = this.#writes.get(key)
      if (!mine || this.#taken.has(key)) continue
      mine.sides[p] = sides[0]
      mine.sides[q] = sides[1]
    }
    const oriented = [...records].map(([key, whole]): [RecordKey, Whole] => {
      const sides: Whole['sides'] = [undefined, undefined]
      sides[p] = whole.sides[0]
      sides[q] = whole.sides[1]
      // Replayed where what held it is gone, a layer is in no frame: it keeps the one it was in.
      return [key, { ...whole, sides, frame: whole.frame ?? this.#records.get(key)?.frame }]
    })
    if (kind === 'edit') this.#records = new Map(oriented)
    else for (const [key, whole] of oriented) if (this.#records.has(key)) this.#records.set(key, whole)
  }

  /** An undo or redo of the step (`changes`) goes out: others' change sets until it is confirmed are ordered before it. */
  send(changes: readonly Change[]) {
    this.confirmed = false
    const mine = new Set(changes.flatMap((c) => (c.op === 'set' ? [targetKey(c.value)] : [])))
    this.#inFlight = { mine, seen: new Touches() }
  }

  /** The server confirmed the step's change set of `kind`. */
  settle(kind: ChangeSetKind) {
    this.confirmed = true
    this.#inFlight = undefined
    this.settledForward = kind !== 'undo'
  }

  /** Its undo or redo in flight was lost with the connection: it is made again, after what others wrote meanwhile. */
  lost() {
    this.confirmed = true
    if (this.#inFlight) this.#taint(this.#inFlight.seen, new Set())
    this.#inFlight = undefined
  }

  /**
   * Another tab's change set was ordered after the step's last change set, or before its change set
   * in flight: the values it writes are theirs from now on, but those the one in flight writes after them.
   */
  othersWrote(touches: Touches) {
    if (this.confirmed) this.#taint(touches, new Set())
    else if (this.#inFlight) {
      this.#taint(touches, this.#inFlight.mine)
      this.#inFlight.seen.absorb(touches)
    }
  }

  /**
   * The change sets since the step are unknown (a whole-design catch-up): every value that isn't
   * the one the step's confirmed change set wrote was changed by others, and every record that
   * isn't there, or is there, against what that change set left was created or deleted by others
   * (a layer moved out of a page before the step's delete of the page was ordered is still there).
   */
  verify(state: ReadState) {
    const side = this.settledForward ? FWD : BACK
    for (const [key, { target, sides }] of this.#writes) {
      if (!this.#taken.has(key) && !sameValue(state.valueOf(target), sides[side])) this.#taken.add(key)
    }
    for (const [key, { part, id, sides }] of this.#records) {
      if ((state.get(part, id) !== undefined) !== (sides[side] !== undefined)) this.#takenRecords.add(key)
    }
  }

  /**
   * The change set that takes `onto` to this step's `side` (BACK: undo, FWD: redo): the records of that
   * side created again (holders first, with their ids and values), its values written back, then
   * the records of the other side deleted. It leaves out values others wrote since, records whose
   * holder is gone, and records it created that others have put layers into. Every change of the
   * result applies, in order and all together.
   */
  toward(side: Side, onto: DesignState): Change[] {
    const planned = this.#plan(side, onto, 'written')
    // The whole step first: a rule its two sides keep may break midway (a link held twice in a frame).
    const whole = onto.overlay()
    for (const change of planned.todo) whole.apply(change, 'lenient')
    const all = [...planned.todo, ...deletesOf(whole, planned.gone)]
    if (applies(onto.overlay(), all)) return all
    // Not all of it lands: a layer coming back is judged against where the others sit now, since a
    // value written back that would move one away may be what fails.
    const { todo, gone } = this.#plan(side, onto, 'now')
    const work = onto.overlay()
    const out: Change[] = []
    applyAll(work, out, todo)
    applyAll(work, out, deletesOf(work, gone))
    return keptTogether(onto, out)
  }

  /**
   * After its change set took it toward `side` only in part (`state` holds it): the part taken
   * stays this step, and what is left to take, if anything, becomes a step of its own, apart from
   * the tab's other steps (`apart`). Values and records others took stay with this step.
   */
  split(side: Side, state: ReadState): Step | undefined {
    const writes = new Map<string, Write>()
    for (const [key, write] of this.#writes) {
      const record = state.get(write.target.part, write.target.id)
      const done = record !== undefined && sameValue(valueAt(record, write.target), write.sides[side])
      if (!done && !this.#taken.has(key)) writes.set(key, write)
    }
    const records = new Map<RecordKey, Whole>()
    for (const [key, whole] of this.#records) {
      const done = (state.get(whole.part, whole.id) !== undefined) === (whole.sides[side] !== undefined)
      if (!done && !this.#takenRecords.has(key)) records.set(key, whole)
    }
    if (writes.size + records.size === 0) return undefined
    for (const key of writes.keys()) this.#writes.delete(key)
    for (const key of records.keys()) this.#records.delete(key)
    const rest = new Step(this.name, writes, records)
    // Nothing of it is on its way: whatever others write from now on is theirs, settled or not
    // what the step it came from sent.
    rest.confirmed = true
    rest.settledForward = this.settledForward
    rest.apart = true
    return rest
  }

  /**
   * Whether the step has something left to take to `side` on `onto` (a record to bring back, a
   * value to write back or a record to delete), whether or not `toward` can write it now: what
   * would hold a record it brings back may be gone, and come back later.
   */
  waits(side: Side, onto: DesignState): boolean {
    const { todo, gone } = this.#plan(side, onto)
    return todo.length > 0 || [...gone].some((id) => onto.partOf(id) !== undefined)
  }

  /**
   * What `toward` takes to `side` on `onto`: the records to bring back, holders first, and the
   * values to write back, as changes; and the ids of the records of the other side to delete. A
   * layer coming back takes a link of its own where its frame holds its link (`placed`): judged on
   * `onto` with the values written back (`written`), or as `onto` is (`now`).
   */
  #plan(side: Side, onto: DesignState, judged: 'written' | 'now' = 'now'): { todo: Change[]; gone: Set<string> } {
    const other = side === BACK ? FWD : BACK
    const back = new Map<string, Whole>()
    for (const [key, whole] of this.#records) {
      const exists = whole.sides[side] !== undefined && whole.sides[other] === undefined
      if (exists && !this.#takenRecords.has(key) && onto.partOf(whole.id) === undefined) back.set(whole.id, whole)
    }
    const gone = new Set<string>()
    for (const [key, whole] of this.#records) {
      const exists = whole.sides[other] !== undefined && whole.sides[side] === undefined
      if (exists && !this.#takenRecords.has(key)) gone.add(whole.id)
    }
    const sets: Change[] = []
    for (const [key, { target, sides }] of this.#writes) {
      if (this.#taken.has(key) || this.#movedAway(target)) continue
      const record = onto.get(target.part, target.id)
      if (record && !sameValue(valueAt(record, target), sides[side])) sets.push(setOf(target, sides[side]))
    }
    // Where the layers already there sit once the values are written back: one this step moves out
    // of a frame no longer holds its link there.
    let written: ReadState = onto
    if (judged === 'written' && back.size > 0) {
      const overlay = onto.overlay()
      for (const change of sets) overlay.apply(change, 'lenient')
      written = overlay
    }
    const todo = [...back.values()]
      .map((whole) => ({ whole, depth: depthAmong(back, whole, (at) => holderOf(at.part, at.sides[side] as Rec)) }))
      .sort((a, b) => a.depth - b.depth)
      .map(({ whole }): Change => ({
        op: 'create',
        part: whole.part,
        id: whole.id,
        record: placed(whole, side, back, gone, onto, written),
      }))
    return { todo: [...todo, ...sets], gone }
  }

  /** Leave the values `touches` writes (but those in `except`) alone from now on. */
  #taint(touches: Touches, except: ReadonlySet<string>) {
    for (const [key, { target }] of this.#writes) if (touches.hits(target) && !except.has(key)) this.#taken.add(key)
    for (const key of this.#records.keys()) if (touches.records.has(key)) this.#takenRecords.add(key)
  }

  /** Whether `target` orders a record that someone else has since moved to another holder. */
  #movedAway(target: Target): boolean {
    const holder = holderTarget(target.part, target.id)
    const order = orderTarget(target.part, target.id)
    return holder !== undefined && target.key === order?.key && this.#taken.has(targetKey(holder))
  }
}

/** What `changes` (a change set that turned `pre` into `post`) wrote; with `same`, also the values it wrote that it didn't change. */
function capture(pre: ReadState, post: ReadState, changes: readonly Change[], same: boolean) {
  const writes = new Map<string, Write>()
  const records = new Map<RecordKey, Whole>()
  for (const change of changes) {
    if (change.op === 'create') {
      const now = post.get(change.part, change.id)
      if (now && !pre.get(change.part, change.id)) {
        const { part, id } = change
        records.set(recordKey(part, id), { part, id, sides: [undefined, now], frame: frameIn(post, part, id) })
      }
    } else if (change.op === 'delete') {
      if (!pre.get(change.part, change.id)) continue
      for (const id of pre.subtree(change.id)) {
        const part = pre.partOf(id) as HeldPart
        const was = pre.get(part, id)
        if (was && !post.get(part, id))
          records.set(recordKey(part, id), { part, id, sides: [was, undefined], frame: frameIn(pre, part, id) })
      }
    } else {
      const { value: target } = change
      const key = targetKey(target)
      const [a, b] = [pre.get(target.part, target.id), post.get(target.part, target.id)]
      // A record created or deleted by the change set is kept whole above.
      if (writes.has(key) || !a || !b) continue
      const [x, y] = [valueAt(a, target), valueAt(b, target)]
      if (same || !sameValue(x, y)) writes.set(key, { target, sides: [x, y] })
    }
  }
  return { writes, records }
}

/** The frame layer `id` is in on `state`, following its holders; undefined for a page or a frame. */
function frameIn(state: ReadState, part: HeldPart, id: string): string | undefined {
  const frame = part === 'layer' ? frameOfLayer(stateLookup(state), id) : undefined
  return frame === 'inside itself' ? undefined : frame
}

/**
 * The record `whole` comes back as on `side`: as it was there, but a layer whose holder is gone,
 * and not coming back with it (`back`), comes back into the frame it was in, when that is there;
 * and a layer whose link its frame holds already, in a layer the step does not delete (`gone`),
 * takes a link of its own, as a read does with a link held twice (repair.ts, rule 7). Where the
 * other layers sit is read from `written`: `onto`, or `onto` with the step's values written back.
 */
function placed(
  whole: Whole,
  side: Side,
  back: ReadonlyMap<string, Whole>,
  gone: ReadonlySet<string>,
  onto: ReadState,
  written: ReadState,
): Rec {
  const record = whole.sides[side] as Rec
  const holder = holderOf(whole.part, record)
  const lost = holder !== undefined && !back.has(holder) && onto.partOf(holder) === undefined
  const into = lost && whole.frame !== undefined && onto.partOf(whole.frame) === 'frame' ? whole.frame : holder
  const placed = into === holder ? record : { ...record, parentId: into }
  if (whole.part !== 'layer' || into === undefined) return placed
  const frame = written.partOf(into) === 'layer' ? frameIn(written, 'layer', into) : back.has(into) ? whole.frame : into
  const holds = (link: string) =>
    [...written.linkHolders(link)].some(
      (id) => id !== whole.id && !gone.has(id) && frameIn(written, 'layer', id) === frame,
    )
  return holds(record.link as string) ? { ...placed, link: ownLink(whole.id, holds) } : placed
}

/**
 * One delete per record of `gone` whose whole subtree is in `gone`, from the highest such records
 * down. Unlike a step's own change set (`stepChangeSet`), whose deleted records are gone with all
 * they held, an undo or redo keeps a holder that holds something it doesn't take back.
 */
function deletesOf(work: DesignState, gone: ReadonlySet<string>): Change[] {
  const deletes: Change[] = []
  const stack = [...gone].filter((id) => {
    const part = work.partOf(id)
    const holder = part && holderOf(part, work.get(part, id) as Rec)
    return part !== undefined && (holder === undefined || !gone.has(holder))
  })
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const part = work.partOf(id)
    if (!part) continue
    if (work.subtree(id).every((inside) => gone.has(inside))) deletes.push({ op: 'delete', part, id })
    else stack.push(...[...work.childrenOf(id)].filter((inside) => gone.has(inside)))
  }
  return deletes
}

/**
 * Applies `todo` to `work`, keeping in `out` the changes that apply: all together when they can,
 * else one by one, retrying those that don't while others still go in (a move back can depend on
 * another).
 */
function applyAll(work: DesignState, out: Change[], todo: readonly Change[]) {
  if (todo.length === 0) return
  if (applies(work, todo)) {
    out.push(...todo)
    return
  }
  for (let left = todo; ;) {
    const before = left.length
    left = left.filter((change) => {
      if (!applies(work, [change])) return true
      out.push(change)
      return false
    })
    if (left.length === 0 || left.length === before) return
  }
}

/** The changes of `out` that pass together on `onto`: all, or those that pass one by one in order. */
function keptTogether(onto: DesignState, out: readonly Change[]): Change[] {
  if (applies(onto.overlay(), out)) return [...out]
  const work = onto.overlay()
  return out.filter((change) => applies(work, [change]))
}

/** Whether `changes` apply to `state` and keep the design's rules, as the server checks them; if they do, `state` takes them. */
function applies(state: DesignState, changes: readonly Change[]): boolean {
  const applied = applyChangeSet(state, changes)
  if ('reason' in applied) return false
  applied.after.commit()
  return true
}
