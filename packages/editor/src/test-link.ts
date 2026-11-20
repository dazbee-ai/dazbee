// The sync link's tests' server: the core's design host on a journal in memory, as the sync server
// runs it, so a change set is answered only once it is stored, and a tab that connects again
// replaces its old connection. Its sockets carry every message through JSON, each a microtask later
// and in order, as the browser's WebSocket would; a message past `ZIP_FROM` goes gzipped, as the
// sync server sends one. The server checks no token: a token names who the tab is (`ann`, `bob`, a
// Reviewer `viewer`, or whom the test's `who` names), and `old` is a tab older than the design. A test holds,
// cuts or closes a socket.
import { gzipSync } from 'node:zlib'

import {
  type Connection,
  firstSaved,
  type MemoryJournal,
  memoryJournal,
  memoryRows,
  openHost,
  versionText,
  type Who,
} from '@dazbee/doc/sync'
import { testDesign } from '@dazbee/doc/test-design'
import type { DesignInput, DesignRecords, ServerMessage, TabMessage } from '@dazbee/schema'
import { SYNC_CLOSE } from '@dazbee/schema'

import type { LinkSocket } from './sync-link.ts'

/** Who each test token is. */
const WHO: Record<string, Who> = {
  ann: { member: { userId: 'ann', workspaceId: 'w1' }, name: 'Ann', access: 'edit' },
  bob: { member: { userId: 'bob', workspaceId: 'w1' }, name: 'Bob', access: 'edit' },
  viewer: { member: { userId: 'vic', workspaceId: 'w1' }, name: 'Vic', access: 'view' },
}

/** Messages longer than this go as gzipped binary frames, as the sync server's past 1 MiB do. */
const ZIP_FROM = 1024 * 1024

/** A socket on the server in memory, with what a test does to it. */
export interface TestSocket extends LinkSocket {
  readonly url: string
  /** Every message it sent, in order. */
  readonly sent: TabMessage[]
  /** Every message the server sent it, in order, delivered or held. */
  readonly got: ServerMessage[]
  /** The server sends it `message`. */
  deliver(message: ServerMessage): void
  /** Holds what the server sends it until `release`. */
  hold(): void
  release(): void
  /** The server closes it with `code`. */
  closeWith(code: number, reason?: string): void
  /** The network drops it: neither side hears more, and the tab hears a 1006 close. */
  cut(): void
  readonly closed: boolean
}

export interface MemorySync {
  journal: MemoryJournal
  /** The design as the server holds it now. */
  state(): DesignRecords
  /** The name the server holds for layer `id`. */
  nameOf(id: string): string | undefined
  /** Opens a socket, as the link's `socket` option; the network down, it closes before opening. */
  socket: (url: string) => TestSocket
  /** Every socket opened, in order. */
  readonly sockets: TestSocket[]
  /** The network: down, every new socket fails, and every open one is cut. */
  down(): void
  up(): void
  /** Waits until every message on its way is delivered and the host has stored what it took in. */
  settle(): Promise<void>
}

/** What a test's server is given beside its design. */
export interface MemorySyncOptions {
  /** Who a token is, for tokens besides the test ones; undefined for one the server refuses. */
  who?: (token: string) => Who | undefined
}

/** The core's design host on `design` (the test design unless given), with sockets on it. */
export function memorySync(design: DesignInput = testDesign(), options: MemorySyncOptions = {}): MemorySync {
  const whoOf = (token: string) => WHO[token] ?? options.who?.(token)
  let secrets = 0
  const journal = memoryJournal(memoryRows(firstSaved(design as unknown as DesignRecords, 's0')))
  const host = openHost(journal, {
    hashSecret: (secret) => `hash:${secret}`,
    newSecret: () => `secret${++secrets}`,
    now: () => 1000,
  })
  const sockets: TestSocket[] = []
  let isDown = false
  /** Deliveries on their way. */
  let flying = 0

  function later(run: () => void) {
    flying++
    queueMicrotask(() => {
      flying--
      run()
    })
  }

  function socket(url: string): TestSocket {
    let closed = false
    let held: unknown[] | undefined
    /** The host's side of the socket, once the tab said hello. */
    let joined: Connection | undefined
    const s = {
      url,
      binaryType: 'blob' as BinaryType,
      sent: [] as TabMessage[],
      got: [] as ServerMessage[],
      onopen: null as LinkSocket['onopen'],
      onmessage: null as LinkSocket['onmessage'],
      onclose: null as LinkSocket['onclose'],
      get closed() {
        return closed
      },
      send(data: string) {
        if (closed) throw new Error('sent on a closed socket')
        const message = JSON.parse(data) as TabMessage
        s.sent.push(message)
        later(() => {
          if (!closed) take(message, data.length)
        })
      },
      close(code = 1005, reason = '') {
        if (closed) return
        closed = true
        if (joined) host.close(joined)
        later(() => s.onclose?.({ code, reason }))
      },
      closeWith(code: number, reason = '') {
        s.close(code, reason)
      },
      cut() {
        s.close(1006)
      },
      hold() {
        held ??= []
      },
      release() {
        const out = held ?? []
        held = undefined
        for (const data of out) s.onmessage?.({ data })
      },
      deliver(message: ServerMessage) {
        s.got.push(message)
        const text = JSON.stringify(message)
        const data = text.length > ZIP_FROM ? arrayBufferOf(gzipSync(text)) : text
        later(() => {
          if (closed) return
          if (held) held.push(data)
          else s.onmessage?.({ data })
        })
      },
    }

    const side: Connection = {
      send: (message) =>
        s.deliver(message.type === 'storedVersion' ? (JSON.parse(versionText(message)) as ServerMessage) : message),
      close: (code, reason) => s.closeWith(code, reason),
    }

    /** Takes a message from the tab, as the sync server's connection does. */
    function take(message: TabMessage, bytes: number) {
      if (!joined) {
        if (message.type !== 'hello') return s.closeWith(SYNC_CLOSE.protocol)
        if (message.token === 'old') return s.closeWith(SYNC_CLOSE.tabTooOld)
        const who = whoOf(message.token)
        if (!who) return s.closeWith(SYNC_CLOSE.tokenExpired)
        joined = side
        return host.connect(side, message, who)
      }
      // A renewal is the connection's to check: a token for another role changes the tab's access.
      if (message.type === 'token') {
        const who = whoOf(message.token)
        if (who) host.access(side, who.access)
        return
      }
      host.message(side, message, bytes)
    }

    sockets.push(s)
    later(() => {
      if (isDown) s.cut()
      else if (!closed) s.onopen?.()
    })
    return s
  }

  const state = () => host.server()?.state().toRecords() ?? journal.rows.saved.state

  return {
    journal,
    state,
    nameOf: (id) => (state().nodes[id] as { name?: string } | undefined)?.name,
    socket,
    sockets,
    down() {
      isDown = true
      for (const s of sockets) s.cut()
    },
    up() {
      isDown = false
    },
    async settle() {
      // The link's token, its inbox, a gzipped frame, each delivery and each write take turns of
      // their own: a few more than the deliveries on their way, under fake timers too.
      for (let quiet = 0; quiet < 20; quiet = flying > 0 ? 0 : quiet + 1) {
        await host.settled()
        await Promise.resolve()
      }
    },
  }
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
