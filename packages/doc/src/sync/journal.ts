// What the sync server stores of a design, and how: the journal of what changed since the last
// fold, the one write queue per design that stores it, and its replay when the design opens (D8).
//
// - The `Journal` is the storage, async: Postgres in build step 6, `memory-journal.ts` in tests and
//   scratch stores.
// - The `WriteQueue` keeps at most one write in flight. Whenever none is, everything committed and
//   not yet stored goes in one append (group commit), and the answers to what it holds go out only
//   once it is stored (I2). A fold, or a fold that moves a bad tail to the dead letters (`bury`),
//   is a write in the same queue, after the entries it holds, and so is a version, after every
//   entry committed before it.
// - The fence: every write names the last entry its writer wrote or loaded, and fails when the
//   store holds another: a second server holding the same design turns into a failed write.
// - `replay` applies the journal to the folded state with the validity checks only (each change
//   applies; the schema and the structure rules hold), never role or size: an entry stored under one
//   policy stays good under another. An entry that no longer applies stops it (C43).
import type { Accepted, Change, Entry, NewVersion, Saved, SavedTab } from '@dazbee/schema'
import { SYNC_LIMITS } from '@dazbee/schema'

import type { RecordKey } from './changes.ts'
import { changeSetIssue, type Issue } from './checks.ts'
import { ChangeRejected, DesignState } from './state.ts'

/** What a journal loads: the state last folded, the entries stored since, oldest first, and the fence. */
export interface Loaded {
  saved: Saved
  journal: Entry[]
  /** The last entry any write stored: the fence a writer names. */
  lastEntry: number
  /** The sync id and sequence number of the newest version; null or left out when the design has none. */
  lastVersion?: { syncId: string; seq: number } | null
}

/** A version's records as stored, their JSON unparsed, and the schema version they were stored under. */
export interface StoredVersion {
  json: string
  schemaVersion: number
}

/**
 * A design's stored state and journal. Every write names the last entry its writer wrote or loaded
 * (`expected`), and fails with `Fenced` when another writer stored since. A load or a write of a
 * design whose rows are gone fails with `DesignGone`.
 */
export interface Journal {
  load(): Promise<Loaded>
  /** Appends entries, all or none. */
  append(entries: readonly Entry[], expected: number): Promise<void>
  /** Replaces the stored state with `saved`, which holds every entry stored, and drops those entries. */
  fold(saved: Saved, expected: number): Promise<void>
  /**
   * A fold of `saved`, which holds the entries before `from`, that moves the entries stored from
   * `from` on to the dead letters, with why the first of them no longer applied. `saved.entry` is
   * `expected`: entry numbers never go back, so a writer that loaded before the bury stays fenced.
   */
  bury(saved: Saved, expected: number, from: number, reason: string): Promise<void>
  /**
   * Adds a version, under the keep rules: `unchanged` when the newest version holds the same sync id
   * and sequence number (for a Before agent version, when the newest is one too), `full` when the
   * history can make no room. Neither is a failure.
   */
  version(version: NewVersion): Promise<'added' | 'unchanged' | 'full'>
  /** A version of the design as stored; null for none of this design. */
  readVersion(id: string): Promise<StoredVersion | null>
}

/** Why a write failed: another writer stored first (the fence moved). */
export class Fenced extends Error {}

/** Why a load or a write failed: the design's stored rows are gone (it was deleted while open). */
export class DesignGone extends Error {}

/** One write to a journal, with the fence it names. */
export type Write =
  | { type: 'append'; entries: Entry[]; expected: number }
  | { type: 'fold'; saved: Saved; expected: number }
  | { type: 'bury'; saved: Saved; expected: number; from: number; reason: string }
  /** Names no fence: it changes no journal entry. */
  | { type: 'version'; version: NewVersion; expected: number }

/** A change set applied on an owning overlay of a state, and the records it wrote. */
export interface Applied {
  after: DesignState
  written: Set<RecordKey>
}

/** The journal applied to the folded state, as far as it applies. */
export interface Replayed {
  state: DesignState
  syncId: string
  /** The last entry applied, and the sequence number of the last change set. */
  entry: number
  seq: number
  tabs: Map<number, SavedTab>
  /** Above every tab id the journal gave out, in a dead entry too. */
  nextTabId: number
  /** The accepted change sets applied, oldest first, with their message sizes: the catch-up log's start. */
  accepted: { changeSet: Accepted; bytes: number }[]
  /** The first entry that no longer applied and every one after it, with why, if one did not. */
  dead?: { reason: string; entries: Entry[] }
}

/** A write waiting its turn, with the answers that go out once it is stored. */
interface Queued<Out> {
  write: Write
  out: Out[]
}

/** One design's writes, in order, at most one in flight; `Out` is what goes out once a write is stored. */
export class WriteQueue<Out> {
  #queue: Queued<Out>[] = []
  #flying: Queued<Out> | undefined
  /** The last entry stored, as the next write names it. */
  #stored: number

  /** A queue for a design whose journal holds `lastEntry` as its last stored entry. */
  constructor(lastEntry: number) {
    this.#stored = lastEntry
  }

  /**
   * What one message committed, and its answers: they go out once everything committed with or
   * before them is stored, at once when that is nothing.
   */
  commit(entries: readonly Entry[], out: readonly Out[]) {
    const last = this.#queue.at(-1)
    if (last?.write.type === 'append') {
      last.write.entries.push(...entries)
      last.out.push(...out)
    } else this.#queue.push({ write: { type: 'append', entries: [...entries], expected: 0 }, out: [...out] })
  }

  /** Folds the journal into `saved`, which holds every entry committed so far, once those are stored. */
  fold(saved: Saved) {
    this.#queue.push({ write: { type: 'fold', saved, expected: 0 }, out: [] })
  }

  /** Adds a version, once everything committed before it is stored. */
  version(version: NewVersion) {
    this.#queue.push({ write: { type: 'version', version, expected: 0 }, out: [] })
  }

  /** As `fold`, moving the stored entries from `from` on to the dead letters with `reason`. */
  bury(saved: Saved, from: number, reason: string) {
    this.#queue.push({ write: { type: 'bury', saved, expected: 0, from, reason }, out: [] })
  }

  /**
   * The write to start now, if none is in flight and one waits, naming the last entry stored.
   * Answers that wait on nothing but stored writes are handed to `send` first.
   */
  next(send: (out: Out[]) => void): Write | undefined {
    if (this.#flying) return undefined
    for (let front = this.#queue.shift(); front; front = this.#queue.shift()) {
      if (front.write.type === 'append' && front.write.entries.length === 0) {
        if (front.out.length > 0) send(front.out)
        continue
      }
      front.write.expected = this.#stored
      this.#flying = front
      return front.write
    }
    return undefined
  }

  /** The write in flight is stored: the answers that waited on it. */
  stored(): Out[] {
    const flown = this.#flying
    this.#flying = undefined
    if (!flown) return []
    const { write } = flown
    // A fold, a bury or a version leaves the last entry where it was.
    if (write.type === 'append') this.#stored = (write.entries.at(-1) as Entry).entry
    return flown.out
  }

  /** The write in flight failed: nothing after it is written, and no answer waiting goes out. */
  failed() {
    this.#flying = undefined
    this.#queue = []
  }

  /** Whether a write is in flight or waits. */
  busy(): boolean {
    return this.#flying !== undefined || this.#queue.length > 0
  }
}

/** Runs one write on a journal. A version the keep rules leave out is stored as nothing, and fails nothing. */
export async function runWrite(journal: Journal, write: Write): Promise<void> {
  if (write.type === 'append') return journal.append(write.entries, write.expected)
  if (write.type === 'fold') return journal.fold(write.saved, write.expected)
  if (write.type === 'version') {
    await journal.version(write.version)
    return
  }
  return journal.bury(write.saved, write.expected, write.from, write.reason)
}

/**
 * Applies `changes` in order on an owning overlay of `state`, strictly, and checks what they wrote
 * (`changeSetIssue`): the applied change set, or why it is rejected.
 */
export function applyChangeSet(state: DesignState, changes: readonly Change[]): Applied | Issue {
  const applied = applyChanges(state, changes)
  if ('reason' in applied) return applied
  return changeSetIssue(applied.after, state, applied.written) ?? applied
}

/** Applies `changes` in order on an owning overlay of `state`, strictly, checking nothing else: the overlay, or the change that doesn't apply. */
export function applyChanges(state: DesignState, changes: readonly Change[]): Applied | Issue {
  const after = state.overlay(true)
  const written = new Set<RecordKey>()
  try {
    for (const change of changes) for (const key of after.apply(change, 'strict')) written.add(key)
  } catch (error) {
    if (error instanceof ChangeRejected) return { reason: error.reason, words: error.message }
    throw error
  }
  return { after, written }
}

/** Notes what was done with change set `id` of a tab: taken in, and rejected or not, keeping at most `keep` rejected ids. */
export function noteChangeSet(tab: SavedTab, id: number, rejected: boolean, keep: number = SYNC_LIMITS.rejectedIds) {
  tab.lastChangeSet = Math.max(tab.lastChangeSet, id)
  if (!rejected) return
  tab.rejected.push(id)
  while (tab.rejected.length > keep) tab.rejected.shift()
}

/**
 * The folded state with the journal applied, up to the first entry that no longer applies. Each
 * accepted change set is checked as a live one is, but for role and size.
 */
export function replay(loaded: Loaded, rejectedIds: number = SYNC_LIMITS.rejectedIds): Replayed {
  const { saved } = loaded
  const state = DesignState.fromRecords(saved.state, saved.placed)
  const tabs = new Map<number, SavedTab>(
    Object.entries(saved.tabs).map(([id, tab]) => [Number(id), { ...tab, rejected: [...tab.rejected] }]),
  )
  const accepted: Replayed['accepted'] = []
  let { entry, seq, nextTabId } = saved

  /** Applies one entry; why not, if it no longer applies. */
  function apply(e: Entry): string | undefined {
    if (e.entry !== entry + 1) return `it follows entry ${entry}`
    if (e.kind === 'issued') {
      for (const id of e.dropped) tabs.delete(id)
      tabs.set(e.tabId, { member: e.member, secretHash: e.secretHash, lastChangeSet: 0, rejected: [], lastSeen: e.at })
      nextTabId = Math.max(nextTabId, e.tabId + 1)
      return undefined
    }
    if (e.kind === 'rejected') {
      const tab = tabs.get(e.tabId)
      if (tab) noteChangeSet(tab, e.changeSetId, true, rejectedIds)
      return undefined
    }
    const { changeSet } = e
    if (changeSet.seq !== seq + 1) return `change set ${changeSet.seq} does not follow ${seq}`
    const applied = applyChangeSet(state, changeSet.changes)
    if ('reason' in applied) return applied.words
    applied.after.commit({ seq: changeSet.seq, author: changeSet.author })
    seq = changeSet.seq
    const tab = tabs.get(changeSet.author)
    if (tab) noteChangeSet(tab, changeSet.changeSetId, false, rejectedIds)
    accepted.push({ changeSet, bytes: e.bytes })
    return undefined
  }

  for (const [at, e] of loaded.journal.entries()) {
    const issue = apply(e)
    if (issue !== undefined) {
      const dead = { reason: `entry ${e.entry} no longer applies: ${issue}`, entries: loaded.journal.slice(at) }
      // A dead entry's tab id is not given out again.
      for (const d of dead.entries) if (d.kind === 'issued') nextTabId = Math.max(nextTabId, d.tabId + 1)
      return { state, syncId: saved.syncId, entry, seq, tabs, nextTabId, accepted, dead }
    }
    entry = e.entry
  }
  return { state, syncId: saved.syncId, entry, seq, tabs, nextTabId, accepted }
}

/** The state of a design no server has opened yet, under sync id `syncId`. */
export function firstSaved(state: Saved['state'], syncId: string): Saved {
  return { syncId, entry: 0, seq: 0, state, placed: {}, tabs: {}, nextTabId: 1, versioned: 0 }
}
