// The tab opened on a design (D9, D10): its tab copy taken up, its sync link connected, and the
// client's store the editor writes. A kept tab copy opens at once, even offline; a first visit
// waits for the server's welcome. What the client and the device copy tell the person waits for the
// editor's first listener, in order, and the recompute waits for the editor's own (D6). A version of
// the design is fetched over its link and read as every stored version is read.
import {
  type ClientOptions,
  type ClientStore,
  clientStore,
  type ReadVersion,
  readVersion,
  type Recompute,
} from '@dazbee/doc'
import type { Member, ServerMessage } from '@dazbee/schema'

import type { LinkNotice, LinkNotices, OtherPresence, TabAccess, TabPresence } from './core-interface.ts'
import type { Stopped } from './save-state.ts'
import { type LinkSocket, openSyncLink, type SyncLink } from './sync-link.ts'
import { type Kept, type Locks, openTabCopies, type Session, type TabCopies } from './tab-copy.ts'

export interface OpenTabOptions {
  designId: string
  /** The member the page is signed in as: the tab copies taken up are theirs. */
  member: Member
  /** The sync server's URL, without the tab's version and design. */
  url: string
  /** `token-source.ts`'s: one for the tab, shared by every link it opens. */
  token: () => Promise<string>
  /** Stops a first visit waiting for the welcome. */
  signal?: AbortSignal
  /** Told an error a listener of the store threw while a message landed: `reportError` unless given. */
  report?: (error: unknown) => void
  /** A test's sockets, browser storage and clock; the browser's own unless given. */
  socket?: (url: string) => LinkSocket
  indexedDB?: IDBFactory
  locks?: Locks
  session?: Session
  now?: () => number
  random?: () => number
  /** A test's smaller limits; an agent tab's presence, which goes only to a server that takes a note. */
  client?: Pick<ClientOptions, 'limits' | 'presenceNeedsNote'>
}

/** The editor's half of the sync: its recompute (D6), and when the fonts it waited for settled. */
export interface TabSync {
  recompute: Recompute
  onFontsSettled(listener: () => void): () => unknown
}

export interface OpenTab {
  store: ClientStore
  link: SyncLink
  /** Opened from a tab copy: an image or font that fails offline waits for the connection. */
  kept: boolean
  /** View only from the server, or ended; quiet while ended, as the page shows why. */
  access: TabAccess
  linkNotices: LinkNotices
  /** Where the editor's presence goes: the link sends it. */
  presence: TabPresence
  /** The editor's recompute and font hook, from now on; retries the follow-ups that waited for them. */
  bind(sync: TabSync, signal: AbortSignal): void
  /** Whether everything of this tab's is stored on the server (C34). */
  synced(): boolean
  /** Writes what the tab copy is due now; for a check in the browser, before it reloads. */
  flushed(): Promise<void>
  /**
   * Version `id` of the design, fetched from the sync server and read by `readVersion`: its design and
   * what the read left out; null for no such version. Rejects with `VersionUnanswered` offline.
   */
  fetchVersion(id: string): Promise<ReadVersion | null>
  /** The link destroyed, then the tab copies closed: what is due written, locks let go. */
  close(): Promise<void>
}

/** A first visit's link stopped before the welcome: the page shows `state`, as the save state would. */
export class TabStopped extends Error {
  readonly state: Stopped
  constructor(state: Stopped) {
    super(`the design did not open: ${state}`)
    this.name = 'TabStopped'
    this.state = state
  }
}

/** The server messages that change the design's size as the client tells it. */
const SIZED: ReadonlySet<ServerMessage['type']> = new Set(['welcome', 'accepted', 'notice'])
/** No other people's presence. */
const NONE: ReadonlyMap<number, OtherPresence> = new Map()

/** The other people's presence with their names, by the client's map it was made from, which a change replaces. */
const namedFor = new WeakMap<ReadonlyMap<number, unknown>, ReadonlyMap<number, OtherPresence>>()

/** Opens the tab: at once from a kept tab copy, else once the server welcomes it. */
export async function openTab(options: OpenTabOptions): Promise<OpenTab> {
  const { designId, member, url, token, signal, socket, now, random } = options
  const report = options.report ?? ((error: unknown) => (globalThis.reportError ?? console.error)(error))
  const copies: TabCopies | 'off' = await openTabCopies({
    designId,
    member,
    ...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
    ...(options.locks ? { locks: options.locks } : {}),
    ...(options.session ? { session: options.session } : {}),
    ...(now ? { now } : {}),
  })
  const saved = copies === 'off' ? undefined : await copies.takeUp().catch(closeThenThrow(copies))
  /** The editor's recompute, once it binds it; until then a follow-up waits. */
  let recompute: Recompute | undefined
  const linkOptions = {
    url,
    designId,
    token,
    ...(socket ? { socket } : {}),
    ...(now ? { now } : {}),
    ...(random ? { random } : {}),
  }
  const link = openSyncLink({
    ...linkOptions,
    ...(saved ? { start: saved } : {}),
    client: { ...options.client, recompute: (state, touched) => (recompute ? recompute(state, touched) : 'wait') },
  })
  // Kept before it connects, so the gate is set before anything is sent.
  const kept: Kept | undefined = copies === 'off' ? undefined : copies.keep(link)

  /** What the editor is told, waiting until its first listener. */
  const waiting: LinkNotice[] = copies === 'off' ? [{ kind: 'noDeviceCopy' }] : []
  const noticeListeners = new Set<(notice: LinkNotice) => void>()
  let store: ClientStore | undefined
  let settling = false
  let closed = false
  let sentOthers = false

  function tell(notice: LinkNotice) {
    if (noticeListeners.size === 0) waiting.push(notice)
    else for (const listener of noticeListeners) hear(listener, notice)
  }

  /** Tells one listener; what it throws is reported, and the others are still told. */
  function hear(listener: (notice: LinkNotice) => void, notice: LinkNotice) {
    try {
      listener(notice)
    } catch (error) {
      report(error)
    }
  }

  /** Once the client's call is over: what the store's listeners threw is reported, and its notices told. */
  function settleSoon() {
    if (settling || !store) return
    settling = true
    queueMicrotask(() => {
      settling = false
      if (closed || !store) return
      try {
        store.settle()
      } catch (error) {
        report(error)
      }
      for (const notice of store.takeNotices()) tell(notice)
    })
  }

  /** Sends each other tab copy's work on a link of its own, once, after this tab's first welcome. */
  function sendOthers() {
    if (sentOthers || copies === 'off' || link.status() !== 'connected') return
    sentOthers = true
    void copies
      .sendOthers((start) =>
        openSyncLink({ ...linkOptions, start, ...(options.client ? { client: options.client } : {}) }),
      )
      .then(
        (notices) => {
          if (!closed) for (const notice of notices) tell(notice)
        },
        // The tab closing lets go of the database under it: what fails then is no fault.
        (error: unknown) => {
          if (!closed) report(error)
        },
      )
  }

  kept?.onStop((why) => tell({ kind: 'deviceStopped', why }))
  link.onClient((client) => {
    store ??= clientStore(client, (messages) => link.send(messages))
  })
  link.onHeard(settleSoon)
  link.onStatus(() => {
    settleSoon()
    sendOthers()
  })
  link.connect()

  try {
    await firstClient(link, signal)
  } catch (error) {
    closed = true
    link.destroy()
    if (copies !== 'off') await copies.close()
    throw error
  }
  const opened = store as unknown as ClientStore
  const ended = () => link.ended() !== null

  return {
    store: opened,
    link,
    kept: saved !== undefined,
    access: {
      readOnly: () => link.viewOnly() || ended(),
      quiet: ended,
      onChange: (listener) => link.onStatus(listener),
    },
    linkNotices: {
      on(listener) {
        noticeListeners.add(listener)
        for (const notice of waiting.splice(0)) hear(listener, notice)
        return () => noticeListeners.delete(listener)
      },
      size: () => link.client()?.size(),
      onSize: (listener) =>
        link.onHeard((message) => {
          if (SIZED.has(message.type)) listener()
        }),
    },
    presence: {
      send: (presence) => link.presence(presence),
      others: () => othersOf(link),
      onChange(listener) {
        let off = () => {}
        // The client a first visit makes once welcomed is heard too.
        const offClient = link.onClient((client) => {
          off()
          off = client.onPresence(listener)
        })
        return () => {
          offClient()
          off()
        }
      },
    },
    bind(sync, bindSignal) {
      recompute = sync.recompute
      const retry = () => {
        const client = link.client()
        if (client && !closed) link.send(client.retryFollowUps())
      }
      const off = sync.onFontsSettled(retry)
      bindSignal.addEventListener('abort', () => {
        off()
        recompute = undefined
      })
      retry()
    },
    synced: () => link.synced(),
    flushed: () => kept?.flushed() ?? Promise.resolve(),
    fetchVersion: async (id) => {
      const stored = await link.askVersion(id)
      return stored && readVersion(stored.design, stored.schemaVersion)
    },
    async close() {
      closed = true
      link.destroy()
      if (copies !== 'off') await copies.close()
    },
  }
}

/** The other people's tabs' latest presence the link's client heard, each with the name its tab is listed by. */
function othersOf(link: SyncLink): ReadonlyMap<number, OtherPresence> {
  const client = link.client()
  if (!client) return NONE
  const heard = client.presence()
  const named = namedFor.get(heard)
  if (named) return named
  const names = client.tabs()
  // A tab whose name hasn't come yet, or that has none, is shown with none.
  const next = new Map([...heard].map(([tabId, seen]) => [tabId, { ...seen, name: names.get(tabId) ?? '' }]))
  namedFor.set(heard, next)
  return next
}

/** Closes the tab copies, letting go of their locks, then throws `error` on. */
function closeThenThrow(copies: TabCopies) {
  return async (error: unknown): Promise<never> => {
    await copies.close()
    throw error
  }
}

/** Resolves once the link has its client; rejects when `signal` aborts or the link stops first. */
function firstClient(link: SyncLink, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (link.client()) return resolve()
    const offs: (() => unknown)[] = []
    const done = (error?: Error) => {
      for (const off of offs.splice(0)) off()
      if (error) reject(error)
      else resolve()
    }
    const stopped = () => {
      const status = link.status()
      if (status !== 'connected' && status !== 'disconnected') done(new TabStopped(status))
    }
    const aborted = () => done(new Error('stopped while connecting'))
    if (signal?.aborted) return aborted()
    signal?.addEventListener('abort', aborted)
    offs.push(() => signal?.removeEventListener('abort', aborted))
    offs.push(link.onStatus(stopped))
    offs.push(link.onClient(() => done()))
    stopped()
  })
}
