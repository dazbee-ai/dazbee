// A design's store on a sync client (D4): commands write the client's working design, the design
// view reads it, and each step of the session is one step of the client, sent as it ends. A write
// outside a step is a step of its own that nobody undoes. plain-store.ts puts one on a server in
// memory; the editor's joins the sync server.
import {
  type BindableProperty,
  type Change,
  isRecord,
  type Part as SyncPart,
  type RestoreMark,
  type Target,
  type VariableRef,
} from '@dazbee/schema'

import { openPlainHistory, type PlainHistory } from './plain-history.ts'
import { sameValue } from './same-value.ts'
import {
  type DesignStore,
  type EndedStep,
  type History,
  type HistoryOf,
  NotSaved,
  type Part,
  type StoreChange,
  type StorePreviews,
  type TextAnchor,
} from './store.ts'
import { BINDINGS_KEY, changedRecord, META_ID, type Rec, type RecordKey, recordOf, TEXT_PROP } from './sync/changes.ts'
import type { Answer, Client, Notice, Outgoing } from './sync/client.ts'
import { applyTextOp, type TextOp, type TextValue } from './text-value.ts'

/** A tab's store on a design kept by the sync core. */
export interface ClientStore extends DesignStore {
  /** What the person should hear about since the last call, such as a change set the server rejected. */
  takeNotices(): Notice[]
  /**
   * Takes in what the client's latest messages left, once whoever delivers them is done: its
   * notices (a scratch store throws `ScratchRejected` for one it couldn't send) and the first error
   * a listener threw meanwhile, which never reaches the client.
   */
  settle(): void
  /** Sends the steps a held store kept back, then settles. A store that holds none sends nothing. */
  release(): void
}

export interface ClientStoreOptions {
  /**
   * A scratch store, whose server answers at once: a change set the server rejects, or a step too
   * big to send, throws `ScratchRejected` from the call that ended it, so the command faults.
   */
  scratch?: boolean
  /** The store keeps what it sends until `release`, so a test can order its steps against another tab's. */
  held?: boolean
}

/** A scratch store's change set was rejected, or its step was too big to send. */
export class ScratchRejected extends Error {
  readonly notices: Notice[]
  constructor(notices: Notice[]) {
    super(`the scratch store's server did not take a step: ${JSON.stringify(notices)}`)
    this.name = 'ScratchRejected'
    this.notices = notices
  }
}

/** What became of a step the store ended, once the server answered (undefined until then), and who waits for it. */
interface Ended {
  outcome: 'saved' | NotSaved | undefined
  readonly waiting: Set<() => void>
}

/** A place in a text, as a client store keeps it: an offset moved along by each change to the text. */
class TextPlace {
  offset: number
  /** Whether text inserted at its place goes after it, leaving it where it is. */
  stays: boolean
  constructor(offset: number, stays: boolean) {
    this.offset = offset
    this.stays = stays
  }
}

/** The parts whose ids a new record may not take while one holds it (C27). */
const PARTS = ['page', 'frame', 'layer'] as const

/** Notices a scratch store throws for. */
const NOT_TAKEN: ReadonlySet<Notice['kind']> = new Set(['rejected', 'tooBig'])

/** The store of the tab whose client is `client`; `send` delivers what the client sends. */
export function clientStore(
  client: Client,
  send: (messages: readonly Outgoing[]) => void,
  { scratch = false, held: holding = false }: ClientStoreOptions = {},
): ClientStore {
  const listeners = new Set<(change: StoreChange) => void>()
  /** Listeners told before `listeners`: a view kept current for the rest. */
  const firstListeners = new Set<(change: StoreChange) => void>()
  /** How many transactions are open, one inside another. */
  let depth = 0
  /** The records the open transaction changed, told once it ends. */
  const changedInTransaction = new Set<RecordKey>()
  /** Whether the store is telling its listeners of a change. */
  let notifying = false
  /** Notices taken from the client, not yet taken by the person. */
  const notices: Notice[] = []
  /** The first error a listener threw while the client told a change, thrown once the client's call is over. */
  let listenerError: { error: unknown } | undefined
  /** What a held store sends once released. */
  const kept: Outgoing[] = []
  /** The one session's history: a tab has one. */
  let history: PlainHistory | undefined
  /**
   * Whether the client's open step changed the design in a transaction that has ended: an open
   * gesture counts on the undo stack once it has, and a write that changed nothing counts for
   * nothing (ADR-0004).
   */
  let stepWrote = false
  /** Whether the open transaction changed the design. */
  let transactionWrote = false
  /** The version the open step restores, when it is a restore: sent with its change set. */
  let restoring: RestoreMark | undefined
  /** Each anchored text layer's text as last seen, and its places. */
  const anchored = new Map<string, { text: string; places: Set<WeakRef<TextPlace>> }>()
  /** What became of each step this tab ended, once known, and who waits for it. */
  const endedSteps = new WeakMap<EndedStep, Ended>()
  /** The ended steps whose change set waits for the server's answer, by the change set's id. */
  const unanswered = new Map<number, Ended>()
  /** The step the store ended last. */
  let lastEnded: EndedStep | undefined

  const working = () => client.working()
  const has = (part: Part, id: string) => working().get(part, id) !== undefined
  const isLive = (id: string) => PARTS.some((part) => has(part, id))
  const inTransaction = () => depth > 0
  const isNotifying = () => notifying
  const layer = (id: string) => working().get('layer', id)
  const snapshot = () => working().toRecords()

  function prop(id: string, path: string): unknown {
    const props = propsOf(id)
    return props && Object.hasOwn(props, path) ? props[path] : undefined
  }

  function binding(id: string, property: BindableProperty): VariableRef | undefined {
    return valueAt({ part: 'layer', id, key: BINDINGS_KEY, prop: property }) as VariableRef | undefined
  }

  function head() {
    const { meta, pages, frames } = working().toRecords()
    return { meta, pages, frames }
  }

  /** A layer's props as the working design holds them. */
  function propsOf(id: string): Rec | undefined {
    const props = working().get('layer', id)?.props
    return isRecord(props) ? props : undefined
  }

  /** The text of a live text layer, if `id` is one. */
  function liveText(id: string): string | undefined {
    const text = working().get('layer', id)?.type === 'text' ? propsOf(id)?.text : undefined
    return typeof text === 'string' ? text : undefined
  }

  /** The value `target` names in the working design, if any. */
  function valueAt({ part, id, key, prop }: Target): unknown {
    const value = working().get(part, id)?.[key]
    return prop === undefined ? value : isRecord(value) ? value[prop] : undefined
  }

  function anchorOffset({ id, position }: TextAnchor): number | null {
    const text = liveText(id)
    if (text === undefined || !(position instanceof TextPlace)) return null
    return Math.min(position.offset, text.length)
  }

  function takeNotices(): Notice[] {
    notices.push(...client.takeNotices())
    return notices.splice(0)
  }

  function onChange(listener: (change: StoreChange) => void, first = false) {
    const set = first ? firstListeners : listeners
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  /** What the client tells: the records the working design now shows otherwise. */
  function changed(keys: ReadonlySet<RecordKey>) {
    follow(keys)
    if (depth > 0) {
      for (const key of keys) changedInTransaction.add(key)
      return
    }
    // The client is mid-call (a press, a message received): a listener's error waits for `settle`.
    try {
      tell(keys)
      // A change set arriving can move a step between the stacks, or let one waiting go.
      history?.changed()
    } catch (error) {
      listenerError ??= { error }
    }
  }

  function tell(keys: ReadonlySet<RecordKey>) {
    if (keys.size === 0) return
    const change = { head: false, layers: new Set<string>() }
    for (const key of keys) {
      const { part, id } = recordOf(key)
      if (part === 'layer') change.layers.add(id)
      else change.head = true
    }
    notifying = true
    try {
      for (const listener of [...firstListeners, ...listeners]) listener(change)
    } finally {
      notifying = false
    }
  }

  /** Sends what the client gave (keeps it, on a held store), then settles. */
  function deliver(messages: readonly Outgoing[]) {
    if (holding) kept.push(...messages)
    else if (messages.length > 0) send(messages)
    settle()
  }

  function settle() {
    const fresh = client.takeNotices()
    notices.push(...fresh)
    const error = listenerError
    listenerError = undefined
    if (scratch && fresh.some((notice) => NOT_TAKEN.has(notice.kind))) throw new ScratchRejected(fresh)
    if (error) throw error.error
  }

  function setMeta(key: string, value: unknown) {
    set('meta', META_ID, key, value)
  }

  function release() {
    const messages = kept.splice(0)
    if (messages.length > 0) send(messages)
    settle()
  }

  /**
   * Runs `write` as one change, told once it ends. A write outside a session's step is a step of
   * its own, ended and sent before the listeners hear of it, and undone by no one. When the step
   * can't be sent, that is thrown, whatever a listener throws as it hears the step put back.
   */
  function transact<T>(write: () => T): T {
    const own = depth === 0 && !client.stepOpen()
    if (own) openStep()
    depth++
    let wrote = false
    let sent = false
    try {
      const result = write()
      wrote = true
      return result
    } finally {
      try {
        if (own && wrote) deliver(endStep(null))
        else if (own) deliver(client.cancel())
        sent = true
      } finally {
        depth--
        if (depth === 0) endTransaction(sent)
      }
    }
  }

  /** Tells the listeners what the outermost transaction changed; `sent` is false when its step could not be. */
  function endTransaction(sent: boolean) {
    stepWrote ||= transactionWrote && client.stepOpen()
    transactionWrote = false
    const keys = new Set(changedInTransaction)
    changedInTransaction.clear()
    if (sent) tell(keys)
    else {
      try {
        tell(keys)
      } catch {
        // What could not be sent is thrown on: a listener's error here is one more symptom of it.
      }
    }
  }

  function openStep() {
    client.open()
    stepWrote = false
    transactionWrote = false
    restoring = undefined
  }

  /** Ends the open step as an undo step named `name`, carrying its restore mark; returns what to send. */
  function endStep(name: string | null) {
    const mark = restoring
    restoring = undefined
    const out = client.end(name, mark)
    lastEnded = endedStep(client.lastEnded())
    return out
  }

  /** The step that made `made` (see `Client.lastEnded`), waiting for the server's answer when it made a change set. */
  function endedStep(made: number | 'tooBig' | null): EndedStep {
    const step: EndedStep = { endedStep: true }
    const ended: Ended = {
      outcome: made === null ? 'saved' : made === 'tooBig' ? new NotSaved('tooBig') : undefined,
      waiting: new Set(),
    }
    endedSteps.set(step, ended)
    if (typeof made === 'number') unanswered.set(made, ended)
    return step
  }

  /** What became of a change set of the tab's: the step that made it hears it. */
  function answered(answer: Answer) {
    const ended = unanswered.get(answer.changeSetId)
    if (!ended) return
    unanswered.delete(answer.changeSetId)
    if (answer.kind === 'accepted') ended.outcome = 'saved'
    else ended.outcome = new NotSaved(answer.kind, answer.kind === 'rejected' ? answer.reason : undefined)
    for (const tell of [...ended.waiting]) tell()
  }

  function whenConfirmed(step: EndedStep, signal?: AbortSignal): Promise<'saved'> {
    const ended = endedSteps.get(step)
    if (!ended) throw new Error('whenConfirmed takes a step this store ended')
    return new Promise((resolve, reject) => {
      const settle = () => {
        ended.waiting.delete(settle)
        signal?.removeEventListener('abort', settle)
        const { outcome } = ended
        if (outcome === 'saved') resolve(outcome)
        else reject(outcome ?? new NotSaved('ended'))
      }
      if (ended.outcome !== undefined || signal?.aborted) return settle()
      ended.waiting.add(settle)
      signal?.addEventListener('abort', settle)
    })
  }

  function markRestore(mark: RestoreMark) {
    if (!client.stepOpen()) throw new Error('a restore mark needs an open step')
    restoring = mark
  }

  /** Writes one change to the working design, inside a transaction. */
  function write(change: Change): void {
    if (depth === 0) {
      transact(() => write(change))
      return
    }
    const before = change.op === 'set' ? valueAt(change.value) : undefined
    client.write(change)
    // A write that leaves its value as it was changes nothing an undo step is kept for (C32).
    if (change.op !== 'set' || !sameValue(before, valueAt(change.value))) transactionWrote = true
  }

  function create(part: Part, id: string, record: unknown) {
    write({ op: 'create', part, id, record: record as Rec })
  }

  function set(part: SyncPart, id: string, key: string, to?: unknown) {
    write({ op: 'set', value: { part, id, key }, ...(to === undefined ? {} : { to }) })
  }

  function setProp(id: string, prop: string, to?: unknown) {
    write({ op: 'set', value: { part: 'layer', id, key: 'props', prop }, ...(to === undefined ? {} : { to }) })
  }

  function setBinding(id: string, property: BindableProperty, to?: VariableRef) {
    write({
      op: 'set',
      value: { part: 'layer', id, key: BINDINGS_KEY, prop: property },
      ...(to === undefined ? {} : { to }),
    })
  }

  function remove(part: Part, id: string) {
    write({ op: 'delete', part, id })
  }

  function editText(id: string, op: TextOp) {
    const props = propsOf(id)
    if (working().get('layer', id)?.type !== 'text' || typeof props?.text !== 'string') return
    const runs = Array.isArray(props.runs) ? (props.runs as TextValue['runs']) : []
    const value = applyTextOp({ text: props.text, runs }, op)
    // The tab's own edit moves its places by the edit itself, which the text alone can't tell.
    moveFor(id, op, props.text, value.text)
    write({ op: 'set', value: { part: 'layer', id, key: 'props', prop: TEXT_PROP }, to: value })
  }

  /** Moves the places in text `id` by `op`, which makes its text `was` into `text`; `op` is clamped as the text takes it. */
  function moveFor(id: string, op: TextOp, was: string, text: string) {
    const entry = anchored.get(id)
    if (!entry || op.kind === 'style') return
    const at = Math.min(op.at, was.length)
    for (const place of live(entry)) {
      if (op.kind === 'insert' && (place.offset > at || (place.offset === at && !place.stays)))
        place.offset += op.text.length
      if (op.kind === 'delete' && place.offset > at) place.offset -= Math.min(op.length, place.offset - at)
    }
    entry.text = text
  }

  function textAnchor(id: string, offset: number, stays = false): TextAnchor {
    const text = liveText(id)
    if (text === undefined) throw new Error(`"${id}" is not a text layer`)
    const place = new TextPlace(offset, stays)
    const entry = anchored.get(id) ?? { text, places: new Set() }
    entry.places.add(new WeakRef(place))
    anchored.set(id, entry)
    return { id, position: place }
  }

  /** The places of an anchored text still in use, dropping those gone. */
  function* live(entry: { places: Set<WeakRef<TextPlace>> }) {
    for (const ref of entry.places) {
      const place = ref.deref()
      if (place) yield place
      else entry.places.delete(ref)
    }
  }

  /**
   * Moves the places in each text another change set changed (D4): one before what changed stays,
   * one after it moves by as much as the text grew, and one inside it goes to its start. What
   * changed is the text between the longest start and end the old and new texts share.
   */
  function follow(keys: ReadonlySet<RecordKey>) {
    for (const [id, entry] of anchored) {
      if (!keys.has(`layer/${id}`)) continue
      const text = liveText(id)
      if (text === undefined || text === entry.text) continue
      const was = entry.text
      let start = 0
      while (start < was.length && start < text.length && was[start] === text[start]) start++
      let end = 0
      while (end < was.length - start && end < text.length - start && was.at(-1 - end) === text.at(-1 - end)) end++
      for (const place of live(entry)) {
        // A place that stays is left before text inserted right at it.
        if (place.stays && place.offset === start && start === was.length - end) continue
        if (place.offset >= was.length - end) place.offset += text.length - was.length
        else if (place.offset > start) place.offset = start
      }
      entry.text = text
      if (entry.places.size === 0) anchored.delete(id)
    }
  }

  function openHistory(session: HistoryOf): History {
    if (history) throw new Error('a plain store is one tab, with one session: another tab joins its server')
    const opened = openPlainHistory(
      client,
      { deliver, openStep, endStep, stepWrote: () => stepWrote, lastEnded: () => lastEnded },
      session,
    )
    history = opened
    const destroy = () => {
      opened.history.destroy()
      history = undefined
    }
    return { ...opened.history, destroy }
  }

  client.onChange(changed)
  client.onAnswer(answered)

  /** How many times the other tabs' previews changed, and who hears of it. */
  let previewRevision = 0
  const previewListeners = new Set<() => void>()
  client.onPreview(() => {
    previewRevision++
    // Told mid-call, as a change is: a listener's error waits for `settle`.
    for (const listener of [...previewListeners]) {
      try {
        listener()
      } catch (error) {
        listenerError ??= { error }
      }
    }
  })
  const previews: StorePreviews = {
    layers() {
      const ids = new Set<string>()
      for (const changes of client.previews().values()) {
        for (const change of changes) {
          const { part, id } = recordOf(changedRecord(change))
          if (part === 'layer') ids.add(id)
        }
      }
      if (ids.size === 0) return new Map()
      const shown = client.shown()
      return new Map([...ids].map((id) => [id, shown.get('layer', id)]))
    },
    revision: () => previewRevision,
    onChange(listener) {
      previewListeners.add(listener)
      return () => {
        previewListeners.delete(listener)
      }
    },
    typingIn(id) {
      const names = client.tabs()
      return (
        [...client.previews()]
          .filter(([, changes]) =>
            changes.some(
              (change) =>
                change.op === 'set' &&
                change.value.part === 'layer' &&
                change.value.id === id &&
                change.value.key === 'props' &&
                change.value.prop === TEXT_PROP,
            ),
          )
          // A tab whose name hasn't come yet, or that has none, is someone else.
          .map(([tabId]) => names.get(tabId) ?? '')
      )
    },
  }

  return {
    previews,
    takeNotices,
    settle,
    release,
    has,
    prop,
    isLive,
    create,
    set,
    unset: set,
    setProp,
    unsetProp: setProp,
    binding,
    setBinding,
    unsetBinding: setBinding,
    remove,
    editText,
    setMeta,
    markRestore,
    transact,
    inTransaction,
    notifying: isNotifying,
    onChange,
    head,
    layer,
    snapshot,
    textAnchor,
    anchorOffset,
    openHistory,
    whenConfirmed,
  }
}
