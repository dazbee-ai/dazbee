// The sync server (D10): the socket shell, the designs it holds in Postgres, and a connection per
// WebSocket. `main.ts` starts it.
import type { Db } from '@dazbee/db'
import type { HostOptions } from '@dazbee/doc/sync'
import { SYNC_LIMITS } from '@dazbee/schema'

import { RENEWAL, type Renewal } from './access.ts'
import { serveConnection } from './connection.ts'
import { type Designs, openDesigns } from './design-host.ts'
import { connectionRate, LIMITS, type Limits } from './limits.ts'
import { socketShell } from './socket-shell.ts'

/** How often the server pings each WebSocket. */
export const PING_EVERY_MS = 15_000

export interface OpenSyncServerOptions {
  db: Db
  /** The key sync tokens are signed with. */
  secret: string
  port: number
  /** The limits: as the environment sets them (`limitSettings`), or a test's smaller ones; `LIMITS` unless given. */
  limits?: Limits
  /** When a connection is asked for a fresh token, `RENEWAL` unless a test gives sooner. */
  renewal?: Renewal
  /** How often each WebSocket is pinged, `PING_EVERY_MS` unless a test gives sooner. */
  pingEveryMs?: number
  /** Where the server logs what an operator should see; the console unless given. */
  log?: (line: string) => void
  /** What each design's host opens with beyond the server's own: a test's smaller limits. */
  host?: Partial<HostOptions>
}

export interface OpenSyncServer {
  designs: Designs
  httpServer: ReturnType<typeof socketShell>['httpServer']
  listen(): Promise<void>
  /**
   * Takes no new socket, closes every tab (1001: it reconnects), unloads every design with a fold,
   * then ends what is left; a tab whose close frame had not left yet sees 1006, and reconnects too.
   */
  destroy(): Promise<void>
}

/**
 * The room a message's frame has past the core's message limit, so that a change set over it is
 * read and rejected with its reason rather than closing the connection.
 */
export const FRAME_ROOM = 64 * 1024

export function openSyncServer(options: OpenSyncServerOptions): OpenSyncServer {
  const limits = options.limits ?? LIMITS
  const write = options.log ?? ((line: string) => console.warn(line))
  // A log is told what happened after the fact: one that throws must not stop a close or a store.
  const log = (line: string) => {
    try {
      write(line)
    } catch {
      // The line is lost; the server goes on.
    }
  }
  // One message limit feeds both the WebSocket's frame limit and the core's check.
  const messageBytes = options.host?.limits?.messageBytes ?? SYNC_LIMITS.messageBytes
  const designs = openDesigns({ db: options.db, limits, log, ...(options.host ? { host: options.host } : {}) })
  const connection = {
    designs,
    secret: options.secret,
    limits,
    renewal: options.renewal ?? RENEWAL,
    pingEveryMs: options.pingEveryMs ?? PING_EVERY_MS,
    mayConnect: connectionRate(limits),
    open: new Map<string, number>(),
    log,
  }
  const sockets = socketShell(options.port, messageBytes + FRAME_ROOM, (socket, request) =>
    serveConnection(socket, request, connection),
  )
  return {
    designs,
    httpServer: sockets.httpServer,
    listen: sockets.listen,
    async destroy() {
      sockets.httpServer.close()
      await designs.closeAll()
      sockets.close()
    },
  }
}
