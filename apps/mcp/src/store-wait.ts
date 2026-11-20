// Waiting for the store: a step run on the agent tab is answered only once the sync server has stored the change
// sets it made (Saved means stored), so open tabs see it and nothing the agent is told was kept is lost. A change
// set the server rejects, one lost to a server that no longer knew the tab, or a step too big to send, is told as
// not kept, with why.
import type { AgentTab, ChangeSetNotice } from '@dazbee/editor/agent-tab'
import type { RejectReason } from '@dazbee/schema'

/** What became of the change sets a step made. */
export type Stored =
  /** The server stored each of them, or the step made none. */
  | { kind: 'stored' }
  /** The server keeps none of the step: `why` says why, as a sentence. */
  | { kind: 'notKept'; why: string }
  /** The server hadn't answered within the wait, or the tab stopped first: the step may still be stored. */
  | { kind: 'unconfirmed' }

/** How long to wait for the store, and the clock that waits. */
export interface StoreWait {
  ms: number
  /** Runs `run` after `ms`, giving what cancels it. */
  after: (ms: number, run: () => void) => () => void
}

/** What a step gave, and what became of the change sets it made. */
export interface Written<T> {
  value: T
  stored: Stored
}

/** How waiting for the store ended: none of the step's change sets left in the queue, the tab stopped, or the wait ran out. */
type WaitEnd = 'answered' | 'stopped' | 'late'

/** What the agent is told of a step the server hadn't answered within the wait. */
export const NOT_CONFIRMED =
  'Not confirmed yet: Dazbee hasn’t stored the step, which may still be stored or refused; before building on it, call read_design until its `waiting` is 0, and read its notices.'

/** Why the server rejected a change set, as the agent is told it. */
const REJECTED: Record<RejectReason, string> = {
  viewOnly: 'this agent may now only view the design',
  baseInFuture: 'the server could not place it in the design’s history',
  tooManyChanges: 'it changes more than one step may',
  cannotApply: 'someone changed the same layers at the same time',
  invalidRecord: 'it writes a value the design does not take',
  structure: 'someone else’s change made it impossible',
  placedSince: 'the undo would have removed what someone just added',
  designTooBig: 'the design is full; remove something to make room',
}
/** Why a step the server rejected while the tab was away was rejected: it isn't told. */
const REJECTED_AWAY = 'the server refused it while this agent’s connection was down'
const LOST = 'the server no longer knew this agent’s tab, as the design was restored meanwhile'
const TOO_BIG = 'it changes more than one step may send; split it into smaller batches'

/**
 * Runs `step` on `tab`, then waits until the tab's queue holds none of the change sets it made, at most `wait.ms`,
 * and tells what became of them. What `step` throws is thrown on, the wait not begun.
 */
export async function written<T>(tab: AgentTab, step: () => T, wait: StoreWait): Promise<Written<T>> {
  const before = new Set(tab.queuedIds())
  const told: ChangeSetNotice[] = []
  const offNotices = tab.onChangeSetNotice((notice) => told.push(notice))
  let value: T
  try {
    value = step()
  } catch (error) {
    offNotices()
    throw error
  }
  const mine = tab.queuedIds().filter((id) => !before.has(id))
  try {
    const how = await settled(tab, mine, wait)
    // What the connection tells lands a turn after the queue changed.
    await new Promise((resolve) => setImmediate(resolve))
    return { value, stored: outcome(mine, told, how) }
  } finally {
    offNotices()
  }
}

/** The real clock's `after`. */
export function afterTimeout(ms: number, run: () => void): () => void {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

/** The sentence a step not kept is told with. */
export function notKeptSentence(why: string): string {
  return `Not kept: ${why}, so the design is as it was before the step; read it again before retrying`
}

/** Settles once none of `mine` waits in the tab's queue, the tab stops, or the wait is over. */
function settled(tab: AgentTab, mine: readonly number[], { ms, after }: StoreWait) {
  return new Promise<WaitEnd>((resolve) => {
    let done = false
    const offHeard = tab.onHeard(check)
    const cancel = after(ms, () => finish('late'))
    check()
    function check() {
      const queued = new Set(tab.queuedIds())
      if (!mine.some((id) => queued.has(id))) finish('answered')
      else if (tab.stopped()) finish('stopped')
    }
    function finish(how: WaitEnd) {
      if (done) return
      done = true
      offHeard()
      cancel()
      resolve(how)
    }
  })
}

/** What became of the step's change sets, `mine`, from what the connection told and how the wait ended. */
function outcome(mine: readonly number[], told: readonly ChangeSetNotice[], how: WaitEnd): Stored {
  for (const notice of told) {
    // A follow-up of derived values rejected leaves the step itself stored.
    if (notice.kind === 'rejected' && notice.changeSetKind !== 'followUp' && mine.includes(notice.changeSetId))
      return { kind: 'notKept', why: notice.reason ? REJECTED[notice.reason] : REJECTED_AWAY }
    if (notice.kind === 'lost' && mine.length > 0) return { kind: 'notKept', why: LOST }
    if (notice.kind === 'tooBig' && mine.length === 0) return { kind: 'notKept', why: TOO_BIG }
  }
  // A tab that stopped may have had the step taken in by the server just before: it can't tell.
  if (how !== 'answered') return { kind: 'unconfirmed' }
  return { kind: 'stored' }
}
