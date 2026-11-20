// Where a design is kept, as commands, the design view and the session see it: records of plain
// JSON in the design's own shape, written through `StoreWrite` inside a transaction, each change
// told to the view as the records it touched. client-store.ts keeps them on a sync client.
import type { BindableProperty, Design, Frame, Layer, Page, RestoreMark, VariableRef } from '@dazbee/schema'

import type { StepName } from './commands/step-names.ts'
import { repair, type Repaired, type Snapshot } from './repair.ts'
import type { TextOp } from './text-value.ts'

/** The records a design keeps by id. */
export type Part = 'page' | 'frame' | 'layer'
/** The record each part keeps, as the design holds it. */
export type RecordOf<P extends Part> = { page: Page; frame: Frame; layer: Layer }[P]

/**
 * What commands read and write. A read sees what the open transaction has written so far. A record
 * is held from when it is created until it is removed. A write to a record the store does not hold
 * writes nothing.
 */
export interface StoreWrite {
  /**
   * Whether a record of `part` is held under `id`. A deleted record is gone (D1: no tombstones).
   */
  has(part: Part, id: string): boolean
  /** A held layer's prop, as stored; undefined where it has none. */
  prop(id: string, path: string): unknown
  /** A held layer's binding of `property`, as written so far; undefined where it has none. */
  binding(id: string, property: BindableProperty): VariableRef | undefined
  /**
   * Whether a page, a frame or a layer holds `id` now. A new record may not take an id while it is
   * live; one deleted is free again, and undoing the delete makes it under the same id (C27).
   */
  isLive(id: string): boolean
  /** Holds a new record under `id`: a page, a frame, or a whole layer, a text layer's text and runs included. */
  create<P extends Part>(part: P, id: string, record: RecordOf<P>): void
  /** Sets a top-level key of a record. */
  set(part: Part, id: string, key: string, value: unknown): void
  /** Takes a top-level key out of a record. */
  unset(part: Part, id: string, key: string): void
  /** Sets a key of a layer's props. */
  setProp(id: string, path: string, value: unknown): void
  /** Takes a key out of a layer's props. */
  unsetProp(id: string, path: string): void
  /** Binds a layer's `property` to `ref`, leaving its other bindings as they are. */
  setBinding(id: string, property: BindableProperty, ref: VariableRef): void
  /** Takes a layer's binding of `property` out: the layer's bindings go with its last. */
  unsetBinding(id: string, property: BindableProperty): void
  /**
   * Removes a page or a frame. A layer is deleted and stays held, so that undo brings it back with
   * what other tabs wrote to it meanwhile.
   */
  remove(part: Part, id: string): void
  /** Edits a text layer's text and runs (see text-value.ts). */
  editText(id: string, op: TextOp): void
  /** Sets a key of the design's meta. */
  setMeta(key: string, value: unknown): void
  /**
   * Marks the open step as the restore of a version: its change set carries `mark` to the server,
   * which tells the other tabs. A step put back drops it.
   */
  markRestore(mark: RestoreMark): void
}

/** What one change to the store touched. */
export interface StoreChange {
  /** Whether the meta, a page or a frame changed. */
  head: boolean
  /** The layers whose records changed, by id. */
  layers: ReadonlySet<string>
}

/** A place in a text layer's text that follows the edits from any tab, such as the caret while typing. */
export interface TextAnchor {
  id: string
  /** Where it is, as the store keeps it. */
  position: unknown
}

/** What other tabs' open steps show otherwise (D7): for the canvas only, never for a command. */
export interface StorePreviews {
  /**
   * Each layer another tab's preview shows otherwise, as the canvas draws it (C41: the tab's own
   * open step on top): its record, unread, or undefined where the preview deletes it. Frames, pages
   * and the meta are never previewed.
   */
  layers(): ReadonlyMap<string, unknown>
  /** How many times the previews have changed; `layers` also changes with the tab's own open step. */
  revision(): number
  /** Calls back whenever the previews change. */
  onChange(listener: () => void): () => void
  /** The names of the other tabs whose open step writes the text of the layer `id`; '' for one with no name known. */
  typingIn(id: string): string[]
}

/** A design's store: what commands write through, and what the design view and the session read. */
export interface DesignStore extends StoreWrite {
  /** Runs `write` as one change, written with `origin` when given. */
  transact<T>(write: () => T, origin?: object): T
  /** Whether a transaction is open. */
  inTransaction(): boolean
  /** Whether a change is being told to those listening, while nothing may write. */
  notifying(): boolean
  /**
   * Calls back with each change that touched something, once it is written. A listener added with
   * `first` hears before every listener added without it, so a view it keeps is current for them.
   */
  onChange(listener: (change: StoreChange) => void, first?: boolean): () => void
  /** The meta, pages and frames as stored, before they are read. */
  head(): Pick<Snapshot, 'meta' | 'pages' | 'frames'>
  /** A layer as stored, before it is read; undefined for one deleted or never held. */
  layer(id: string): unknown
  /** The whole design as stored, before it is read: its deleted layers left out. */
  snapshot(): Snapshot
  /** Anchors a UTF-16 offset in a text layer's text. It writes nothing. */
  textAnchor(id: string, offset: number): TextAnchor
  /** Where an anchor is now, after whatever edits arrived; null once its layer is deleted. */
  anchorOffset(anchor: TextAnchor): number | null
  /** The undo history of one session on the store. */
  openHistory(session: HistoryOf): History
  /** Other tabs' open steps, as the canvas draws them (D7); a store no other tab shares has none. */
  readonly previews?: StorePreviews
}

/** The session a history records. */
export interface HistoryOf {
  /** What the session's tracked writes are written with. */
  origin: object
  /** What its untracked writes are written with: no undo takes them back. */
  untrackedOrigin: object
  /** How many reads of the design gave one that differs from the read before. */
  revision: () => number
  /** Whether the session's batch is open. */
  batching: () => boolean
  /** Throws when the session can't write now. */
  refuseOpenTransaction: (inBatch: boolean) => void
}

/** One of a session's logs: its history, which undo walks, or `aside`, what it writes untracked. */
export interface Log {
  /** Starts a step: everything written until `end`, a gesture's commands too, is one step. Gives where it starts. */
  begin(): Step
  /** Ends the step begun last: a write after it starts another. */
  end(): void
  /** Drops every step the log holds. */
  clear(): void
}

/** Where a step's writes are: the log holding them, above the height it had when the step began. */
export interface Step {
  log: Log
  from: number
}

/** A session's undo history: its logs, and undo and redo over them. */
export interface History {
  tracked: Log
  aside: Log
  /** Names the step being written. */
  name(step: StepName | undefined): void
  /** Forgets the keys recorded so far, so the step written next keeps only its own. */
  beginWrite(): void
  /**
   * A press of undo or redo: it takes back the latest step with something left to take back. A
   * gesture open meanwhile (`open`) is a step of its own up to a press that takes something, and
   * what it writes after is another (C32): a fault in it then puts back only that.
   */
  press(which: 'undo' | 'redo', open?: Step): void
  /** Puts back everything a step wrote, leaving nothing of it to undo or redo. */
  putBack(step: Step): void
  canUndo(): boolean
  canRedo(): boolean
  /** The name of the step on top of the undo stack, or null with none. */
  undoName(): StepName | null
  /** The name of the step on top of the redo stack, or null with none. */
  redoName(): StepName | null
  /** Calls back whenever a step is added to, taken from or merged into the undo or redo stack. */
  onHistory(listener: () => void): () => void
  destroy(): void
}

/**
 * Reads the store as a design, whatever it holds: what concurrent edits can break is repaired, and
 * a part the schema does not take is left out (see repair.ts). `told` hears what the read repaired
 * and left out, when it did either.
 */
export function readDesign(
  store: Pick<DesignStore, 'snapshot'>,
  told?: (read: Pick<Repaired, 'repairs' | 'leftOut'>) => void,
): Design {
  const { design, repairs, leftOut } = repair(store.snapshot())
  if (repairs.length > 0 || leftOut.length > 0) told?.({ repairs, leftOut })
  return design
}
