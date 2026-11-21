// The sync server's limits, named once: on what a WebSocket may send and have waiting, on a member's
// connections, and on the designs it keeps loaded; and how a connection is held to its message rate
// and a member to their new connections. The limits on one message and on a design are the sync
// core's (`SYNC_LIMITS`). The limits on the designs kept loaded are server settings, read from the
// environment at start; the rest are rules kept in code.
import { type ServerSetting, serverSettings, SYNC_CLOSE } from '@dazbee/schema'

export interface Limits {
  /** The largest message a tab may send before its hello, in bytes. */
  statelessBytes: number
  /**
   * What may wait in the server to go to one WebSocket, in bytes: a socket that stops reading is
   * ended past it, so it cannot hold the server's memory.
   */
  unsentBytes: number
  /** What a tab may send after its hello until its welcome went out, in bytes. */
  authenticatingBytes: number
  /** The messages a WebSocket may send each second, sustained. */
  messagesPerSecond: number
  /** The messages a WebSocket may send at once, above the sustained rate. */
  messageBurst: number
  /** The connections one member may have open to one design. */
  connectionsPerMember: number
  /** The new connections one member may open to one design in any minute. */
  connectionsPerMinute: number
  /** How long a design stays loaded after its last tab leaves, so a tab that comes back costs no load. */
  idleMs: number
  /** The most designs kept loaded with no tab; past it, the longest idle unloads. */
  idleDesigns: number
  /** How often the loaded designs are checked for one that has changed long enough for an Autosave. */
  autosaveCheckMs: number
  /** How long the server waits for a connection's hello before it closes it (D10). */
  helloMs: number
  /**
   * The bytes of design the server holds loaded at once (D11): past it, idle designs unload first,
   * and a design that still does not fit is refused with `serverBusy`.
   */
  loadedBytes: number
}

const KIB = 1024
const MIB = 1024 * KIB
const MINUTE_MS = 60_000

/** The limits. The rate is above a drag that sends something each frame on a 120 Hz screen. */
export const LIMITS: Limits = {
  statelessBytes: 64 * KIB,
  unsentBytes: 64 * MIB,
  authenticatingBytes: 5 * MIB,
  messagesPerSecond: 200,
  messageBurst: 600,
  connectionsPerMember: 16,
  connectionsPerMinute: 30,
  idleMs: MINUTE_MS,
  idleDesigns: 50,
  autosaveCheckMs: MINUTE_MS,
  helloMs: 10_000,
  loadedBytes: 200 * MIB,
}

/** The limits read from the environment, each LIMITS' value when unset, in the unit its variable names. */
const LIMIT_SETTINGS: Readonly<Record<'loadedMb' | 'idleDesigns' | 'idleSeconds', ServerSetting>> = {
  loadedMb: { name: 'SYNC_LOADED_MB', value: LIMITS.loadedBytes / MIB, least: 1, most: 65_536 },
  idleDesigns: { name: 'SYNC_IDLE_DESIGNS', value: LIMITS.idleDesigns, least: 0, most: 10_000 },
  idleSeconds: { name: 'SYNC_IDLE_SECONDS', value: LIMITS.idleMs / 1000, least: 0, most: 86_400 },
}

/**
 * LIMITS with the designs kept loaded as `env` sets them: `SYNC_LOADED_MB`, `SYNC_IDLE_DESIGNS` and
 * `SYNC_IDLE_SECONDS`. Throws, naming the variable, on a value that isn't a whole number in its range, so the
 * server refuses to start on it.
 */
export function limitSettings(env: Readonly<Record<string, string | undefined>>): Limits {
  const { loadedMb, idleDesigns, idleSeconds } = serverSettings(env, LIMIT_SETTINGS)
  return { ...LIMITS, loadedBytes: loadedMb * MIB, idleDesigns, idleMs: idleSeconds * 1000 }
}

/** The name `SYNC_CLOSE` gives a code, as the close's reason. */
export function closeReason(code: number) {
  return Object.entries(SYNC_CLOSE).find(([, value]) => value === code)?.[0] ?? 'closed'
}

/**
 * A WebSocket's message budget: a bucket of `messageBurst` messages that refills at
 * `messagesPerSecond`. Each call takes one message from it and says whether there was one to take.
 */
export function messageRate(limits: Limits, now: () => number = Date.now): () => boolean {
  let left = limits.messageBurst
  let at = now()
  return () => {
    const time = now()
    left = Math.min(limits.messageBurst, left + ((time - at) / 1000) * limits.messagesPerSecond)
    at = time
    if (left < 1) return false
    left -= 1
    return true
  }
}

/**
 * The new connections each member may open to each design: `connectionsPerMinute` in any minute.
 * Each call, with the member and design as one key, says whether one more may open now. A key whose
 * last connection is a minute old is forgotten.
 */
export function connectionRate(limits: Limits, now: () => number = Date.now): (key: string) => boolean {
  const opened = new Map<string, number[]>()
  return (key) => {
    const time = now()
    // Keys are kept in the order they last opened a connection, so the stale ones are at the front.
    for (const [stale, times] of opened) {
      if (time - (times.at(-1) as number) < MINUTE_MS) break
      opened.delete(stale)
    }
    const times = (opened.get(key) ?? []).filter((at) => time - at < MINUTE_MS)
    opened.delete(key)
    if (times.length >= limits.connectionsPerMinute) {
      opened.set(key, times)
      return false
    }
    opened.set(key, [...times, time])
    return true
  }
}
