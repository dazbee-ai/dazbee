// One design on the sync server, between its connections and its journal: what the transport runs
// per open design (build step 7 gives it sockets). Events (a connection's hello, its messages, its
// close) wait in one queue and the server core takes them in order. Everything the core commits
// goes through the design's write queue, and the answers go out once stored (I2), to the
// connections open when they were made. When a write fails, nothing after it is written: the design
// is dropped from memory, every connection is closed (its tab reconnects and sends again what was
// not stored), and the design opens again from the journal. A design whose journal ends in entries
// that no longer apply opens at the last good one, and moves them to the dead letters before it
// stores anything else. A design deleted while open closes its connections for good (D8).
// Whole-design jobs (a connect, whose welcome may carry the design, and a fold) each wait for a turn
// the host is given, the events behind them waiting too, so a fold holds exactly what came before it.
// Previews, presence and pongs store nothing, so they go out at once to every tab already welcomed
// (D7): a preview is never held behind a write, and one for a tab not yet welcomed is dropped; a
// pong for one waits for its welcome behind the writes, and each sender's latest presence for one
// goes right after its welcome, so none overtakes a later one.
// A version the core takes is stored ahead of what was committed after it, so a Before restore or
// Before agent version is stored before the change set it was taken for, and an Autosave is taken
// when asked and as the design unloads changed; each copies the whole design, so a restore, an
// Autosave and an agent's edit that takes a Before agent version wait for a turn. A tab's ask for a
// version is read from the journal and answered to that tab alone, its records as stored
// (`versionText` writes them onto the wire).
import { type Access, type Entry, isRecord, type ServerMessage, SYNC_CLOSE, SYNC_LIMITS } from '@dazbee/schema'

import { DesignGone, type Journal, runWrite, type StoredVersion, WriteQueue } from './journal.ts'
import { type Closing, openServer, type Outgoing, type Server, type ServerOptions, type Who } from './server.ts'

/** A version a tab asked for, as the host hands it to the tab's connection: its records' JSON as stored, or null for none. */
export interface VersionAnswer {
  type: 'storedVersion'
  id: string
  stored: StoredVersion | null
}

/** A tab's connection, as the transport gives it. */
export interface Connection {
  /** Sends a message; a `VersionAnswer` goes on the wire as the `version` message (`versionText`). */
  send(message: ServerMessage | VersionAnswer): void
  /** Closes the connection with a `SYNC_CLOSE` code; its tab reconnects. */
  close(code: number, reason: string): void
}

export interface HostOptions extends ServerOptions {
  /** Folds the journal past this many entries, or this many bytes of them (`SYNC_LIMITS`' unless given). */
  foldEntries?: number
  foldBytes?: number
  /**
   * A turn of the event loop for a whole-design job (`turns()` in `apps/sync`), shared by every design
   * the process holds; without one, each is taken at once.
   */
  turn?: () => Promise<void>
  /**
   * The design was dropped from memory, its connections closed with `code`: `designDeleted` when its
   * rows are gone, `storeFailed` when a load or a write failed. Its manager forgets the host.
   */
  dropped?: (code: number) => void
}

export interface DesignHost {
  connect(conn: Connection, hello: unknown, who: Who): void
  message(conn: Connection, message: unknown, wireBytes: number): void
  close(conn: Connection): void
  /** The connection's access from now on, as its renewed token gives it: in order with its messages. */
  access(conn: Connection, access: Access): void
  /** The server core while the design is open (for tests and tools). */
  server(): Server | undefined
  /** Resolves once nothing waits to be taken in or stored. */
  settled(): Promise<void>
  /** The design's size in bytes as the server counts it; 0 while it is not open. */
  bytes(): number
  /** When the design first changed after it last counted as unchanged; undefined while unchanged or not open. */
  changedSince(): number | undefined
  /** Takes an Autosave once what waits before it is taken in, when the design has changed. */
  autosave(): void
  /**
   * Once what waits is taken in and stored, and no tab is joined, folds what was stored since the last
   * fold and closes the host: false, changing nothing, while a tab is joined. Nothing may be sent to a
   * closed host.
   */
  unload(): Promise<boolean>
}

/** A message for one connection. */
interface Out {
  conn: Connection
  message: ServerMessage | VersionAnswer
}

type Event =
  | { type: 'connect'; conn: Connection; hello: unknown; who: Who }
  | { type: 'message'; conn: Connection; message: unknown; wireBytes: number }
  | { type: 'close'; conn: Connection }
  | { type: 'access'; conn: Connection; access: Access }
  | { type: 'fold' }
  | { type: 'autosave' }

/** Why a design's connections are closed when a write failed. */
export const UNSAVED = "the server couldn't store the latest changes; reconnecting"
/** Why a design's connections are closed when its rows are gone. */
export const DELETED = 'the design was deleted'

/** The design `journal` keeps, opened on its first event. */
export function openHost(journal: Journal, options: HostOptions): DesignHost {
  const foldEntries = options.foldEntries ?? SYNC_LIMITS.foldEntries
  const foldBytes = options.foldBytes ?? SYNC_LIMITS.foldBytes
  // The events waiting, and the server core once the design is open.
  const events: Event[] = []
  let server: Server | undefined
  let writes = new WriteQueue<Out>(0)
  let opening = false
  // Whether events are being taken in: a connection closed meanwhile reports its close after them.
  let working = false
  // Whether the host waits for a turn for the event at the front, and whether it has one.
  let waitingTurn = false
  let granted = false
  let closed = false
  // Counts the times the design was dropped: a write that answers after a drop changes nothing.
  let epoch = 0
  // The accepted entries committed since the last fold, and the size of every entry (D8).
  let sinceFold = { entries: 0, bytes: 0 }
  // The tab id each joined connection holds, and the connection each tab id is on.
  const tabs = new Map<Connection, number>()
  const conns = new Map<number, Connection>()
  // The joined connections whose welcome went out: previews and pongs go to them at once.
  const welcomed = new Set<Connection>()
  // Each sender's latest presence for a joined connection not yet welcomed, by tab id.
  const presenceWaiting = new Map<Connection, Map<number, ServerMessage>>()
  const waiters: (() => void)[] = []
  // How many version reads are on their way.
  let reading = 0

  function push(event: Event) {
    if (closed) throw new Error('the design host is closed')
    events.push(event)
    work()
  }

  /** Takes in the events waiting, in order, once the design is open; a whole-design job waits for a turn. */
  function work() {
    if (!server) return open()
    if (working || waitingTurn) return
    working = true
    try {
      for (let event = events[0]; event && server; event = events[0]) {
        if (options.turn && !granted && wholeDesign(event, server, tabs)) {
          awaitTurn(options.turn)
          break
        }
        granted = false
        events.shift()
        take(server, event)
      }
    } finally {
      working = false
    }
    wake()
  }

  function awaitTurn(turn: () => Promise<void>) {
    waitingTurn = true
    const at = epoch
    void turn().then(() => {
      waitingTurn = false
      granted = at === epoch
      work()
    })
  }

  function open() {
    if (opening) return
    opening = true
    const at = epoch
    journal
      .load()
      .then(async (loaded) => {
        // Opening replays the journal over the whole design: a turn of its own.
        await options.turn?.()
        return loaded
      })
      .then(
        (loaded) => {
          opening = false
          if (at !== epoch) return
          server = openServer(loaded, options)
          writes = new WriteQueue<Out>(loaded.lastEntry)
          sinceFold = foldCount(loaded.journal)
          // The bad tail goes to the dead letters before anything else is stored.
          if (server.dead) {
            writes.bury(server.save(), (server.dead.entries[0] as Entry).entry, server.dead.reason)
            sinceFold = { entries: 0, bytes: 0 }
          }
          pump()
          work()
        },
        (error: unknown) => {
          opening = false
          if (error instanceof DesignGone) return deleted()
          options.log?.(`the design could not be loaded: ${String(error)}`)
          drop()
        },
      )
  }

  function take(core: Server, event: Event) {
    if (event.type === 'fold') {
      writes.fold(core.save())
      return pump()
    }
    if (event.type === 'autosave') {
      core.takeAutosave()
      return commit(core, [])
    }
    const { conn } = event
    if (event.type === 'connect') {
      const joined = core.join(event.hello, event.who)
      if ('close' in joined) return closeOne(conn, joined)
      // A resume of a connected tab id takes over from its old connection.
      const old = conns.get(joined.tabId)
      if (old && old !== conn) {
        forget(old)
        old.close(SYNC_CLOSE.replaced, 'the tab connected again')
      }
      tabs.set(conn, joined.tabId)
      conns.set(joined.tabId, conn)
      return commit(core, joined.out)
    }
    const id = tabs.get(conn)
    if (id === undefined) {
      if (event.type === 'message') closeOne(conn, { close: SYNC_CLOSE.protocol, reason: 'say hello first' })
      return
    }
    if (event.type === 'close') {
      forget(conn)
      return commit(core, core.leave(id))
    }
    if (event.type === 'access') return commit(core, core.setAccess(id, event.access))
    const answered = core.receive(id, event.message, event.wireBytes)
    if ('close' in answered) {
      forget(conn)
      closeOne(conn, answered)
      return commit(core, core.leave(id))
    }
    commit(core, answered)
  }

  function closeOne(conn: Connection, closing: Closing) {
    conn.close(closing.close, closing.reason)
  }

  function forget(conn: Connection) {
    const id = tabs.get(conn)
    tabs.delete(conn)
    welcomed.delete(conn)
    presenceWaiting.delete(conn)
    if (id !== undefined && conns.get(id) === conn) conns.delete(id)
  }

  /** Commits what the core took in, with its answers for the connections open now, and folds past the limits. */
  function commit(core: Server, out: readonly Outgoing[]) {
    const outs: Out[] = []
    for (const { to, except, message } of out) {
      const now = message.type === 'preview' || message.type === 'pong' || message.type === 'presence'
      for (const [conn, id] of tabs) {
        if ((to !== 'all' && to !== id) || id === except) continue
        if (now && welcomed.has(conn)) conn.send(message)
        else if (message.type === 'presence') {
          const waiting = presenceWaiting.get(conn) ?? new Map<number, ServerMessage>()
          presenceWaiting.set(conn, waiting.set(message.tabId, message))
        }
        // A pong waits for the welcome; a preview is dropped (the sender's next one brings it).
        else if (message.type !== 'preview') outs.push({ conn, message })
      }
    }
    // A version taken while taking in a message is stored before that message's entries.
    for (const version of core.takeVersions()) writes.version(version)
    const entries = core.takeJournal()
    writes.commit(entries, outs)
    for (const { tabId, id } of core.takeReads()) read(tabId, id)
    const added = foldCount(entries)
    sinceFold = { entries: sinceFold.entries + added.entries, bytes: sinceFold.bytes + added.bytes }
    if (sinceFold.entries >= foldEntries || sinceFold.bytes >= foldBytes) {
      // Next, before any event that waits.
      events.unshift({ type: 'fold' })
      sinceFold = { entries: 0, bytes: 0 }
    }
    pump()
  }

  /**
   * Reads a version tab `tabId` asked for and answers its connection if it is still joined, after
   * what was committed for it before (its welcome first); writing it on the wire takes the turn. A read that fails is logged
   * and answered with none; it drops nothing.
   */
  function read(tabId: number, id: string) {
    const conn = conns.get(tabId)
    if (!conn) return
    const at = epoch
    reading++
    journal
      .readVersion(id)
      .catch((error: unknown) => {
        options.log?.(`version ${id} could not be read: ${String(error)}`)
        return null
      })
      .then((stored) => {
        if (at !== epoch || !server || !tabs.has(conn)) return
        writes.commit([], [{ conn, message: { type: 'storedVersion', id, stored } }])
        pump()
      })
      .finally(() => {
        reading--
        wake()
      })
  }

  /** Starts the next write when none is in flight. */
  function pump() {
    const write = writes.next(deliver)
    if (!write) return wake()
    const at = epoch
    runWrite(journal, write).then(
      () => {
        if (at !== epoch) return
        deliver(writes.stored())
        pump()
      },
      (error: unknown) => {
        if (at !== epoch) return
        if (error instanceof DesignGone) return deleted()
        options.log?.(`a write failed: ${String(error)}`)
        drop()
      },
    )
  }

  /** The design's rows are gone: its tabs are closed for good. */
  function deleted() {
    options.log?.('the design was deleted')
    drop(SYNC_CLOSE.designDeleted, DELETED)
  }

  /** Drops the design from memory with whatever was not stored; its tabs reconnect, and it opens again. */
  function drop(code: number = SYNC_CLOSE.storeFailed, reason = UNSAVED) {
    epoch++
    server = undefined
    writes.failed()
    const open = [...tabs.keys(), ...events.flatMap((e) => (e.type === 'connect' ? [e.conn] : []))]
    events.length = 0
    tabs.clear()
    conns.clear()
    welcomed.clear()
    presenceWaiting.clear()
    // The manager forgets the host first, so a close a connection reports at once goes nowhere here.
    options.dropped?.(code)
    for (const conn of open) conn.close(code, reason)
    wake()
  }

  function deliver(outs: readonly Out[]) {
    for (const { conn, message } of outs) {
      if (!tabs.has(conn)) continue
      conn.send(message)
      if (message.type !== 'welcome') continue
      welcomed.add(conn)
      for (const presence of presenceWaiting.get(conn)?.values() ?? []) conn.send(presence)
      presenceWaiting.delete(conn)
    }
  }

  /** Resolves the waits for a settled design. */
  function wake() {
    if (events.length > 0 || opening || reading > 0 || writes.busy()) return
    for (const resolve of waiters.splice(0)) resolve()
  }

  return {
    connect: (conn, hello, who) => push({ type: 'connect', conn, hello, who }),
    message: (conn, message, wireBytes) => push({ type: 'message', conn, message, wireBytes }),
    close: (conn) => push({ type: 'close', conn }),
    access: (conn, access) => push({ type: 'access', conn, access }),
    server: () => server,
    settled,
    bytes: () => server?.size().bytes ?? 0,
    changedSince: () => server?.changedSince(),
    // A design not open, or closed, has nothing changed to keep.
    autosave: () => {
      if (server && !closed) push({ type: 'autosave' })
    },
    unload: async () => {
      await settled()
      if (tabs.size > 0 || events.length > 0) return false
      // A changed design is kept as an Autosave, and the fold stores that it now counts as unchanged.
      const changed = server?.changedSince() !== undefined
      if (server && (sinceFold.bytes > 0 || changed)) {
        if (changed) events.push({ type: 'autosave' })
        events.push({ type: 'fold' })
        sinceFold = { entries: 0, bytes: 0 }
        work()
        await settled()
      }
      if (tabs.size > 0 || events.length > 0) return false
      closed = true
      epoch++
      server = undefined
      return true
    },
  }

  function settled() {
    return new Promise<void>((resolve) => {
      waiters.push(resolve)
      wake()
    })
  }
}

/** Whether an event copies or reads the whole design: a connect, a fold, an Autosave, a restore, an agent's edit that takes a Before agent version. */
function wholeDesign(event: Event, server: Server, tabs: ReadonlyMap<Connection, number>): boolean {
  if (event.type === 'connect' || event.type === 'fold' || event.type === 'autosave') return true
  if (event.type !== 'message' || !isRecord(event.message) || event.message.type !== 'changes') return false
  if ('restore' in event.message) return true
  const tabId = tabs.get(event.conn)
  return event.message.kind === 'edit' && tabId !== undefined && server.takesBeforeAgent(tabId)
}

/** What entries count toward a fold: the accepted ones, and the bytes of each (an accepted change set's message size, any other's JSON). */
function foldCount(entries: readonly Entry[]): { entries: number; bytes: number } {
  let accepted = 0
  let bytes = 0
  for (const e of entries) {
    if (e.kind === 'accepted') accepted++
    bytes += e.kind === 'accepted' ? e.bytes : JSON.stringify(e).length
  }
  return { entries: accepted, bytes }
}
