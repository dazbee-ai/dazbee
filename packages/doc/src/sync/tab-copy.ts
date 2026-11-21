// A tab copy as entries (D9), as the browser's store keeps them, so a step writes only small ones:
// the tab's identity with its confirmed design (rewritten only by a fold while the tab is idle, or
// when the design it holds no longer leads to the confirmed one), a log of the change sets accepted
// since, a head with the tab's small state, and one entry per change set in its queue, with the
// step it applies. `client.save()` is what the entries add up to; `restoreEntries` adds them up
// again. Writing them to IndexedDB is build step 8's.
import type { Accepted, DesignRecords } from '@dazbee/schema'

import { utf8Length } from './checks.ts'
import type { SavedClient, SavedQueued } from './client.ts'
import type { SavedStep } from './history.ts'
import { DesignState } from './state.ts'

/** The entries of one tab copy, by key: `tab`, `head`, `log/<seq>`, `queue/<change set id>`. */
export type Entries = Map<string, unknown>

/** What one write of a tab copy puts and removes. */
export interface TabCopyWrite {
  put: Map<string, unknown>
  remove: string[]
  /** The bytes put, as JSON. */
  bytes: number
}

/** Who the tab is, and its confirmed design as of `seq`. */
interface TabEntry {
  syncId: string
  tabId: number
  secret: string
  seq: number
  confirmed: DesignRecords
}

/** The tab's small state, rewritten when it changes. */
type HeadEntry = Pick<SavedClient, 'access' | 'firstIdSinceReload' | 'nextId' | 'open' | 'owed'>

/** A change set in the queue, with its step when it is the first queued to apply it, else that change set's id. */
type QueueEntry = Omit<SavedQueued, 'step'> & { step?: SavedStep; stepOf?: number }

/** The log is folded into the tab entry once it holds more than this many change sets, or bytes, and the tab is idle (D9). */
export const FOLD_LOG = { changeSets: 50, bytes: 1024 * 1024 }

/** A tab copy, written as entries: each write puts only what changed since the last. */
export class TabCopy {
  /** Each entry as last written, as JSON. */
  #written = new Map<string, string>()
  /** Who the tab entry says the tab is, and its sequence number. */
  #tab: Omit<TabEntry, 'confirmed'> | undefined
  /** How many change sets the log holds behind the tab entry, and their bytes. */
  #logged = 0
  #logBytes = 0

  /** Entries written before: a tab that takes up a tab copy goes on writing it. */
  constructor(entries?: Entries) {
    for (const [key, value] of entries ?? []) this.#written.set(key, JSON.stringify(value))
    const tab = entries?.get('tab') as TabEntry | undefined
    if (tab) this.#tab = { syncId: tab.syncId, tabId: tab.tabId, secret: tab.secret, seq: tab.seq }
    for (const [key, text] of this.#written) {
      if (!key.startsWith('log/')) continue
      this.#logged++
      this.#logBytes += utf8Length(text)
    }
  }

  /**
   * Writes the client as `saved` says it is, given the change sets it took on its confirmed design
   * since the last write (`heard`, in order). The tab entry is rewritten when the log no longer
   * leads from it to the confirmed design (a whole-design catch-up, a new sync id), and folded
   * when the tab is idle and its log is long.
   */
  write(saved: SavedClient, heard: readonly Accepted[]): TabCopyWrite {
    const next = new Map<string, unknown>()
    const tab = this.#tab
    const from = tab === undefined ? 0 : tab.seq + this.#logged
    const follows =
      tab !== undefined &&
      tab.syncId === saved.syncId &&
      tab.tabId === saved.tabId &&
      tab.secret === saved.secret &&
      from + heard.length === saved.seq &&
      heard.every((changeSet, at) => changeSet.seq === from + at + 1)
    const heardBytes = heard.reduce((sum, changeSet) => sum + utf8Length(JSON.stringify(changeSet)), 0)
    const idle = saved.queue.length === 0 && saved.open === undefined
    const long = this.#logged + heard.length > FOLD_LOG.changeSets || this.#logBytes + heardBytes > FOLD_LOG.bytes
    const fold = !follows || (idle && long)
    if (fold) {
      const { syncId, tabId, secret, seq, confirmed } = saved
      next.set('tab', { syncId, tabId, secret, seq, confirmed } satisfies TabEntry)
      this.#tab = { syncId, tabId, secret, seq }
      this.#logged = 0
      this.#logBytes = 0
    } else {
      for (const changeSet of heard) next.set(`log/${changeSet.seq}`, changeSet)
      next.set('tab', undefined)
      this.#logged += heard.length
      this.#logBytes += heardBytes
    }
    const head: HeadEntry = { access: saved.access, nextId: saved.nextId, owed: saved.owed }
    if (saved.firstIdSinceReload !== undefined) head.firstIdSinceReload = saved.firstIdSinceReload
    if (saved.open) head.open = saved.open
    next.set('head', head)
    const firstOf = new Map<number, number>()
    for (const { step, ...q } of saved.queue) {
      const entry: QueueEntry = { ...q }
      if (step !== undefined) {
        const first = firstOf.get(step)
        if (first === undefined) {
          firstOf.set(step, q.id)
          entry.step = saved.steps[step] as SavedStep
        } else entry.stepOf = first
      }
      next.set(`queue/${q.id}`, entry)
    }
    return this.#apply(next, fold)
  }

  /** Puts the entries that changed (`undefined` keeps an entry as it is) and removes the ones gone. */
  #apply(next: Map<string, unknown>, fold: boolean): TabCopyWrite {
    const put = new Map<string, unknown>()
    let bytes = 0
    for (const [key, value] of next) {
      if (value === undefined) continue
      const text = JSON.stringify(value)
      if (this.#written.get(key) === text) continue
      this.#written.set(key, text)
      put.set(key, value)
      bytes += utf8Length(text)
    }
    const remove = [...this.#written.keys()].filter((key) => !next.has(key) && !(key.startsWith('log/') && !fold))
    for (const key of remove) this.#written.delete(key)
    return { put, remove, bytes }
  }
}

/** Writes a tab copy's write into its entries. */
export function putEntries(entries: Entries, write: TabCopyWrite) {
  for (const key of write.remove) entries.delete(key)
  for (const [key, value] of write.put) entries.set(key, JSON.parse(JSON.stringify(value)))
}

/** The client a tab copy's entries add up to, as `client.save()` gave it. */
export function restoreEntries(entries: Entries): SavedClient {
  const tab = entries.get('tab') as TabEntry
  const head = entries.get('head') as HeadEntry
  const confirmed = DesignState.fromRecords(tab.confirmed)
  const log = [...entries]
    .filter(([key]) => key.startsWith('log/'))
    .map(([, changeSet]) => changeSet as Accepted)
    .sort((a, b) => a.seq - b.seq)
  for (const changeSet of log) for (const change of changeSet.changes) confirmed.apply(change, 'strict')
  const queued = [...entries]
    .filter(([key]) => key.startsWith('queue/'))
    .map(([, entry]) => entry as QueueEntry)
    .sort((a, b) => a.id - b.id)
  const steps: SavedStep[] = []
  const stepAt = new Map<number, number>()
  const queue = queued.map(({ step, stepOf, ...q }): SavedQueued => {
    if (step) {
      stepAt.set(q.id, steps.length)
      steps.push(step)
      return { ...q, step: steps.length - 1 }
    }
    const at = stepOf === undefined ? undefined : stepAt.get(stepOf)
    return at === undefined ? q : { ...q, step: at }
  })
  return {
    type: 'saved',
    syncId: tab.syncId,
    tabId: tab.tabId,
    secret: tab.secret,
    access: head.access,
    seq: log.at(-1)?.seq ?? tab.seq,
    confirmed: confirmed.toRecords(),
    nextId: head.nextId,
    ...(head.firstIdSinceReload === undefined ? {} : { firstIdSinceReload: head.firstIdSinceReload }),
    queue,
    steps,
    ...(head.open ? { open: head.open } : {}),
    owed: head.owed,
  }
}
