// A session's undo history on a client store: the steps and the undo of its tab's sync client. A
// step of the session (a command alone, a batch or a gesture) is one client step, opened as it
// begins and sent as it ends; what is written untracked is a step no one undoes.
import type { StepName } from './commands/step-names.ts'
import type { EndedStep, History, HistoryOf, Log } from './store.ts'
import type { Client, Outgoing } from './sync/client.ts'

/** What the history needs of its store. */
export interface HistoryStore {
  /** Sends what the client gave, and takes its notices. */
  deliver(messages: readonly Outgoing[]): void
  /** Opens a client step. */
  openStep(): void
  /** Ends the open client step as an undo step named `name` (null: nobody undoes it), with the step's restore mark. */
  endStep(name: string | null): Outgoing[]
  /** Whether the open client step has written. */
  stepWrote(): boolean
  /** The step `endStep` ended last. */
  lastEnded(): EndedStep | undefined
}

/** A client store's history, with `changed`, which the store calls when a change set from the server arrives. */
export interface PlainHistory {
  history: History
  changed(): void
}

/** The history of the session `session` on the tab whose client is `client`, in `store`. */
export function openPlainHistory(
  client: Client,
  store: HistoryStore,
  { revision, batching, refuseOpenTransaction }: HistoryOf,
): PlainHistory {
  /** The name of the step being written: the step the command being written makes or joins. */
  let naming: StepName | undefined
  /** The listeners told when the stacks may have changed. */
  const historyListeners = new Set<() => void>()
  /** Whether the open step is undoable: a tracked one, not one written untracked. */
  let openUndoable = false
  /** The step the last `end` of a log ended, if it ended one. */
  let ended: EndedStep | undefined

  const tellHistory = () => {
    for (const listener of [...historyListeners]) listener()
  }

  /** A log whose steps are the client's: undoable, named by the command that makes them, or not. */
  function logOf(undoable: boolean): Log {
    const log: Log = {
      begin: () => {
        if (client.stepOpen()) throw new Error('a plain store takes one step at a time')
        store.openStep()
        openUndoable = undoable
        return { log, from: 0 }
      },
      end: () => {
        ended = undefined
        if (!client.stepOpen()) return
        try {
          endStep()
        } finally {
          tellHistory()
        }
      },
      // The client keeps nothing of what is written untracked.
      clear: () => {},
    }
    return log
  }

  /** Ends the open step and sends it: named by its command if it is undoable. */
  function endStep() {
    const messages = store.endStep(openUndoable ? (naming ?? null) : null)
    ended = store.lastEnded()
    store.deliver(messages)
  }

  /** Whether an open gesture of the session's own has written: on the undo stack, though not yet sent. */
  const gestureWrote = () => client.stepOpen() && openUndoable && store.stepWrote()
  const canUndo = () => gestureWrote() || client.canUndo()
  const canRedo = () => !gestureWrote() && client.canRedo()

  /**
   * A press of undo, or of redo: it takes back the latest step that still has something to take
   * back, passing those whose press changed nothing the design reads; then the listeners are told.
   * Like a command, it is refused inside a batch or a transaction, and from a listener of the store.
   * A gesture open meanwhile is a step of its own up to a press that has something to take back
   * (C32), and what it writes after the press is another; a press with nothing to take back leaves
   * it whole.
   */
  function press(which: 'undo' | 'redo') {
    if (batching()) throw new Error('undo and redo are not run inside a batch')
    refuseOpenTransaction(false)
    if (!(which === 'undo' ? canUndo() : canRedo())) return
    const gesture = client.stepOpen()
    const undoable = openUndoable
    try {
      if (gesture) endStep()
      const can = which === 'undo' ? client.canUndo : client.canRedo
      while (can()) {
        const before = revision()
        store.deliver(which === 'undo' ? client.undo() : client.redo())
        if (revision() !== before) break
      }
    } finally {
      if (gesture) {
        store.openStep()
        openUndoable = undoable
      }
      tellHistory()
    }
  }

  /** Puts back what the open step wrote: nothing of it was sent, and redo is kept (C32). */
  function putBack() {
    refuseOpenTransaction(false)
    try {
      store.deliver(client.cancel())
    } finally {
      tellHistory()
    }
  }

  function undoName(): StepName | null {
    return gestureWrote() ? (naming ?? null) : ((client.undoName() as StepName | undefined) ?? null)
  }

  function redoName(): StepName | null {
    return gestureWrote() ? null : ((client.redoName() as StepName | undefined) ?? null)
  }

  function name(step: StepName | undefined) {
    naming = step
  }

  // The client's step keeps what it wrote itself.
  function beginWrite() {}

  function onHistory(listener: () => void) {
    historyListeners.add(listener)
    return () => {
      historyListeners.delete(listener)
    }
  }

  function destroy() {
    historyListeners.clear()
  }

  const history: History = {
    tracked: logOf(true),
    aside: logOf(false),
    ended: () => ended,
    name,
    beginWrite,
    press,
    putBack,
    canUndo,
    canRedo,
    undoName,
    redoName,
    onHistory,
    destroy,
  }
  return { history, changed: tellHistory }
}
