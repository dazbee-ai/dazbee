// One tab's WebSocket on the sync server (D3, D10), from its upgrade to its close, in front of
// the designs the server holds (design-host.ts). In order:
//
// - The upgrade names the design and the schema version the tab was built with: a tab built before
//   this server's version is closed with `tabTooOld` before it says anything.
// - Its first message, within `helloMs`, is a hello with a token for that design. The token is checked,
//   then the member's connection rate, then whether the tab is older than the design, then the member's
//   open connections to it, its agent tabs counted apart; then the hello goes to the design's host.
// - Every message after counts against the socket's rate, and none is taken once the token has
//   expired, whatever the timers did. A renewed token is checked here and never reaches the host,
//   but for a role it changes; one for a design newer than the tab closes it. Until the tab's
//   welcome went out, what it may send is capped.
// - The server asks for a fresh token before the one it has expires, only once the welcome went out,
//   and closes the connection at expiry without one. It pings the socket, and ends one that has
//   said nothing for two pings.
// Every close, whoever makes it, ends the connection once: nothing it sent after is taken.
import type { RawData, WebSocket } from 'ws'

import {
  type Access as Role,
  DESIGN_PARAM,
  readTabVersion,
  SCHEMA_VERSION,
  type ServerMessage,
  SYNC_CLOSE,
  TAB_VERSION_PARAM,
} from '@dazbee/schema'
import { verifySyncToken } from '@dazbee/sync-token'

import { type Access, accessOf, keepFresh, renew, type Renewal, stopRenewing, type TokenAsker } from './access.ts'
import type { Designs, Socket } from './design-host.ts'
import { closeReason, type Limits, messageRate } from './limits.ts'
import { outbox } from './outbox.ts'
import { readMessage } from './read-message.ts'
import { bytesOf } from './socket-shell.ts'

export interface ConnectionOptions {
  designs: Designs
  /** The key sync tokens are signed with. */
  secret: string
  limits: Limits
  renewal: Renewal
  pingEveryMs: number
  /**
   * Whether a member may open one more connection to a design now, by `[design, member]` as one key;
   * a member's agent tabs have a key of their own.
   */
  mayConnect: (key: string) => boolean
  /** The connections open per `[design, member]` key, shared by every socket of the server. */
  open: Map<string, number>
  /** Where the server logs each close it makes. Never a token. */
  log: (line: string) => void
}

/** What a design id looks like: anything else in the URL is refused before it is used or logged. */
const DESIGN_ID = /^[\w-]{1,64}$/

/** How many pings a tab may leave unanswered while it is still being sent to (a slow reader). */
const SILENT_PINGS = 8

/** The most bytes of a WebSocket close frame's reason. */
const REASON_BYTES = 123

/** Serves the tab on `socket`, upgraded with `request`. */
export function serveConnection(socket: WebSocket, request: Request, options: ConnectionOptions): void {
  const { designs, secret, limits, renewal, log } = options
  const params = new URL(request.url).searchParams
  const sent = params.get(DESIGN_PARAM) ?? ''
  // Only an id shaped as one is read on, or logged: the URL is anyone's to write.
  const designId = DESIGN_ID.test(sent) ? sent : ''
  const tabVersion = readTabVersion(params.get(TAB_VERSION_PARAM))
  const rate = messageRate(limits)
  const decoder = new TextDecoder()
  let state: 'hello' | 'joined' | 'ended' = 'hello'
  let access: Access | undefined
  let welcomed = false
  let askWhenWelcomed = false
  /** What the tab sent after its hello until its welcome went out. */
  let sentBeforeWelcome = 0
  let heardAt = Date.now()
  /** When the server last sent the tab anything. */
  let sentAt = 0
  /** The `[design, member]` key the connection counts under, once counted. */
  let counted: string | undefined

  const out = outbox(
    {
      get bufferedAmount() {
        return socket.bufferedAmount
      },
      send: (data, written) => {
        sentAt = Date.now()
        socket.send(data, written)
      },
      terminate: () => socket.terminate(),
    },
    { unsentBytes: limits.unsentBytes, ended: () => end(undefined, 'it stopped reading') },
  )
  /** The socket as the design's host sees it. */
  const tab: Socket = {
    send(data, message) {
      if (state === 'ended') return
      out.send(data, message)
      // A token is asked for only once the welcome went out, after it.
      if (message.type === 'welcome') welcome()
    },
    close: (code, reason) => end(code, reason),
  }
  const asker: TokenAsker = {
    requestToken() {
      if (welcomed) say({ type: 'token' })
      else askWhenWelcomed = true
    },
  }

  const helloTimer = setTimeout(() => end(SYNC_CLOSE.protocol, 'no hello came'), limits.helloMs)
  const pinger = setInterval(() => {
    // A tab answers a ping only once it has read what was sent before it, so silence counts from the
    // later of its last word and the server's last send; a tab silent past `SILENT_PINGS` goes anyway.
    const now = Date.now()
    if (now - Math.max(heardAt, sentAt) > 2 * options.pingEveryMs)
      return end(undefined, 'it said nothing for two pings')
    if (now - heardAt > SILENT_PINGS * options.pingEveryMs) return end(undefined, 'it said nothing for too long')
    if (socket.bufferedAmount > limits.unsentBytes) return end(undefined, 'it stopped reading')
    socket.ping()
  }, options.pingEveryMs)

  socket.on('message', (data: RawData, binary: boolean) => take(data, binary))
  socket.on('pong', () => (heardAt = Date.now()))
  socket.on('error', (error) => log(`design ${designId}: WebSocket error: ${String(error)}`))
  socket.on('close', () => end())

  // The version first: a tab built before this server (one from before it names no design) reloads.
  if (tabVersion === null || tabVersion < SCHEMA_VERSION) end(SYNC_CLOSE.tabTooOld, 'the tab is older than the server')
  else if (!designId) end(SYNC_CLOSE.protocol, 'the URL names no design id')

  function take(data: RawData, binary: boolean) {
    if (state === 'ended') return
    heardAt = Date.now()
    if (!rate()) return end(SYNC_CLOSE.tooManyMessages, 'messages came too fast')
    if (binary) return end(SYNC_CLOSE.protocol, 'messages are text')
    const bytes = bytesOf(data)
    // Before its hello, a tab has said nothing it may say at length.
    if (state === 'hello' && bytes.byteLength > limits.statelessBytes)
      return end(SYNC_CLOSE.protocol, 'a hello too large')
    const message = readMessage(decoder.decode(bytes))
    if (message === undefined) return end(SYNC_CLOSE.protocol, 'not JSON, or nested too deep')
    if (state === 'hello') return hello(message)
    const held = access as Access
    // Whatever the timers did, nothing is taken once the token has expired.
    if (Date.now() >= held.expiresAt) return end(SYNC_CLOSE.tokenExpired, 'the token expired')
    if (!welcomed) {
      sentBeforeWelcome += bytes.byteLength
      if (sentBeforeWelcome > limits.authenticatingBytes)
        return end(SYNC_CLOSE.tooManyMessages, 'too much before the welcome')
    }
    if (typeOf(message) === 'token') return renewed(held, message)
    designs.message(designId, tab, message, bytes.byteLength)
  }

  /** The tab's first message: a hello with a token for the design. */
  function hello(message: unknown) {
    clearTimeout(helloTimer)
    const token = typeOf(message) === 'hello' ? (message as { token?: unknown }).token : undefined
    if (typeof token !== 'string') return end(SYNC_CLOSE.protocol, 'a connection starts with hello')
    const checked = verifySyncToken(secret, token, designId)
    if (!checked.ok) return end(SYNC_CLOSE.tokenExpired, checked.reason)
    const { payload } = checked
    // A member's agent tabs count apart from the member's own, so agents never use up the person's.
    const key = JSON.stringify([designId, payload.userId, payload.workspaceId, ...(payload.agent ? ['agent'] : [])])
    if (!options.mayConnect(key)) return end(SYNC_CLOSE.tooManyMessages, 'connections opened too fast')
    const given = accessOf(payload, token)
    if (olderThan(given)) return end(SYNC_CLOSE.tabTooOld, 'the tab is older than the design')
    const open = options.open.get(key) ?? 0
    if (open >= limits.connectionsPerMember) return end(SYNC_CLOSE.tooManyConnections, 'too many connections')
    options.open.set(key, open + 1)
    counted = key
    access = given
    state = 'joined'
    keepFresh(asker, given, renewal, () => end(SYNC_CLOSE.tokenExpired, 'the token expired'))
    const member = { userId: payload.userId, workspaceId: payload.workspaceId }
    const agent = payload.agent === undefined ? {} : { agent: payload.agent }
    designs.connect(designId, tab, message, { member, name: payload.name, ...agent, access: roleOf(given) })
  }

  /** A fresh token on the open connection: checked here; a role it changes goes to the host. */
  function renewed(held: Access, message: unknown) {
    const token = (message as { token?: unknown }).token
    if (typeof token !== 'string') return end(SYNC_CLOSE.protocol, 'a token message without a token')
    const checked = verifySyncToken(secret, token, designId)
    if (!checked.ok) return end(SYNC_CLOSE.tokenExpired, checked.reason)
    const before = roleOf(held)
    const done = renew(asker, held, checked.payload, token, renewal, () =>
      end(SYNC_CLOSE.tokenExpired, 'the token expired'),
    )
    if (done === 'refused') return end(SYNC_CLOSE.tokenExpired, 'a token for another member')
    if (olderThan(held)) return end(SYNC_CLOSE.tabTooOld, 'the tab is older than the design')
    if (roleOf(held) !== before) designs.access(designId, tab, roleOf(held))
  }

  function welcome() {
    if (welcomed) return
    welcomed = true
    if (askWhenWelcomed) {
      askWhenWelcomed = false
      say({ type: 'token' })
    }
  }

  /** A message the connection itself sends. */
  function say(message: ServerMessage) {
    if (state !== 'ended') out.send(JSON.stringify(message), message)
  }

  /** Whether the tab was built before the design's schema version, as `given` says it is. */
  function olderThan(given: Access) {
    return tabVersion === null || tabVersion < given.schemaVersion
  }

  /**
   * Ends the connection once: closed with `code` when the server closes it, ended at once with no
   * close frame when it has stopped reading or answering (`code` undefined, `why` given), or already
   * closed by the tab (neither).
   */
  function end(code?: number, why?: string) {
    if (state === 'ended') return
    const joined = state === 'joined'
    state = 'ended'
    clearTimeout(helloTimer)
    clearInterval(pinger)
    if (access) stopRenewing(access)
    out.end()
    if (counted !== undefined) {
      const left = (options.open.get(counted) ?? 1) - 1
      if (left > 0) options.open.set(counted, left)
      else options.open.delete(counted)
      counted = undefined
    }
    if (code !== undefined) {
      log(`design ${designId}: closed ${closeReason(code)}${joined ? '' : ' before joining'}: ${why ?? ''}`)
      socket.close(code, cut(why ?? closeReason(code)))
    } else if (why !== undefined) {
      log(`design ${designId}: ended: ${why}`)
      socket.terminate()
    }
    if (joined) designs.close(designId, tab)
  }
}

/** The type a message says it is, if it is an object that says one. */
function typeOf(message: unknown): unknown {
  return typeof message === 'object' && message !== null ? (message as { type?: unknown }).type : undefined
}

function roleOf(access: Access): Role {
  return access.writes ? 'edit' : 'view'
}

/** A close reason within a close frame's limit. */
function cut(reason: string): string {
  let cutAt = reason.length
  while (Buffer.byteLength(reason.slice(0, cutAt)) > REASON_BYTES) cutAt--
  return reason.slice(0, cutAt)
}
