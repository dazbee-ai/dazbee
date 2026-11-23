import { nanoid } from 'nanoid'
import { z } from 'zod'

import type { Design } from '@dazbee/schema'

import { type CommandContext, CommandError, inputIssues } from './commands/define.ts'
import { type CommandName, COMMANDS } from './commands/index.ts'
import type { StepName } from './commands/step-names.ts'
import { designView, type Unread } from './design-view.ts'
import type { DesignStore, EndedStep, Step } from './store.ts'

/**
 * One gesture's undo step, from `beginGesture`: `end` closes it; `cancel` puts back all it wrote and
 * closes it, leaving no step of it to undo or redo, as Escape does to a drag. Each acts only on the
 * gesture it began, and does nothing once that gesture is closed. Either then runs the calls to
 * `untracked` that waited for the gesture (C40), and throws nothing they throw.
 */
export interface GestureStep {
  end(): void
  cancel(): void
}

/**
 * How a session is opened: `newId` makes the ids its commands give what they add, nanoid's unless
 * given; `readOnly` says whether the tab may only view the design (a Reviewer's, C35), never unless given.
 */
export interface SessionOptions {
  newId?: () => string
  readOnly?: () => boolean
}

/** Why a read-only session refuses a write (C35): the tab's member may only view the design. */
export const VIEW_ONLY = 'the design is open to view only: nothing can be changed in it'

/**
 * A bug in a command, caught by the session: its `apply` threw, or the read of the design has to
 * leave out a part after it that it read before, or to repair the design where it needed no
 * repair before. By the time it is thrown, all its step wrote is put back: the
 * command's own writes, or those of the gesture or batch it ran in. `command` and `input` are the
 * command's. For a batch whose design could not be read, which reads its commands' writes
 * together, they are `batch` and the name and input of each command it ran. The fault is thrown
 * even when a listener or an observer throws while the step is put back: it then carries what
 * that one threw, as `putBackError`.
 */
export class CommandFault extends Error {
  readonly command: string
  readonly input: unknown
  /** What a listener or an observer threw while the step was put back, when one did. */
  putBackError: unknown = undefined
  /** What a listener told of the fault threw, when one did. */
  listenerError: unknown = undefined
  constructor(command: string, input: unknown, cause: unknown) {
    super(`${command}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'CommandFault'
    this.command = command
    this.input = input
  }
}

export type CommandInput<N extends CommandName> = z.input<(typeof COMMANDS)[N]['input']>
export type CommandResult<N extends CommandName> = ReturnType<(typeof COMMANDS)[N]['apply']>
/**
 * An open gesture's step, with its name, which its first command gives when it opened without one;
 * once it has ended, the step the store ended for it (null when it was put back instead).
 */
interface Gesture extends Step {
  name: StepName | undefined
  ended?: EndedStep | null
}
/**
 * An open batch: the design as it found it, the commands it ran, the first fault among them, and
 * its name, which its first command gives when it opened without one.
 */
interface Batch {
  design: Design
  ran: { command: string; input: unknown }[]
  fault: CommandFault | null
  name: StepName | undefined
}
/**
 * What `gesture` and `batch` take: their steps, with first the name of the step they make, if any;
 * with null or none, the step takes its first command's name.
 */
type Named<T> = [steps: () => T] | [name: StepName | null, steps: () => T]

/**
 * Why a batch refuses a command that is not `batchable`: its commands all read the design from
 * before it, so one that adds, removes, moves, reorders or re-parents could not see another's.
 */
const NOT_IN_A_BATCH =
  'a batch takes only commands that change properties of what exists; run steps that add, remove, move, reorder or re-parent layers, frames or pages in a gesture, as one undo step'

/**
 * One tab's handle on a design kept in `store`. Every change goes through `run`; one command is one
 * undo step, and undo only ever reverts this session's own commands, never changes that arrived
 * from others.
 *
 * A command, or the gesture or batch it runs in, is a step. When a command faults, its step's
 * writes are put back before they are sent, so other tabs never get them (ADR-0004).
 */
export function openSession(store: DesignStore, { newId = nanoid, readOnly = () => false }: SessionOptions = {}) {
  const origin = { session: Symbol('session') }
  /** Changes this tab makes that no one undoes, as another tab's: what the brand kit's change brings. */
  const untrackedOrigin = { session: Symbol('untracked') }
  const view = designView(store)
  /**
   * The open gesture, while one is open: the commands written into its log are gathered into one
   * undo step, which `from` tells apart from the steps before it.
   */
  let open: Gesture | null = null
  /** The open batch, while one is open: its commands check and read the design as it found it. */
  let batched: Batch | null = null
  const logs = store.openHistory({
    origin,
    untrackedOrigin,
    revision: () => view.revision(),
    batching: () => batched !== null,
    refuseOpenTransaction,
  })
  const { tracked, aside, putBack } = logs
  /** What this tab's commands are written with now, and the log that captures it: `aside` inside `untracked`. */
  let writing = { origin, log: tracked }
  const faultListeners = new Set<(fault: CommandFault) => void>()
  /** How many of the session's own calls are running, one inside another: `run`, `batch`, `gesture`, `untracked`. */
  let calls = 0
  /** The faults put back since the listeners were last told. */
  const untold: CommandFault[] = []
  /** The calls to `untracked` made while a tracked gesture is open, to run once it ends (C40). */
  const waiting: (() => unknown)[] = []
  const readOnlyListeners = new Set<(refused: CommandError) => void>()
  /** Each gesture's step by what `beginGesture` gave for it, for `whenConfirmed`. */
  const gestures = new WeakMap<GestureStep, Gesture>()
  /** Aborted once the session is destroyed: a confirmation still waited for fails as ended. */
  const ending = new AbortController()

  /**
   * Throws the refusal of a write a read-only session makes, once its listeners are told; does
   * nothing when the session may write. Inside `untracked`, which runs nothing then, it never tells.
   */
  function refuseReadOnly(command: string) {
    if (!readOnly()) return
    const refused = new CommandError(command, { kind: 'refused', reason: VIEW_ONLY })
    for (const listener of [...readOnlyListeners]) listener(refused)
    throw refused
  }

  /**
   * What the read of the design newly needs after a command, in words, if anything: a part it
   * leaves out now and did not in `before`, the read before the command; or, where it repaired
   * nothing before the command, a repair. In a design
   * the read already repaired, as two tabs can leave one with no command wrong, a sound command
   * can shift what the repair does, so a repair is nothing new there.
   */
  function unreadSince(before: Unread): string | undefined {
    const now = view.unread()
    if (now === before) return undefined
    const left = now.leftOut.find(({ part, id }) => !before.leftOut.some((was) => was.part === part && was.id === id))
    if (left) return `the design leaves out ${left.part} "${left.id}": ${left.issue}`
    const [repair] = before.repairs.length === 0 ? now.repairs : []
    return repair && `the design has to be repaired: ${repair}`
  }

  /**
   * Runs one of the session's calls that run commands. Once the outermost of them is over, with
   * its step put back and the session as it was before the call, the fault listeners are told of
   * each fault put back meanwhile, before what the call threw is thrown on. What a listener
   * throws is kept on the fault, as `listenerError`, and replaces nothing.
   */
  function atRest<T>(call: () => T): T {
    calls++
    try {
      return call()
    } finally {
      calls--
      if (calls === 0) {
        for (const fault of untold.splice(0)) {
          for (const listener of [...faultListeners]) {
            try {
              listener(fault)
            } catch (error) {
              fault.listenerError ??= error
            }
          }
        }
      }
    }
  }

  /**
   * Closes the open gesture's undo step, once `putBack`, if given, has put back what it wrote: the
   * gesture is no longer open while the put-back is told. A step the store can't send is told as a
   * fault of the gesture, never thrown. Then the calls to `untracked` that waited
   * for it run, in order (C40). Nothing they throw reaches the caller, who can't hear it: a fault
   * is told to the fault listeners as any is, and anything else as a fault of `untracked`.
   */
  function close(putBack?: () => void) {
    if (!open) return
    const gesture = open
    open = null
    try {
      putBack?.()
    } finally {
      try {
        gesture.log.end()
      } catch (error) {
        // The step could not be sent, as when a scratch store's server refused it: it is put back,
        // and told as a fault of the gesture.
        const fault = error instanceof CommandFault ? error : new CommandFault('gesture', null, error)
        if (!untold.includes(fault)) untold.push(fault)
      }
      gesture.ended = putBack ? null : (logs.ended() ?? null)
      for (const steps of waiting.splice(0)) {
        // A change no one undoes runs nothing in a session that turned read-only meanwhile.
        if (readOnly()) continue
        atRest(() => {
          try {
            untrackedSteps(steps)
          } catch (error) {
            const fault = error instanceof CommandFault ? error : new CommandFault('untracked', null, error)
            if (!untold.includes(fault)) untold.push(fault)
          }
        })
      }
    }
  }

  /**
   * Runs `write`, a command's transaction or a batch's, as a step: the open gesture's when it is
   * written into that gesture's log, else one of its own. A fault puts the step back, closing the
   * gesture, and is thrown: `faultOf` gives it, from what `write` threw (`threw`) or from what
   * the read newly leaves out or repairs. Where `faultOf` gives none, what `write` threw is a refusal: a step of
   * its own is put back, an open gesture keeps what it has, and the same is thrown again.
   */
  function asStep<T>(write: () => T, faultOf: (cause: unknown, threw: boolean) => CommandFault | null): T {
    const joined = open?.log === writing.log ? open : null
    const unread = view.unread()
    logs.beginWrite()
    const step = joined ?? writing.log.begin()
    let wrote = false
    try {
      const result = write()
      wrote = true
      const broken = unreadSince(unread)
      if (broken) throw new Error(broken)
      if (!joined) step.log.end()
      return result
    } catch (cause) {
      const fault = faultOf(cause, !wrote)
      if (fault && !untold.includes(fault)) untold.push(fault)
      try {
        // A gesture a fault is in closes with its step put back.
        if (fault && joined) close(() => putBack(step))
        else if (!joined) {
          try {
            putBack(step)
          } finally {
            step.log.end()
          }
        }
      } catch (error) {
        if (!fault) throw error
        fault.putBackError = error
      }
      throw fault ?? cause
    }
  }

  /**
   * Runs a command. A refusal, of its input or by its check, throws a `CommandError` and writes
   * nothing. A fault throws a `CommandFault` once its step is put back. It never runs inside a
   * transaction the session did not open.
   */
  function run<N extends CommandName>(name: N, input: CommandInput<N>): CommandResult<N> {
    refuseOpenTransaction(true)
    refuseReadOnly(name)
    const command = COMMANDS[name]
    if (batched && !command.batchable) throw new CommandError(name, { kind: 'refused', reason: NOT_IN_A_BATCH })
    const parsed = command.input.safeParse(input)
    if (!parsed.success)
      throw new CommandError(name, { kind: 'input', issues: inputIssues(command.input, input, parsed.error) })
    const ctx: CommandContext = { w: store, design: batched?.design ?? view.read(), newId }
    const reason = command.check?.(ctx, parsed.data as never)
    if (reason) throw new CommandError(name, { kind: 'refused', reason })
    logs.name(stepNameOf(command.stepOf?.(parsed.data as never) ?? command.step))
    const apply = () => command.apply(ctx, parsed.data as never) as CommandResult<N>
    const faultOf = (cause: unknown) => new CommandFault(name, input, cause)
    if (!batched) return atRest(() => asStep(() => store.transact(apply, writing.origin), faultOf))
    // The batch is the step: it puts back what it wrote when one of its commands faults.
    batched.ran.push({ command: name, input })
    try {
      return apply()
    } catch (cause) {
      throw (batched.fault ??= faultOf(cause))
    }
  }

  /**
   * The name of the step a command that makes `step` alone writes into: the open gesture's, else
   * the open batch's, each taking the first command's name when it opened without one. A batch
   * inside a gesture is part of the gesture's step, so its own name is not used.
   */
  function stepNameOf(step: StepName): StepName {
    if (open && open.log === writing.log) return (open.name ??= step)
    if (batched) return (batched.name ??= step)
    return step
  }

  /**
   * Starts one undo step that lasts until the returned step ends or is cancelled: every command run
   * in between, such as each move of a drag or each key typed into a text, is undone together.
   * Commands from other tabs are never part of it. A command refused in it leaves it open with
   * what it has; a fault cancels it. A gesture begun while one is open joins its step and has none
   * of its own to end or cancel. The step is called `name`, or, without one, by its first command.
   */
  function beginGesture(name?: StepName | null): GestureStep {
    if (open) return { end: () => {}, cancel: () => {} }
    const gesture: Gesture = { ...writing.log.begin(), name: name ?? undefined }
    open = gesture
    const step: GestureStep = {
      end: () => {
        if (open === gesture) atRest(() => close())
      },
      cancel: () => {
        if (open !== gesture) return
        refuseOpenTransaction(false)
        atRest(() => close(() => putBack(gesture)))
      },
    }
    gestures.set(step, gesture)
    return step
  }

  /**
   * Resolves 'saved' once the sync server has stored the change set of the gesture `step` ended, at
   * once when it changed nothing; offline, it waits. Fails with `NotSaved`: 'rejected' with the
   * server's reason (the step has left both stacks, ADR-0015), 'tooBig' (put back, nothing sent),
   * 'lost' (the server no longer knew the tab, its queue dropped) or 'ended' (the session was
   * destroyed before the server answered). Throws for a gesture still open, cancelled or put back
   * by a fault, or begun while another was open, whose step it joined.
   */
  function whenConfirmed(step: GestureStep): Promise<'saved'> {
    const ended = gestures.get(step)?.ended
    if (!ended) throw new Error('whenConfirmed takes a gesture that ended with a step of its own')
    return store.whenConfirmed(ended, ending.signal)
  }

  /**
   * Runs the commands in `steps` as a change no one undoes, like one from another tab: it never
   * lands on the undo stack, and undo and redo leave it as it is. For changes that follow something
   * outside the design, such as the brand kit, which undo could not put back with them. Called while
   * a gesture of the session's own is open, it waits, and runs right after the gesture ends or is
   * cancelled, before that returns (C40): then it gives undefined.
   */
  function untracked<T>(steps: () => T): T | undefined {
    if (readOnly()) return undefined
    if (open?.log === tracked) {
      waiting.push(steps)
      return undefined
    }
    return atRest(() => untrackedSteps(steps))
  }

  function untrackedSteps<T>(steps: () => T): T {
    const was = writing
    writing = { origin: untrackedOrigin, log: aside }
    try {
      return steps()
    } finally {
      writing = was
      if (was.log !== aside) {
        // A gesture begun in here and still open would gather into a log that is emptied now.
        if (open?.log === aside) close()
        aside.clear()
      }
    }
  }

  /**
   * Runs `steps` as one gesture, called `name` when given (see `beginGesture`). When `steps` throws,
   * what the gesture wrote is put back and the same is thrown again; a gesture run inside an open
   * one has joined it, and leaves what it wrote to that one.
   */
  function gesture<T>(...args: Named<T>): T {
    const [name, steps] = args.length === 2 ? args : [undefined, args[0]]
    return atRest(() => {
      const step = beginGesture(name)
      let result: T
      try {
        result = steps()
      } catch (error) {
        step.cancel()
        throw error
      }
      step.end()
      return result
    })
  }

  /**
   * Runs the commands in `steps` as one change to the document: other tabs, the sync server and
   * the copy kept on this device get one update instead of one per command. Every command in it
   * still checks and reads the design as it was before the batch. When `steps` throws, what the
   * batch wrote is put back and the same is thrown again; a batch run inside an open gesture is
   * part of that gesture's step, and leaves what it wrote to it. Its step is called `name`, or,
   * without one, by its first command.
   */
  function batch<T>(...args: Named<T>): T {
    const [name, steps] = args.length === 2 ? args : [undefined, args[0]]
    if (batched) return steps()
    refuseOpenTransaction(false)
    refuseReadOnly('batch')
    // Read once, before the transaction: inside it the view would read the whole design again for every command.
    const batch: Batch = { design: view.read(), ran: [], fault: null, name: name ?? undefined }
    const write = () => {
      batched = batch
      let result: T
      try {
        result = store.transact(steps, writing.origin)
      } finally {
        batched = null
      }
      if (batch.fault) throw batch.fault
      return result
    }
    const faultOf = (cause: unknown, threw: boolean) =>
      batch.fault ?? (threw ? null : new CommandFault('batch', batch.ran, cause))
    return atRest(() => asStep(write, faultOf))
  }

  /**
   * Throws when the session can't write: inside a transaction it did not open, where what a
   * command wrote could not be put back, and while the store tells a change, as a transaction is
   * being closed. The transaction of the session's own batch is open to its commands (`inBatch`),
   * never to an undo.
   */
  function refuseOpenTransaction(inBatch: boolean) {
    if (store.inTransaction() && inBatch && batched) return
    if (store.inTransaction())
      throw new Error(
        'a command does not run in a transaction the session did not open: run commands together in a batch',
      )
    if (store.notifying())
      throw new Error(
        'the session does not write from an observer of the document, while a transaction is being closed',
      )
  }

  /**
   * Calls back with each fault, once: after the outermost of the session's calls it happened in
   * has put its step back and is over, so the session is at rest and the listener may run
   * commands and cancel gestures; and before that call throws the fault to its caller.
   */
  function onFault(listener: (fault: CommandFault) => void) {
    faultListeners.add(listener)
    return () => {
      faultListeners.delete(listener)
    }
  }

  /**
   * Calls back with each write a read-only session refuses, as it refuses it, before the refusal is
   * thrown; never for one inside `untracked`, which runs nothing then.
   */
  function onReadOnly(listener: (refused: CommandError) => void) {
    readOnlyListeners.add(listener)
    return () => {
      readOnlyListeners.delete(listener)
    }
  }

  /** Undoes or redoes, as `press` names, unless the session is read-only. */
  function press(side: 'undo' | 'redo') {
    refuseReadOnly(side)
    return logs.press(side, open ?? undefined)
  }

  function destroy() {
    ending.abort()
    waiting.length = 0
    faultListeners.clear()
    readOnlyListeners.clear()
    logs.destroy()
    view.destroy()
  }

  return {
    run,
    batch,
    beginGesture,
    untracked,
    /** Whether a gesture is open: its commands are still being gathered into one undo step. */
    inGesture: () => open !== null,
    gesture,
    whenConfirmed,
    undo: () => press('undo'),
    redo: () => press('redo'),
    canUndo: logs.canUndo,
    canRedo: logs.canRedo,
    undoName: logs.undoName,
    redoName: logs.redoName,
    onHistory: logs.onHistory,
    onFault,
    onReadOnly,
    /** Whether the session refuses every write now (C35): what only follows a write, such as a group fitting its layers again, need not try. */
    readOnly: () => readOnly(),
    /**
     * The design, validated. It is live: it always shows the document as it is now, and can't be
     * changed through. Its layers are frozen and replaced when they change.
     */
    design: () => view.read(),
    /**
     * How many times the document has changed since the session opened, here or from another tab:
     * while the count stays, the design shows what it showed. Null while a transaction is open on
     * the document, the session's own batch included: the design reads the writes so far, which
     * the count takes in only once the transaction ends.
     */
    changes: () => view.changes(),
    /** The parts the design leaves out for a value the schema does not take (see repair.ts). */
    leftOut: () => view.unread().leftOut,
    destroy,
  }
}
export type Session = ReturnType<typeof openSession>
