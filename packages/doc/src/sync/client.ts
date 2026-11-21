/* eslint-disable max-lines -- one deep module: a tab's side of the session, as FigCraft's client.rs */
// One tab's side of the sync session (D4), as FigCraft's client.rs: the design the server confirmed
// and its sequence number, the tab's change sets the server has not answered yet (the queue), and
// the working design the tab reads and its commands write (the confirmed design with the queue and
// the open step on it). A step (one command, a batch of commands or a gesture) is one change set and
// one undo step, sent when it ends. Unlike FigCraft, change sets from other tabs apply while a step
// is open, under it (C30). Undo and redo follow FigCraft with D5's departures (history.ts). Given
// the tab's `recompute`, the tab brings derived values up to date after crossing edits with
// follow-ups (D6, follow-up.ts). While a step is open the tab previews it to the others, and shows
// theirs under its own (D7, previews.ts). The client saves itself as plain JSON and comes back from
// it after a reload, as after a dropped connection.
import {
  type Accepted,
  type Access,
  type Change,
  type ChangeSetKind,
  type DesignRecords,
  type DesignSize,
  type Presence,
  PROTOCOL,
  type RejectReason,
  type RestoreMark,
  type ServerMessage,
  SYNC_LIMITS,
  type TabMessage,
} from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { changedRecord, type Rec, type RecordKey, targetKey } from './changes.ts'
import { capIssue, utf8Length } from './checks.ts'
import { followUp, type Recompute, touchedBy } from './follow-up.ts'
import { BACK, FWD, type SavedStep, type Side, Step, Touches } from './history.ts'
import { fromTuples, previews, toTuples } from './previews.ts'
import { ChangeRejected, DesignState, type ReadState, recordKeys } from './state.ts'
import { stepChangeSet } from './step-change-set.ts'

/** Something to tell the person (the editor puts it in words). */
export type Notice =
  /** The server rejected a change set of the tab; `reason` is absent when the tab learned it on reconnecting. */
  | { kind: 'rejected'; changeSetId: number; changeSetKind: ChangeSetKind; reason?: RejectReason }
  /** The server no longer knew the tab (a new sync id, a dropped tab id): the queue's change sets are gone. */
  | { kind: 'lost'; changeSets: number }
  /** A step was over a change set's limits (C39): it was put back, and nothing was sent; `step` names it (null: unnamed). */
  | { kind: 'tooBig'; step: string | null }
  /** The design passed a share of one of its limits (D11). */
  | { kind: 'nearLimit'; size: DesignSize }
  /** Another tab restored a version: its member's name, and the version. */
  | { kind: 'restored'; by: string; mark: RestoreMark }

/**
 * What became of one of the tab's change sets: the server accepted it; rejected it (`reason` absent
 * when the tab learned it on reconnecting); or it was lost with the queue, the server no longer
 * knowing the tab. Or the change sets the tab made since a reload took new ids, each old id with its
 * new one, on coming back from a copy older than what it had sent: later answers name the new ids.
 */
export type Answer =
  | { kind: 'accepted'; changeSetId: number }
  | { kind: 'rejected'; changeSetId: number; reason?: RejectReason }
  | { kind: 'lost'; changeSetId: number }
  | { kind: 'renumbered'; ids: ReadonlyMap<number, number> }

/**
 * What a step that ended made: the id of its change set; 'tooBig' when it was over a change set's
 * limits and put back; null when it changed nothing.
 */
export type StepMade = number | 'tooBig' | null

/** Told which records the working design shows differently, after every change to it. */
export type ChangeListener = (changed: ReadonlySet<RecordKey>) => void

/** Another person's tab's latest presence, as the server told it: the person's number and colour with it. */
export interface SeenPresence {
  person: number
  colour: number
  /** The tab is an agent's, as its token says. */
  agent?: true
  presence: Presence
}

/** A message to the server. */
export type Outgoing = Exclude<TabMessage, { type: 'hello' }>
export type Hello = Extract<TabMessage, { type: 'hello' }>

export interface Client {
  syncId(): string
  tabId(): number
  access(): Access
  /** The sequence number of the last change set the confirmed design holds. */
  seq(): number
  /** The design's size as the server last told it. */
  size(): DesignSize
  /** The other tabs connected, by tab id, with their members' names. */
  tabs(): ReadonlyMap<number, string>
  isOnline(): boolean
  /** What the tab reads: the confirmed design with the queue and the open step on it. */
  working(): ReadState
  /** The server's design as of `seq()`. */
  confirmed(): ReadState
  /** How many change sets wait for the server's answer, sent or not. */
  queued(): number
  /** The ids of the change sets that wait for the server's answer, sent or not, oldest first. */
  queuedIds(): number[]
  /** What a change set of the tab still in the queue is for. */
  kindOf(changeSetId: number): ChangeSetKind | undefined
  /** Opens a step: the writes until it ends are one change set and one undo step. */
  open(): void
  /** Writes one change to the working design, leniently (a change to a record that is gone writes nothing). */
  write(change: Change): void
  /**
   * Ends the open step: an undo step named `name` (null: nobody undoes it), and the messages to
   * send now. A restore's step gives the version it restores (`restore`), sent with its change set.
   */
  end(name: string | null, restore?: RestoreMark): Outgoing[]
  /** What the last step `end` closed made; null too when no step has ended. */
  lastEnded(): StepMade
  /**
   * Told what became of each change set of the tab's steps as the tab learns it; a follow-up, which
   * tells no one when it is rejected (D6, 5), is told nothing. A change set dropped unsent (an undo or redo with nothing left to write, or one behind a rejected change set of its
   * step) is told nothing.
   */
  onAnswer(listener: (answer: Answer) => void): () => void
  /** Puts back the open step's writes; nothing was sent but a preview, which it clears. */
  cancel(): Outgoing[]
  stepOpen(): boolean
  /**
   * The open step's net changes so far, for the other tabs to show (D7), while a step is open and
   * the tab online; none for a step past a preview's size. The transport sends the latest, at most
   * 30 a second.
   */
  preview(): Outgoing | undefined
  /** The latest preview from each other tab. */
  previews(): ReadonlyMap<number, readonly Change[]>
  /** What the canvas draws: the confirmed design with the queue, others' previews over it, then the open step (C41). */
  shown(): ReadState
  /** Told which records the previews show otherwise. */
  onPreview(listener: ChangeListener): () => void
  /** The other people's tabs' latest presence, by tab id, the one heard from last at the end: a new map after each change. */
  presence(): ReadonlyMap<number, SeenPresence>
  /** Told whenever `presence()` changes. */
  onPresence(listener: () => void): () => void
  /** The message that sends the tab's presence; none offline, or when the server's welcome did not say it takes presence. */
  presenceMessage(presence: Presence): Outgoing | undefined
  /** Whether derived values are owed: a follow-up still to work out or to send (D6). */
  owes(): boolean
  /**
   * When a follow-up waiting on the recompute is dropped (D6, 6): the caller retries then. The
   * deadline covers everything owed while the recompute waits, from the first wait, so a record owed
   * late in the wait is dropped with the rest; a reload starts the wait again.
   */
  followUpDeadline(): number | undefined
  /** Works the owed derived values out again (a font loaded, or the deadline came); returns what to send. */
  retryFollowUps(): Outgoing[]
  undo(): Outgoing[]
  redo(): Outgoing[]
  canUndo(): boolean
  canRedo(): boolean
  /** The step names Undo and Redo would take back or redo. */
  undoName(): string | undefined
  redoName(): string | undefined
  /** Handles a server message; returns the messages to send. Throws `SyncBroken` when the connection can't go on. */
  receive(message: ServerMessage): Outgoing[]
  disconnect(): void
  /** The first message of a new connection after `disconnect`, with a fresh token. */
  reconnect(token: string): Hello
  /** What the person should hear about since the last call. */
  takeNotices(): Notice[]
  onChange(listener: ChangeListener): () => void
  /** Told the tab's access when the server changes it, mid-session or in a welcome. */
  onAccess(listener: (access: Access) => void): () => void
  /** The client as plain JSON: what `openClient` comes back from after a reload. */
  save(): SavedClient
}

/** A change set in the queue, as a saved client keeps it. */
export interface SavedQueued {
  id: number
  /** The sequence number of the design it was made on (kept when it is sent again after a reconnect). */
  base: number
  changes: Change[]
  kind: ChangeSetKind
  /** The undo step it applies, as its place in `SavedClient.steps`. */
  step?: number
  /** The version it restores: only on a restore's edit, never on its undo or redo. */
  restore?: RestoreMark
  /**
   * The design it was made on changed under it (D6, 4): another tab's change set was ordered
   * before it, or one of this tab's before it was rejected or made again. The derived values it
   * carries may be stale, so once it is accepted its author works them out again.
   */
  rebased: boolean
  /**
   * Sent on this connection. Change sets go out in order; while offline they wait, and an undo or
   * redo waits until every change set before it is answered, then is made again from the
   * confirmed design.
   */
  sent: boolean
}

/**
 * What a tab keeps so that, reloaded, it comes back as the same tab with nothing lost or sent
 * twice. The undo history starts empty again, but for the steps a queued change set still needs;
 * the open step's writes come back as one step of their own, which nobody undoes.
 */
export interface SavedClient {
  type: 'saved'
  /** Who it is: it resumes as this tab id with this secret, under this sync id. */
  syncId: string
  tabId: number
  secret: string
  access: Access
  seq: number
  confirmed: DesignRecords
  /** The next change set id: ids keep rising, so the server tells one sent again from a new one. */
  nextId: number
  /**
   * The first id given since the tab came back from its tab copy, while the server hasn't welcomed
   * it since: the tab copy may be older than what the tab sent, so these ids may be ones the server
   * took already, and they take new ones once it is heard (rejoin). Kept across later reloads;
   * absent when no id was given since.
   */
  firstIdSinceReload?: number
  queue: SavedQueued[]
  /** The steps the queued change sets apply, which `step` points into. */
  steps: SavedStep[]
  open?: Change[]
  /** The records owed a follow-up, each with the last change set id made when it came to be owed (D6, 2). */
  owed: [RecordKey, number][]
}

export interface ClientOptions {
  /** The most undo steps kept (C32). */
  historyLimit?: number
  /** The server asked for a renewed token: the caller sends one. */
  onTokenRequest?: () => void
  /** The most bytes a change set and a preview may hold, the server's (`SYNC_LIMITS`' unless given). */
  limits?: { messageBytes?: number; previewBytes?: number }
  /** Works out the tab's derived values; without it, no follow-up is sent (D6). */
  recompute?: Recompute
  /** The clock a follow-up waiting on the recompute is dropped by, in milliseconds. */
  now?: () => number
  /**
   * The tab's presence goes only to a server whose welcome says it takes a note: an agent tab's, which a
   * server without notes would show as its member's own.
   */
  presenceNeedsNote?: boolean
}

/** A change set in the queue, with the undo step it applies. */
interface Queued extends Omit<SavedQueued, 'step'> {
  /**
   * The undo step it applies (its edit, an undo or a redo). A step lives while it is in the
   * history or has a change set in the queue (D5, 1): an undo shown already still goes out made
   * again from the confirmed design after a new edit has cleared its step from the redo stack.
   */
  step: Step | undefined
}

/** The open step's writes, in order. A value written again with no create or delete between replaces its earlier write. */
interface OpenStep {
  writes: Map<string, Change>
  /** Counts the creates and deletes so far: a write after one never replaces one before it. */
  structural: number
  /** The design under the step changed while it was open (see `SavedQueued.rebased`). */
  rebased: boolean
  /** A preview of it went out: the others show it until its change set lands or a cleared one comes. */
  previewed: boolean
}

type Welcome = Extract<ServerMessage, { type: 'welcome' }>

/** The most undo steps a tab keeps (C32). */
export const HISTORY_LIMIT = 1000

/** How long a follow-up waits on the recompute (a font that never loads) before it is dropped (D6, 6). */
export const FOLLOW_UP_WAIT_MS = 30_000

const NO_SIZE: DesignSize = { layers: 0, frames: 0, pages: 0, bytes: 0 }

/** The connection can't go on: a message the client can't place. The transport reconnects. */
export class SyncBroken extends Error {}

/**
 * The client of a tab that the server's first welcome (which carries the design) let in, or the
 * one a saved client gives back, offline until it reconnects.
 */
export function openClient(start: ServerMessage | SavedClient, options: ClientOptions = {}): Client {
  const historyLimit = Math.max(1, options.historyLimit ?? HISTORY_LIMIT)
  const messageBytes = options.limits?.messageBytes ?? SYNC_LIMITS.messageBytes
  const previewBytes = options.limits?.previewBytes ?? SYNC_LIMITS.previewBytes
  const { recompute } = options
  const now = options.now ?? Date.now
  /** Who the tab is: the design's sync id, its tab id and the secret it resumes with. */
  let syncId = ''
  let tabId = 0
  let secret = ''
  /** What the server lets the tab do, and the design's size as it last told it. */
  let access: Access = 'edit'
  let size = NO_SIZE
  /** The other tabs connected, by tab id, with their members' names. */
  const others = new Map<number, string>()
  /** The server's design as of `seq`. */
  let confirmed = DesignState.fromRecords({ meta: {}, pages: {}, frames: {}, nodes: {} })
  /** The sequence number of the last change set `confirmed` holds. */
  let seq = 0
  /** The change sets the server has not answered, in order. */
  let queue: Queued[] = []
  /** `confirmed` with the queue applied. */
  let base = confirmed.overlay()
  /** `base` with the open step's writes applied: what the tab reads and writes. */
  let working = base.overlay()
  /** The open step's writes, while one is open. */
  let open: OpenStep | undefined
  /** The next change set's id. */
  let nextId = 1
  /** Until the server welcomes the tab back, the first id given since its first reload (see `SavedClient.firstIdSinceReload`). */
  let firstIdSinceReload: number | undefined
  /** Whether a welcome came on the connection that is open. */
  let online = false
  /** The undo history: steps to undo, and steps to redo, the latest last. */
  let undoStack: Step[] = []
  let redoStack: Step[] = []
  /** What the person should hear, until it is taken. */
  const notices: Notice[] = []
  /** Who hears of changes to the working design, and to the access. */
  const listeners = new Set<ChangeListener>()
  const accessListeners = new Set<(access: Access) => void>()
  /** What the last step ended made (see `lastEnded`), and who hears what became of the tab's change sets. */
  let lastEnded: StepMade = null
  const answerListeners = new Set<(answer: Answer) => void>()
  /**
   * Steps on the stacks that have something left to undo or redo that can't be written on the
   * working design as it is (D5, 4), each with the `state` it was found waiting on: a press passes
   * them and leaves them where they are, and once the design under the open step changes they are
   * tried again, by a press or when asked whether one would do anything (D5, 9). A step put back
   * to wait without being tried on the design as it is holds undefined: it is tried at the next look.
   */
  let waiting = new WeakMap<Step, number | undefined>()
  /** Counts the changes to the design under the open step. */
  let state = 0
  /**
   * Records whose derived values the tab owes a follow-up for (D6), each with the last change set
   * id it had made then. Every rebuild works them out on the confirmed design with the queue on it,
   * and a record stays owed until every change set up to that one is accepted or rejected (D6, 2):
   * until then the design they are worked out on rests on change sets that may land otherwise.
   */
  const owed = new Map<RecordKey, number>()
  /**
   * Records whose follow-up the server rejected on the design it was worked out on, or which waited
   * on the recompute too long: worked out again there they would fail again, so they are owed again
   * only once a later change set, anyone's, or a whole-design catch-up changes them (D6, 5 and 6).
   */
  const unowed = new Set<RecordKey>()
  /** The sequence number of the last change set the confirmed design took that changed each record. */
  const changedAt = new Map<RecordKey, number>()
  /** The sequence number a record not in `changedAt` counts as changed at: the confirmed design's when it was loaded. */
  let changedFrom = 0
  /** When the recompute first answered `'wait'` for what is owed, while it still does. */
  let waitingSince: number | undefined
  /** The other tabs' previews, and who hears when they change. */
  const previewsOf = previews()
  const previewListeners = new Set<ChangeListener>()
  /** Whether the welcome of the connection open said the server takes presence. */
  let takesPresence = false
  /** Whether it also said the server takes a presence's note. */
  let takesNote = false
  /**
   * The other people's tabs' latest presence, the one heard from last at the end, replaced whole on
   * each change, and who hears when it changes.
   */
  let presenceOf: ReadonlyMap<number, SeenPresence> = new Map()
  const presenceListeners = new Set<() => void>()

  if ('type' in start && start.type === 'saved') restore(start)
  else join(...designOf(start as ServerMessage))

  function join(message: Welcome, design: DesignState) {
    ;({ syncId, tabId, secret, seq, size } = message)
    takesPresence = message.presence === true
    takesNote = message.presenceNote === true
    setAccess(message.access)
    setTabs(message.tabs)
    confirmed = design
    queue = []
    // After the change sets the server took in for this tab id already, which it would ignore.
    nextId = message.processed.lastChangeSet + 1
    online = true
    firstIdSinceReload = undefined
    undoStack = []
    redoStack = []
    waiting = new WeakMap()
    owed.clear()
    unowed.clear()
    changedAt.clear()
    changedFrom = seq
    waitingSince = undefined
    rebuild()
  }

  function restore(saved: SavedClient) {
    ;({ syncId, tabId, secret, access, seq, nextId } = saved)
    firstIdSinceReload = saved.firstIdSinceReload ?? nextId
    changedFrom = seq
    for (const [key, upTo] of saved.owed) owed.set(key, upTo)
    confirmed = DesignState.fromRecords(saved.confirmed)
    const steps = saved.steps.map((step) => Step.restore(step))
    queue = saved.queue.map(({ step, ...q }) => ({ ...q, step: step === undefined ? undefined : steps[step] }))
    rebuild()
    if (!saved.open) return
    openStep()
    // Whether the step was made over a design that changed under it isn't saved: what it wrote is worked out again (D6, 4).
    rebaseFrom(queue.length)
    for (const change of saved.open) write(change)
    end(null)
  }

  function save(): SavedClient {
    const steps = [...new Set(queue.flatMap((q) => (q.step ? [q.step] : [])))]
    return {
      type: 'saved',
      syncId,
      tabId,
      secret,
      access,
      seq,
      confirmed: confirmed.toRecords(),
      nextId,
      ...(firstIdSinceReload !== undefined && firstIdSinceReload < nextId ? { firstIdSinceReload } : {}),
      queue: queue.map(({ step, ...q }) => (step ? { ...q, step: steps.indexOf(step) } : q)),
      steps: steps.map((step) => step.save()),
      ...(open ? { open: [...open.writes.values()] } : {}),
      owed: [...owed],
    }
  }

  /** The steps in the history, and those with a change set in the queue: what others' writes and a whole-design catch-up concern. */
  const liveSteps = () => new Set([...undoStack, ...redoStack, ...queue.flatMap((q) => (q.step ? [q.step] : []))])

  function openStep() {
    if (open) throw new Error('a step is open already')
    open = { writes: new Map(), structural: 0, rebased: false, previewed: false }
  }

  function write(change: Change) {
    if (!open) throw new Error('a write needs an open step')
    const written = working.apply(change, 'lenient')
    if (change.op === 'set') {
      const key = `${open.structural}:${targetKey(change.value)}`
      open.writes.delete(key)
      open.writes.set(key, change)
    } else open.writes.set(`#${++open.structural}`, change)
    if (written.length > 0) tell(new Set(written))
  }

  function end(name: string | null, restore?: RestoreMark): Outgoing[] {
    if (!open) throw new Error('no step is open')
    // The working design's own records are those the step's writes wrote, replayed on the latest base.
    const changes = stepChangeSet(base, working, working.ownKeys())
    const { rebased, previewed } = open
    open = undefined
    // A step that changed nothing makes no undo step (C32); one over a change set's limits is put back (C39).
    if (
      changes.length === 0 ||
      tooBig(changes, { id: nextId, base: seq, kind: 'edit', ...(restore ? { restore } : {}) })
    ) {
      if (changes.length > 0) notices.push({ kind: 'tooBig', step: name })
      lastEnded = changes.length > 0 ? 'tooBig' : null
      changeWorking([], () => (working = base.overlay()))
      return previewed ? cleared() : []
    }
    const step = name === null ? undefined : Step.of(name, base, working, changes)
    if (step) {
      undoStack.push(step)
      redoStack = []
      trimHistory()
    }
    working.commit()
    state++
    working = base.overlay()
    enqueue(changes, 'edit', step, rebased)
    const made = queue.at(-1) as Queued
    if (restore) made.restore = restore
    lastEnded = made.id
    return flush()
  }

  /**
   * Whether `changes` are past what the server takes in one change set: its caps, or its message
   * size, measured as the change set goes out with `head` (a new edit's unless given), a restore's mark included.
   */
  function tooBig(
    changes: readonly Change[],
    head: { id: number; base: number; kind: ChangeSetKind; restore?: RestoreMark } = {
      id: nextId,
      base: seq,
      kind: 'edit',
    },
  ): boolean {
    if (capIssue(changes)) return true
    const json = JSON.stringify({ type: 'changes', ...head, changes })
    // A character is 1 to 3 bytes in UTF-8: count them only when it could matter.
    return json.length * 3 > messageBytes && utf8Length(json) > messageBytes
  }

  /**
   * Keeps the stacks to the history's limit. A step trimmed off, or cleared from redo, still lives
   * while a change set of it is in the queue (`liveSteps`, D5, 1): it learns what others write and
   * its undo or redo is made again when it reaches the front.
   */
  function trimHistory() {
    undoStack.splice(0, Math.max(0, undoStack.length - historyLimit))
  }

  function cancel(): Outgoing[] {
    if (!open) return []
    const { previewed } = open
    open = undefined
    changeWorking([], () => (working = base.overlay()))
    return previewed ? cleared() : []
  }

  function preview(): Outgoing | undefined {
    if (!open || !online || access !== 'edit') return undefined
    const message: Outgoing = {
      type: 'preview',
      after: nextId - 1,
      changes: toTuples(stepChangeSet(base, working, working.ownKeys())),
    }
    // A step past a preview's size sends none, and lands at its end (D7).
    if (utf8Length(JSON.stringify(message)) > previewBytes) {
      const [clear] = open.previewed ? cleared() : []
      open.previewed = false
      return clear
    }
    open.previewed = true
    return message
  }

  /** The preview that clears this tab's, when online. */
  function cleared(): Outgoing[] {
    return online ? [{ type: 'preview', after: nextId - 1, changes: [] }] : []
  }

  /** What the canvas draws: the confirmed design with the queue, others' previews over it, then the open step. */
  function shown(): ReadState {
    return previewsOf.shown(base, open ? [...open.writes.values()] : [])
  }

  function tellPreviews(changed: ReadonlySet<RecordKey>) {
    if (changed.size > 0) for (const listener of previewListeners) listener(changed)
  }

  function travel(side: Side): Outgoing[] {
    if (open) throw new Error('end the open step before undo or redo')
    const from = side === BACK ? undoStack : redoStack
    /** The steps this press passed that wait, top first: they stay on the stack. */
    const passed: Step[] = []
    const putBack = () => from.push(...passed.reverse())
    for (let step = from.pop(); step; step = from.pop()) {
      if (waiting.get(step) === state) {
        passed.push(step)
        continue
      }
      const changes = step.toward(side, working)
      // Nothing of it can be written now: it waits for what would hold it, or for its own change
      // set, still on its way, to land (D5, 4); or everything it changed was changed again by
      // others, and it is dropped.
      if (changes.length === 0) {
        if (step.waits(side, working) || queue.some((q) => q.step === step && q.kind === 'edit')) {
          waiting.set(step, state)
          passed.push(step)
        }
        continue
      }
      // The derived values the restored ones imply go as a follow-up, made again with the undo when it goes.
      let follow = [] as Change[] | 'wait'
      let touched = new Set<RecordKey>()
      let rest: Step | undefined
      changeWorking([], () => {
        const next = base.overlay()
        for (const change of changes) next.apply(change, 'lenient')
        rest = step.split(side, next)
        touched = touchedBy(base, next, next.ownKeys())
        next.commit()
        if (recompute) follow = followUp(base, touched, recompute)
        if (follow !== 'wait') for (const change of follow) base.apply(change, 'lenient')
        state++
        working = base.overlay()
      })
      enqueue(changes, side === BACK ? 'undo' : 'redo', step)
      // A recompute that waits leaves the values owed: a later rebuild sends them.
      if (follow === 'wait') owe(touched)
      else if (recompute) enqueue(follow, 'followUp', step)
      ;(side === BACK ? redoStack : undoStack).push(step)
      // Taken in part, the rest stays where the step was, to wait (D5, 7).
      if (rest?.waits(side, working)) {
        waiting.set(rest, state)
        from.push(rest)
      }
      putBack()
      return flush()
    }
    putBack()
    return []
  }

  function enqueue(changes: Change[], kind: ChangeSetKind, step: Step | undefined, rebased = false) {
    queue.push({ id: nextId++, base: seq, changes, kind, step, rebased, sent: false })
  }

  /** Marks the queued change sets from `from` on, and the open step, as made on a design that changed under them (D6, 4). */
  function rebaseFrom(from: number) {
    for (const q of queue.slice(from)) q.rebased = true
    if (open) open.rebased = true
  }

  /** The derived values over `touched` are to be worked out again: the next rebuild sends what changed as a follow-up. */
  function owe(touched: Iterable<RecordKey>) {
    if (recompute) for (const key of touched) owed.set(key, nextId - 1)
  }

  /**
   * Queued change sets no longer go as they are (rejected, dropped or made again): the derived
   * values they wrote never land, and the working design's may have rested on them (D6, 3). Called
   * before the rebuild that takes them out, so what held their records in the working design counts too.
   */
  function oweFor(changeSets: readonly Queued[]) {
    owe(
      touchedBy(
        base,
        confirmed,
        changeSets.flatMap((q) => q.changes.map(changedRecord)),
      ),
    )
  }

  /** The waiting change sets that can go now, in order. */
  function flush(): Outgoing[] {
    const out: Outgoing[] = []
    if (!online) return out
    for (let i = 0; i < queue.length;) {
      const q = queue[i] as Queued
      if (q.sent) {
        i++
        continue
      }
      if (q.kind === 'undo' || q.kind === 'redo') {
        // An undo or redo goes out only from the front of the queue, made again there.
        if (i > 0) break
        // Nothing of it is left to do: it is gone; look at what came after it.
        if (!remakeFront()) continue
      }
      const next = queue[i] as Queued
      // A follow-up with nothing to bring up to date.
      if (next.kind === 'followUp' && next.changes.length === 0) {
        queue.splice(i, 1)
        continue
      }
      next.sent = true
      const { id, base: on, kind, changes, restore } = next
      out.push({ type: 'changes', id, base: on, kind, changes, ...(restore ? { restore } : {}) })
      i++
    }
    return out
  }

  /**
   * The undo or redo at the front of the queue goes out now: it is made again from the confirmed
   * design, leaving alone what others wrote since it was shown. False when nothing of it can be
   * written now: it is dropped, and its step goes back on its stack to wait if something of it is
   * left, else the step is dropped too.
   */
  function remakeFront(): boolean {
    const q = queue[0] as Queued
    const step = q.step as Step
    const side = q.kind === 'undo' ? BACK : FWD
    const changes = step.toward(side, confirmed)
    // Made again over a change set's limits, it is rejected here, as the server would reject it:
    // sent, it would be over the frame the server reads, which closes the connection, again and
    // again after every reconnect (C39).
    if (tooBig(changes, { id: q.id, base: seq, kind: q.kind })) {
      changeWorking([], () => {
        queue.shift()
        rejected(q, 'tooManyChanges')
        rebuild()
      })
      return false
    }
    if (changes.length === 0) {
      const waits = step.waits(side, confirmed)
      changeWorking([], () => {
        queue.shift()
        oweFor([q, ...dropStep(step, (other) => !other.sent)])
        if (waits) goBack(step, side)
        rebaseFrom(0)
        rebuild()
      })
      return false
    }
    const after = confirmed.overlay()
    for (const change of changes) after.apply(change, 'lenient')
    // Made again, it may take only part of the step: the rest goes back on its stack, to wait there.
    const rest = step.split(side, after)
    step.send(changes)
    changeWorking([], () => {
      if (rest?.waits(side, after)) goBack(rest, side)
      if (!sameValue(q.changes, changes)) {
        oweFor([q])
        rebaseFrom(1)
      }
      q.changes = changes
      q.base = seq
      remakeFollowUp(step, after)
      rebuild()
    })
    return true
  }

  /** The follow-up of the undo or redo made again at the front, made again over what it now writes (`after`). */
  function remakeFollowUp(step: Step, after: DesignState) {
    const next = queue[1]
    if (!recompute || next?.kind !== 'followUp' || next.step !== step || next.sent) return
    const touched = touchedBy(confirmed, after, after.ownKeys())
    oweFor([next])
    const follow = followUp(after, touched, recompute)
    // Over a change set's limits, it goes empty, which `flush` drops, and its records are owed no more (C39, D6, 5).
    const over = follow !== 'wait' && tooBig(follow, { id: next.id, base: seq, kind: 'followUp' })
    if (over)
      for (const change of follow) {
        const key = changedRecord(change)
        owed.delete(key)
        unowed.add(key)
      }
    next.changes = follow === 'wait' || over ? [] : follow
    next.base = seq
    if (follow === 'wait') owe(touched)
  }

  /** Puts `step` back on the stack it is taken from toward `side`, to wait there until it is tried again. */
  function goBack(step: Step, side: Side) {
    ;(side === BACK ? undoStack : redoStack).push(step)
    waiting.set(step, undefined)
  }

  /** Takes `step` out of both stacks, with its queued change sets that `drops` picks; returns those. */
  function dropStep(step: Step, drops: (q: Queued) => boolean): Queued[] {
    undoStack = undoStack.filter((s) => s !== step)
    redoStack = redoStack.filter((s) => s !== step)
    const dropped = queue.filter((q) => q.step === step && drops(q))
    queue = queue.filter((q) => !dropped.includes(q))
    return dropped
  }

  function receive(message: ServerMessage): Outgoing[] {
    switch (message.type) {
      case 'accepted':
        size = message.size
        accepted(message)
        return flush()
      case 'reject': {
        const mine = popSent(message.changeSetId, 'rejection')
        // Every change set ordered before this rejection arrived first: the confirmed design needs no fixing.
        changeWorking([], () => {
          rejected(mine, message.reason)
          rebuild()
        })
        return flush()
      }
      case 'welcome':
        if (online) throw new SyncBroken('a second welcome on one connection')
        size = message.size
        setTabs(message.tabs)
        takesPresence = message.presence === true
        takesNote = message.presenceNote === true
        // Everyone's latest presence comes again behind the welcome.
        clearPresence()
        // Under another sync id or as another tab id, the server no longer knows this tab.
        if (message.syncId !== syncId || message.tabId !== tabId) return restart(message)
        secret = message.secret
        setAccess(message.access)
        // Previews from before the connection dropped are done, or come again.
        tellPreviews(previewsOf.clear())
        return rejoin(message)
      case 'joined':
        others.set(message.tabId, message.name)
        return []
      case 'left':
        others.delete(message.tabId)
        tellPreviews(previewsOf.clear(message.tabId))
        clearPresence(message.tabId)
        return []
      case 'access':
        setAccess(message.access)
        return []
      case 'notice':
        notices.push({ kind: 'nearLimit', size: message.size })
        return []
      case 'token':
        options.onTokenRequest?.()
        return []
      case 'preview':
        if (message.tabId !== tabId)
          tellPreviews(previewsOf.take(message.tabId, message.after, fromTuples(message.changes)))
        return []
      case 'presence':
        if (online && message.tabId !== tabId) {
          const { person, colour, agent, presence } = message
          // At the end: the tab heard from last.
          const next = new Map(presenceOf)
          next.delete(message.tabId)
          presenceOf = next.set(message.tabId, { person, colour, ...(agent ? { agent } : {}), presence })
          tellPresence()
        }
        return []
      case 'restored':
        notices.push({ kind: 'restored', by: message.by, mark: message.mark })
        return []
      // A version the tab asked for is the page's to read, not the client's.
      case 'version':
        return []
      case 'pong':
        return []
      default:
        // A newer server's message this tab doesn't know: the connection goes on.
        return []
    }
  }

  function setAccess(next: Access) {
    if (next === access) return
    access = next
    for (const listener of accessListeners) listener(access)
  }

  /** Forgets tab `tabId`'s presence, or everyone's. */
  function clearPresence(id?: number) {
    if (id === undefined ? presenceOf.size === 0 : !presenceOf.has(id)) return
    const next = new Map(id === undefined ? [] : presenceOf)
    if (id !== undefined) next.delete(id)
    presenceOf = next
    tellPresence()
  }

  function tellPresence() {
    for (const listener of presenceListeners) listener()
  }

  /** Only the fields the server takes: it closes the connection on any other, a note too when it takes none. */
  function presenceMessage({ page, pointer, selection, frame, note }: Presence): Outgoing | undefined {
    if (!online || !takesPresence || (options.presenceNeedsNote && !takesNote)) return undefined
    const noted = takesNote && note !== undefined ? { note } : {}
    return { type: 'presence', page, pointer, selection, frame, ...noted }
  }

  function setTabs(tabs: Record<number, string>) {
    others.clear()
    for (const [id, name] of Object.entries(tabs)) others.set(Number(id), name)
  }

  /**
   * The tab's change set `changeSetId`, which the server accepted. In a catch-up it may be one the
   * queue doesn't hold, from before a reload from an older copy: then it is taken as another tab's.
   */
  function popOwn(changeSetId: number, catchingUp: boolean): Queued | undefined {
    if (!catchingUp) return popSent(changeSetId, 'acceptance')
    return queue[0]?.id === changeSetId ? queue.shift() : undefined
  }

  /** The oldest queued change set, which the server just accepted or rejected as `changeSetId`. */
  function popSent(changeSetId: number, what: string): Queued {
    const front = queue[0]
    if (!front?.sent || front.id !== changeSetId) {
      throw new SyncBroken(`${what} of change set ${changeSetId}, expected ${front?.id ?? 'none'}`)
    }
    return queue.shift() as Queued
  }

  /**
   * A change set the server accepted, in order. In a catch-up, `note` keeps what the working design
   * showed of the records it writes, and the working design is rebuilt once after the last change
   * set instead of after each.
   */
  function accepted(acc: Accepted, note?: (keys: Iterable<RecordKey>) => void) {
    if (acc.seq !== seq + 1) throw new SyncBroken(`sequence number ${acc.seq} after ${seq}`)
    const next = confirmed.overlay()
    try {
      for (const change of acc.changes) next.apply(change, 'strict')
    } catch (error) {
      if (error instanceof ChangeRejected)
        throw new SyncBroken(`change set ${acc.seq} does not apply: ${error.message}`)
      throw error
    }
    const mine = acc.author === tabId ? popOwn(acc.changeSetId, note !== undefined) : undefined
    // The step learns what its change set replaced in server order.
    if (mine && mine.kind !== 'followUp') {
      mine.step?.settle(mine.kind)
      mine.step?.refresh(confirmed, next, acc.changes, mine.kind)
    }
    // The tab's own change set, ordered after another tab's: its author brings its derived values up to date (D6).
    const touched = mine?.rebased ? touchedBy(confirmed, next, next.ownKeys()) : undefined
    const written = next.ownKeys()
    for (const key of written) changedAt.set(key, acc.seq)
    const take = () => {
      next.commit()
      seq = acc.seq
      // Another tab's change set is ordered after the steps the server accepted already: those leave its values alone.
      if (!mine) {
        const touches = Touches.of(acc.changes)
        for (const step of liveSteps()) step.othersWrote(touches)
        rebaseFrom(0)
        tellPreviews(previewsOf.accepted(acc.author, acc.changeSetId))
      }
      // So do the rests of steps taken in part, for what this tab's other steps write after them (D5, 7).
      const own = mine?.kind === 'followUp' ? undefined : mine?.step
      if (own) {
        const wrote = Touches.of(acc.changes)
        for (const step of liveSteps()) if (step !== own && step.apart) step.othersWrote(wrote)
      }
      if (touched) owe(touched)
      // A record whose follow-up was rejected is owed again once a change set changes it (D6, 5).
      owe(written.filter((key) => unowed.delete(key)))
      // The working design shows the tab's own change set already: rebuilt, it stops holding its records over the confirmed design.
      if (!note) rebuild()
      if (mine && mine.kind !== 'followUp') answer({ kind: 'accepted', changeSetId: mine.id })
    }
    if (!note) return changeWorking(written, take)
    note(written)
    take()
  }

  /**
   * Change set `q` was rejected: its step leaves the history with its change sets waiting behind
   * it, and the person hears why. A rejected undo or redo whose step has something left goes back
   * on its stack instead, to wait there, whatever the reason (D5, 4 and 8).
   */
  function rejected(q: Queued, reason?: RejectReason) {
    rebaseFrom(0)
    // A follow-up is no step and tells no one (D6, 5).
    if (q.kind === 'followUp') {
      const keys = q.changes.map(changedRecord)
      // Rejected because what it writes changed after the design it was worked out on, it is worked
      // out again; rejected on that design, it would be rejected again.
      if (keys.some((key) => (changedAt.get(key) ?? changedFrom) > q.base)) oweFor([q])
      else
        for (const key of keys) {
          owed.delete(key)
          unowed.add(key)
        }
      return
    }
    oweFor([q])
    const side = q.kind === 'undo' ? BACK : FWD
    if (q.step) oweFor(dropStep(q.step, (other) => other.id > q.id && !other.sent))
    if (q.step && q.kind !== 'edit' && q.step.waits(side, confirmed)) {
      // What others wrote while it was in flight is theirs, as for an undo lost with the connection.
      q.step.lost()
      goBack(q.step, side)
    }
    notices.push({ kind: 'rejected', changeSetId: q.id, changeSetKind: q.kind, ...(reason ? { reason } : {}) })
    answer({ kind: 'rejected', changeSetId: q.id, ...(reason ? { reason } : {}) })
  }

  /**
   * Back after a dropped connection: catch up (the missed change sets, or the whole design when the
   * server's log no longer has them), settle what the server did with this tab's change sets
   * meanwhile, and send the rest again, in order.
   */
  function rejoin(message: Welcome): Outgoing[] {
    const { lastChangeSet } = message.processed
    // Back from a copy older than what it sent: the change sets made since the first reload take ids the server
    // hasn't seen, but for those it took as they are.
    if (firstIdSinceReload !== undefined && lastChangeSet >= firstIdSinceReload) {
      const taken = takenAsTheyAre(message, firstIdSinceReload)
      nextId = lastChangeSet + 1
      const renumbered = new Map<number, number>()
      for (const q of queue) {
        if (q.id < firstIdSinceReload || taken.has(q.id)) continue
        renumbered.set(q.id, nextId)
        q.id = nextId++
      }
      if (renumbered.size > 0) answer({ kind: 'renumbered', ids: renumbered })
      // A record owed until a renumbered change set settles is owed until it settles under its new id.
      for (const [key, upTo] of owed) {
        if (upTo < firstIdSinceReload) continue
        const ids = [...renumbered].filter(([old]) => old <= upTo).map(([, id]) => id)
        owed.set(key, Math.max(lastChangeSet, ...ids))
      }
    }
    nextId = Math.max(nextId, lastChangeSet + 1)
    firstIdSinceReload = undefined
    // An undo or redo lost in flight is made again: what others wrote meanwhile comes before it.
    for (const q of queue) {
      if (q.sent && q.id > lastChangeSet && (q.kind === 'undo' || q.kind === 'redo')) q.step?.lost()
    }
    const takeRejected = () => rejected(queue.shift() as Queued)
    if ('changeSets' in message.catchUp) {
      const { changeSets } = message.catchUp
      // In one pass: each change set goes on the confirmed design, and the working design is rebuilt once.
      changeWorking([], (note) => {
        for (const acc of changeSets) {
          // The change sets the server took in before this one and didn't log were rejected.
          if (acc.author === tabId) while (queue[0] && queue[0].id < acc.changeSetId) takeRejected()
          accepted(acc, note)
        }
        rebuild()
      })
    } else {
      const fresh = DesignState.fromRecords(message.catchUp.design)
      const keys = recordKeys(confirmed, fresh)
      changeWorking(keys, () => {
        const before = confirmed
        confirmed = fresh
        seq = message.seq
        // What the server accepted meanwhile is in the design; whose change sets they were isn't known.
        const rejectedIds = new Set(message.processed.rejected)
        const settled: RecordKey[] = []
        // Its own accepted change sets, on the design it last knew without those rejected: as near as
        // it can tell to where the server took them, so a step learns what its deletes took there
        // (a layer an earlier, rejected step had deleted goes with its page). `verify` below then
        // leaves what others wrote meanwhile to them.
        const at = before.overlay()
        while (queue[0] && queue[0].id <= lastChangeSet) {
          if (rejectedIds.has(queue[0].id)) takeRejected()
          else {
            const q = queue.shift() as Queued
            const next = at.overlay()
            for (const change of q.changes) next.apply(change, 'lenient')
            if (q.kind !== 'followUp') {
              q.step?.settle(q.kind)
              q.step?.refresh(at, next, q.changes, q.kind)
            }
            next.commit()
            settled.push(...q.changes.map(changedRecord))
            if (q.kind !== 'followUp') answer({ kind: 'accepted', changeSetId: q.id })
          }
        }
        // D5, 2: whole records are compared, not only values.
        for (const step of liveSteps()) if (step.confirmed) step.verify(confirmed)
        rebaseFrom(0)
        // Whether others' change sets came before those settled isn't known either, nor what held their
        // records in between: the derived values over them, and over all the design changed, are worked out again.
        const changed = keys.filter((key) => !sameValue(before.getKey(key), confirmed.getKey(key)))
        if (settled.length > 0) owe(touchedBy(before, confirmed, [...settled, ...changed]))
        for (const key of changed) changedAt.set(key, seq)
        owe(changed.filter((key) => unowed.delete(key)))
        rebuild()
      })
    }
    if (seq !== message.seq)
      throw new SyncBroken(`caught up to sequence number ${seq}, the server is at ${message.seq}`)
    // Taken in by the server but neither logged nor accepted: rejected.
    while (queue[0] && queue[0].id <= lastChangeSet) takeRejected()
    for (const q of queue) q.sent = false
    online = true
    changeWorking([], rebuild)
    return flush()
  }

  /**
   * Of the queued change sets from id `from` on, the leading run the server took under their ids as
   * they are, sent once before from a tab copy written since: those the welcome's catch-up holds
   * under their ids with the same changes, or, in a whole-design catch-up, those not rejected each of
   * whose changes writes a record the design holds already as it writes it. Changes are compared as
   * the wire carries them, which keeps no -0. The change sets after them were made under ids the
   * server took for others.
   */
  function takenAsTheyAre(message: Welcome, from: number): Set<number> {
    const { catchUp, processed } = message
    const logged =
      'changeSets' in catchUp
        ? new Map(catchUp.changeSets.filter((acc) => acc.author === tabId).map((acc) => [acc.changeSetId, acc.changes]))
        : undefined
    const design = 'design' in catchUp ? DesignState.fromRecords(catchUp.design) : undefined
    const holds = (changes: Change[]) => {
      if (!design) return false
      const next = design.overlay()
      for (const change of changes) if (next.apply(change, 'lenient').length === 0) return false
      return next.ownKeys().every((key) => sameValue(next.getKey(key), design.getKey(key)))
    }
    const taken = new Set<number>()
    for (const q of queue) {
      if (q.id < from) continue
      if (q.id > processed.lastChangeSet) break
      const changes = JSON.parse(JSON.stringify(q.changes)) as Change[]
      const same = logged ? sameValue(logged.get(q.id), changes) : !processed.rejected.includes(q.id) && holds(changes)
      if (!same) break
      taken.add(q.id)
    }
    return taken
  }

  /** The server no longer knows this tab (a new sync id, a dropped tab id): it joined as new, and its queue is gone. */
  function restart(message: Welcome): Outgoing[] {
    const lost = queue.filter((q) => q.kind !== 'followUp')
    const [, design] = designOf(message)
    tellPreviews(previewsOf.clear())
    changeWorking(recordKeys(confirmed, design), () => join(message, design))
    if (lost.length > 0) notices.push({ kind: 'lost', changeSets: lost.length })
    for (const q of lost) answer({ kind: 'lost', changeSetId: q.id })
    return []
  }

  /**
   * The working design is the confirmed design with the queue replayed (changes that no longer
   * apply are skipped; the server rejects their change set), then the open step's writes. A step
   * whose change set is replayed learns the values that change set now replaces (but an undo or
   * redo waiting to go out, which is made again when it goes).
   */
  function rebuild() {
    // What a waiting step waits for may be back.
    state++
    base = confirmed.overlay()
    for (const q of queue) {
      const step = q.kind === 'edit' || (q.sent && q.kind !== 'followUp') ? q.step : undefined
      const next = base.overlay()
      for (const change of q.changes) next.apply(change, 'lenient')
      step?.refresh(base, next, q.changes, q.kind)
      next.commit()
    }
    followUpOwed()
    working = base.overlay()
    if (open) for (const change of open.writes.values()) working.apply(change, 'lenient')
  }

  /**
   * The derived values owed, worked out on the confirmed design with every queued change set on it,
   * where their follow-up lands (D6, 1): a change set still queued can change what a value is
   * worked out from without writing the value itself. What changed goes in the queue as a
   * follow-up. A record stops being owed once every change set made before it was owed has settled
   * (D6, 2). While the recompute waits, nothing is sent and every record stays owed, until the wait
   * passes `FOLLOW_UP_WAIT_MS` and they are dropped (D6, 6).
   */
  function followUpOwed() {
    if (!recompute || owed.size === 0) return
    const worked = followUp(base, new Set(owed.keys()), recompute)
    if (worked === 'wait') {
      waitingSince ??= now()
      if (now() - waitingSince < FOLLOW_UP_WAIT_MS) return
      for (const key of owed.keys()) unowed.add(key)
      owed.clear()
      waitingSince = undefined
      return
    }
    waitingSince = undefined
    // A record whose follow-up was rejected is not written again until someone else writes it (D6, 5).
    const follow = worked.filter((change) => !unowed.has(changedRecord(change)))
    const oldest = queue[0]?.id ?? nextId
    for (const [key, upTo] of owed) if (oldest > upTo) owed.delete(key)
    if (follow.length === 0) return
    // Over a change set's limits, it is dropped as a rejected follow-up is: its records are not
    // written again until someone else writes them (C39, D6, 5).
    if (tooBig(follow, { id: nextId, base: seq, kind: 'followUp' })) {
      for (const change of follow) {
        const key = changedRecord(change)
        owed.delete(key)
        unowed.add(key)
      }
      return
    }
    enqueue(follow, 'followUp', undefined)
    for (const change of follow) base.apply(change, 'lenient')
    if (open) open.rebased = true
  }

  function retryFollowUps(): Outgoing[] {
    changeWorking([], rebuild)
    return flush()
  }

  /**
   * Runs `change`, which may change the confirmed design (`changedKeys` are the records it changes
   * there, and it may `note` more before it changes them), the queue or the working design, then
   * tells the listeners which records the working design shows differently.
   */
  function changeWorking(
    changedKeys: Iterable<RecordKey>,
    change: (note: (keys: Iterable<RecordKey>) => void) => void,
  ) {
    const before = new Map<RecordKey, Rec | undefined>()
    // What the working design shows of more records, before `change` changes them.
    const note = (keys: Iterable<RecordKey>) => {
      for (const key of keys) if (!before.has(key)) before.set(key, working.getKey(key))
    }
    note([...base.ownKeys(), ...working.ownKeys(), ...changedKeys])
    try {
      change(note)
    } finally {
      // Told even when `change` throws partway (a catch-up the client can't place): what it changed shows.
      const changed = new Set<RecordKey>()
      for (const key of [...before.keys(), ...base.ownKeys(), ...working.ownKeys()]) {
        const was = before.has(key) ? before.get(key) : confirmed.getKey(key)
        if (!changed.has(key) && !sameValue(was, working.getKey(key))) changed.add(key)
      }
      if (changed.size > 0) tell(changed)
    }
  }

  /**
   * The step a press would take toward `side` on `stack`: the topmost that is not known to wait. A
   * step found waiting on an earlier state is tried again first (D5, 9), and stays waiting if it
   * still has nothing it can write.
   */
  function nextOf(stack: readonly Step[], side: Side): Step | undefined {
    for (let at = stack.length - 1; at >= 0; at--) {
      const step = stack[at] as Step
      if (!waiting.has(step)) return step
      if (waiting.get(step) === state) continue
      if (step.toward(side, working).length > 0) {
        waiting.delete(step)
        return step
      }
      waiting.set(step, state)
    }
    return undefined
  }

  function tell(changed: ReadonlySet<RecordKey>) {
    for (const listener of listeners) listener(changed)
  }

  function answer(told: Answer) {
    for (const listener of answerListeners) listener(told)
  }

  function disconnect() {
    online = false
    takesPresence = false
    takesNote = false
    // Others' previews and presence are not kept past the connection: a cleared one could not come.
    tellPreviews(previewsOf.clear())
    clearPresence()
  }

  function reconnect(token: string): Hello {
    online = false
    return { type: 'hello', protocol: PROTOCOL, token, resume: { syncId, tabId, seq, secret }, waiting: queue.length }
  }

  return {
    syncId: () => syncId,
    tabId: () => tabId,
    access: () => access,
    seq: () => seq,
    size: () => size,
    tabs: () => others,
    isOnline: () => online,
    working: () => working,
    confirmed: () => confirmed,
    queued: () => queue.length,
    queuedIds: () => queue.map((q) => q.id),
    kindOf: (id) => queue.find((q) => q.id === id)?.kind,
    open: openStep,
    write,
    end,
    lastEnded: () => lastEnded,
    onAnswer: (listener) => listen(answerListeners, listener),
    cancel,
    stepOpen: () => open !== undefined,
    preview,
    previews: () => previewsOf.all(),
    shown,
    onPreview: (listener) => listen(previewListeners, listener),
    presence: () => presenceOf,
    onPresence: (listener) => listen(presenceListeners, listener),
    presenceMessage,
    owes: () => owed.size > 0,
    followUpDeadline: () => (waitingSince === undefined ? undefined : waitingSince + FOLLOW_UP_WAIT_MS),
    retryFollowUps,
    undo: () => travel(BACK),
    redo: () => travel(FWD),
    canUndo: () => nextOf(undoStack, BACK) !== undefined,
    canRedo: () => nextOf(redoStack, FWD) !== undefined,
    undoName: () => nextOf(undoStack, BACK)?.name,
    redoName: () => nextOf(redoStack, FWD)?.name,
    receive,
    disconnect,
    reconnect,
    takeNotices: () => notices.splice(0),
    onChange: (listener) => listen(listeners, listener),
    onAccess: (listener) => listen(accessListeners, listener),
    save,
  }
}

/** A welcome that carries the design, and the design as a state. */
function designOf(message: ServerMessage): [Welcome, DesignState] {
  if (message.type !== 'welcome' || !('design' in message.catchUp)) {
    throw new SyncBroken('a tab starts from a welcome with the design')
  }
  return [message, DesignState.fromRecords(message.catchUp.design)]
}

/** Adds `listener` to `set`; returns what takes it out. */
function listen<L>(set: Set<L>, listener: L): () => void {
  set.add(listener)
  return () => set.delete(listener)
}
