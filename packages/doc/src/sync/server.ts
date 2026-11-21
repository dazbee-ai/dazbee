// The sync server's core for one design (D3), as FigCraft's server is: the one authority that
// orders, checks and passes on every change set. A state machine with no I/O: the host hands it
// each connection's hello and messages and delivers what it returns, once the journal entries it
// committed are stored (host.ts). It never makes a value (I7): what it accepts is what the tab sent.
// It keeps when the design last counted as unchanged, and takes versions of it: Before restore as it
// accepts a restore, Before agent as it accepts an agent's edit when the last edit since the design
// loaded was a person's or there was none, and an Autosave when the host asks. An agent's tab is
// named to the others by the agent's name. It keeps each connected tab's latest presence in memory
// only and passes it to the other people's tabs, each person in a colour of their own (FigCraft's
// server and hub). An agent is a person of its own, apart from its member, marked as an agent's,
// and the only one whose presence carries a note.
import { nanoid } from 'nanoid'

import {
  type Accepted,
  type Access,
  type CatchUp,
  type DesignSize,
  type Entry,
  type Member,
  type NewVersion,
  PEOPLE_COLOURS,
  type Presence,
  PROTOCOL,
  type RejectReason,
  sameMember,
  type Saved,
  type SavedTab,
  SCHEMA_VERSION,
  type ServerMessage,
  SYNC_CLOSE,
  SYNC_LIMITS,
  TabMessage,
} from '@dazbee/schema'

import { recordOf } from './changes.ts'
import { bytesWritten, capIssue, designBytes, type Issue } from './checks.ts'
import { type Applied, applyChangeSet, type Loaded, noteChangeSet, replay, type Replayed } from './journal.ts'
import type { ReadState } from './state.ts'

/** The limits a server keeps: the sync core's, or smaller ones a test gives. */
export type ServerLimits = { readonly [K in keyof typeof SYNC_LIMITS]: number }

/** Who a connection is, as its token says. */
export interface Who {
  member: Member
  /** The member's name, which other tabs show ("X is editing"). */
  name: string
  access: Access
  /** For an agent's tab (ADR-0019), the agent's name, which other tabs show in place of the member's. */
  agent?: string
}

export interface ServerOptions {
  /** The hash a tab id's secret is stored as (SHA-256 in `apps/sync`). */
  hashSecret: (secret: string) => string
  /** Makes a tab id's secret, and a new sync id; `nanoid` unless a test gives its own. */
  newSecret?: () => string
  newSyncId?: () => string
  /** The time, in milliseconds since the epoch: when a tab last connected. */
  now?: () => number
  limits?: Partial<ServerLimits>
  /** Where the server logs what an operator should see: a rejection, a dead-lettered tail. */
  log?: (line: string) => void
}

/** A message for the host to deliver: to one tab, or to every connected tab but `except`. */
export interface Outgoing {
  to: number | 'all'
  except?: number
  message: ServerMessage
}

/** The connection is closed with a `SYNC_CLOSE` code: a message the sync core does not read. */
export interface Closing {
  close: number
  reason: string
}

export interface Server {
  syncId(): string
  /** The sequence number of the last accepted change set (0: none yet). */
  seq(): number
  state(): ReadState
  size(): DesignSize
  /** The catch-up log: change sets kept for tabs that come back, and their size. */
  log(): { changeSets: number; bytes: number }
  /**
   * The journal entries that no longer applied when the server opened, if any: the host moves them
   * to the dead letters (`bury`) before it stores anything else, under the new sync id.
   */
  readonly dead: Replayed['dead']
  /** A connection's first message: its tab id and welcome, or why it is closed. */
  join(hello: unknown, who: Who): { tabId: number; out: Outgoing[] } | Closing
  /** Tab `tabId`'s connection closed; the others hear it. */
  leave(tabId: number): Outgoing[]
  /**
   * Tab `tabId`'s access from now on, as a renewed token gives it: the tab hears `access` when it
   * changed. Nothing for a tab not connected.
   */
  setAccess(tabId: number, access: Access): Outgoing[]
  /** A message from tab `tabId`, as JSON gave it, with its size on the wire. */
  receive(tabId: number, message: unknown, wireBytes: number): Outgoing[] | Closing
  /**
   * The journal entries `join` and `receive` committed since the last call, numbered on from the
   * last entry. The host stores them before it sends what those calls returned.
   */
  takeJournal(): Entry[]
  /** The state as of now, for a fold. */
  save(): Saved
  /** When the first change set after the design last counted as unchanged was accepted; undefined while it is unchanged. */
  changedSince(): number | undefined
  /** Takes an Autosave of the design, which then counts as unchanged; none while it is unchanged. */
  takeAutosave(): void
  /** Whether an edit change set from tab `tabId`, accepted now, would take a Before agent version: a copy of the whole design. */
  takesBeforeAgent(tabId: number): boolean
  /** The versions taken since the last call, oldest first: the host stores each ahead of what was committed after it. */
  takeVersions(): NewVersion[]
  /** The tabs' asks for a version since the last call, for the host to read and answer. */
  takeReads(): { tabId: number; id: string }[]
}

/** A journal entry before it is numbered. */
type Unnumbered<E = Entry> = E extends Entry ? Omit<E, 'entry'> : never

/** A connected tab, in memory only. */
interface Connected {
  member: Member
  /** The name other tabs show for it: the agent's for an agent's tab, else the member's. */
  name: string
  /** The agent's name, for an agent's tab. */
  agent?: string
  access: Access
  /** Its previews passed on in the second since `since` (D11's preview rate). */
  previews: { since: number; count: number }
  /**
   * Its person's number while the design is loaded, and their index into `PEOPLE_COLOURS`: its
   * member's, or for an agent's tab the agent's own, apart from its member's.
   */
  person: number
  colour: number
  /** Its latest presence, if it sent one. */
  presence?: Presence
}

const SIZE_KEYS: readonly (keyof DesignSize)[] = ['layers', 'frames', 'pages', 'bytes']

/**
 * The server for the design `loaded` holds: the folded state with the journal replayed through
 * the design's rules (journal.ts). When an entry no longer applies, it opens at the last good one
 * under a new sync id, so every tab that comes back joins as a new tab (C43).
 */
export function openServer(loaded: Loaded, options: ServerOptions): Server {
  const limits: ServerLimits = { ...SYNC_LIMITS, ...options.limits }
  const now = options.now ?? Date.now
  const newSecret = options.newSecret ?? nanoid
  const replayed = replay(loaded, limits.rejectedIds)
  const { state, tabs, dead } = replayed
  const syncId = dead ? (options.newSyncId ?? nanoid)() : replayed.syncId
  if (dead) options.log?.(`${dead.reason}; ${dead.entries.length} entries to the dead letters, new sync id ${syncId}`)
  let { seq, nextTabId } = replayed
  // Entry numbers never go back: after a dead tail they go on from the last one stored (D8).
  let entry = dead ? loaded.lastEntry : replayed.entry
  let bytes = designBytes(state)
  const connected = new Map<number, Connected>()
  /** Each person's number and colour while the design is loaded, by `personKey`, and the next number to give. */
  const people = new Map<string, { person: number; colour: number }>()
  let nextPerson = 1
  /** The latest accepted change sets, oldest first, with their sizes. */
  let log: { changeSet: Accepted; bytes: number }[] = []
  let logBytes = 0
  for (const { changeSet, bytes: size } of replayed.accepted) remember(changeSet, size)
  let journal: Entry[] = []
  /**
   * The sequence number at which the design last counted as unchanged: the fold's, or the newest
   * version's under this sync id when that is later. It is changed while its sequence number is another.
   */
  const last = loaded.lastVersion
  let versioned = Math.max(loaded.saved.versioned, last && last.syncId === syncId ? last.seq : 0)
  let changedSince = seq === versioned ? undefined : now()
  let versions: NewVersion[] = []
  let reads: { tabId: number; id: string }[] = []
  /** Whether the last edit change set accepted since the design loaded came from an agent's tab. */
  let agentEditedLast = false

  function join(raw: unknown, who: Who): { tabId: number; out: Outgoing[] } | Closing {
    const parsed = TabMessage.safeParse(raw)
    if (!parsed.success || parsed.data.type !== 'hello') return closing('a connection starts with hello')
    const hello = parsed.data
    if (hello.protocol !== PROTOCOL) return closing(`protocol ${hello.protocol}; this server speaks ${PROTOCOL}`)
    const r = hello.resume
    const held = r && r.syncId === syncId ? tabs.get(r.tabId) : undefined
    // A tab id resumes only with its secret and for its member (C44, I12); otherwise it joins as new.
    const resumed =
      r && held && held.secretHash === options.hashSecret(r.secret) && sameMember(held.member, who.member)
        ? r
        : undefined
    const tabId = resumed?.tabId ?? nextTabId++
    const secret = resumed?.secret ?? newSecret()
    const tab = tabs.get(tabId) ?? newTab(tabId, who.member, secret)
    tab.lastSeen = now()
    // The log holds every change set after `floor`. A tab applies each missed change set with every
    // one it has waiting: past `catchUpWork` of that, the whole design is the cheaper catch-up.
    const floor = log[0] ? log[0].changeSet.seq - 1 : seq
    const catchUp: CatchUp =
      resumed && resumed.seq <= seq && resumed.seq >= floor && (seq - resumed.seq) * hello.waiting <= limits.catchUpWork
        ? { changeSets: log.filter((l) => l.changeSet.seq > resumed.seq).map((l) => l.changeSet) }
        : { design: state.toRecords() }
    const others = Object.fromEntries([...connected].filter(([id]) => id !== tabId).map(([id, c]) => [id, c.name]))
    // A tab that connects again before its old connection closed takes over from it: the others know it already.
    const before = connected.get(tabId)
    const again = before !== undefined
    const name = who.agent ?? who.name
    const conn: Connected = {
      member: who.member,
      name,
      ...(who.agent === undefined ? {} : { agent: who.agent }),
      access: who.access,
      previews: { since: 0, count: 0 },
      ...personOf(tabId, who),
      // A tab taking over from its own connection is where it was: the others still show it there.
      ...(before?.presence ? { presence: before.presence } : {}),
    }
    connected.set(tabId, conn)
    const welcome: ServerMessage = {
      type: 'welcome',
      syncId,
      tabId,
      seq,
      secret,
      access: who.access,
      size: size(),
      tabs: others,
      processed: { lastChangeSet: tab.lastChangeSet, rejected: [...tab.rejected] },
      catchUp,
      presence: true,
      presenceNote: true,
    }
    const out: Outgoing[] = [{ to: tabId, message: welcome }]
    // Where the other people are, after the welcome.
    for (const [id, other] of connected) {
      if (other.presence && other.person !== conn.person) {
        out.push({ to: tabId, message: presenceMessage(id, other, other.presence) })
      }
    }
    if (!again) out.push({ to: 'all', except: tabId, message: { type: 'joined', tabId, name } })
    return { tabId, out }
  }

  /**
   * The person's number and colour while the design is loaded, given as they first join: their
   * connected tab's; else the colour that was theirs, unless another person connected now has it;
   * else the first no other connected person has, or the one the count of those people picks. An
   * agent's tab is a person of its own, by its member and the agent's name.
   */
  function personOf(tabId: number, who: Who): { person: number; colour: number } {
    const key = personKey(who)
    const theirs = (c: Connected) => personKey(c) === key
    // Every tab of a person has one colour.
    const own = [...connected].find(([id, c]) => id !== tabId && theirs(c))?.[1]
    if (own) return { person: own.person, colour: own.colour }
    const others = [...connected].filter(([id, c]) => id !== tabId && !theirs(c)).map(([, c]) => c)
    const taken = new Set(others.map((c) => c.colour))
    const known = people.get(key)
    if (known && !taken.has(known.colour)) return known
    const free = PEOPLE_COLOURS.findIndex((_, i) => !taken.has(i))
    const colour = free >= 0 ? free : new Set(others.map((c) => c.person)).size % PEOPLE_COLOURS.length
    const given = { person: known?.person ?? nextPerson++, colour }
    people.set(key, given)
    return given
  }

  /** A tab id given out now, journaled with the tab ids it drops to keep under the limit. */
  function newTab(tabId: number, member: Member, secret: string): SavedTab {
    const tab: SavedTab = {
      member,
      secretHash: options.hashSecret(secret),
      lastChangeSet: 0,
      rejected: [],
      lastSeen: now(),
    }
    tabs.set(tabId, tab)
    const dropped = dropTabs(tabId)
    record({ kind: 'issued', tabId, member, secretHash: tab.secretHash, at: tab.lastSeen, dropped })
    return tab
  }

  /**
   * Past the limit, drops every tab id not connected for `tabIdleMs`, and more of those gone longest
   * if that is not enough; never a connected one, nor `keep`.
   */
  function dropTabs(keep: number): number[] {
    if (tabs.size <= limits.tabIds) return []
    const gone = [...tabs]
      .filter(([id]) => !connected.has(id) && id !== keep)
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
    const idle = gone.filter(([, tab]) => now() - tab.lastSeen >= limits.tabIdleMs).length
    const dropped = gone.slice(0, Math.max(idle, tabs.size - limits.tabIds)).map(([id]) => id)
    for (const id of dropped) tabs.delete(id)
    return dropped
  }

  function receive(tabId: number, raw: unknown, wireBytes: number): Outgoing[] | Closing {
    const tab = tabs.get(tabId)
    const conn = connected.get(tabId)
    if (!tab || !conn) return closing('a connection starts with hello')
    const parsed = TabMessage.safeParse(raw)
    if (!parsed.success) return closing('a message this server does not read')
    const message = parsed.data
    if (message.type === 'hello') return closing('hello comes once')
    if (message.type === 'ping') return [{ to: tabId, message: { type: 'pong' } }]
    // A renewed token is the connection's to check (build step 7).
    if (message.type === 'token') return []
    // Any tab may ask for a version, a Reviewer's too: the host reads it and answers that tab alone.
    if (message.type === 'version') {
      reads.push({ tabId, id: message.id })
      return []
    }
    if (message.type === 'presence') {
      if (wireBytes > limits.presenceBytes) return []
      const { page, pointer, selection, frame, note } = message
      // Only an agent says what it is doing: a person's tab has no way to give a note.
      const noted = conn.agent !== undefined && note !== undefined && note !== '' ? { note } : {}
      conn.presence = { page, pointer, selection, frame, ...noted }
      const passed = presenceMessage(tabId, conn, conn.presence)
      // To the other people's tabs: a person's own tabs never show them their own cursor.
      return [...connected]
        .filter(([, other]) => other.person !== conn.person)
        .map(([id]) => ({ to: id, message: passed }))
    }
    if (message.type === 'preview') {
      if (conn.access === 'view' || wireBytes > limits.previewBytes || !previewTaken(conn)) return []
      const { after, changes } = message
      return [{ to: 'all', except: tabId, message: { type: 'preview', tabId, after, changes } }]
    }
    // A change set taken in already (sent again around a reconnect) is ignored: the tab learns what
    // happened to it from its welcome's `processed`.
    if (message.id <= tab.lastChangeSet) return []
    const result =
      conn.access === 'view' ? reject('viewOnly', 'the member may only view') : accept(message, wireBytes, tabId)
    noteChangeSet(tab, message.id, 'reason' in result, limits.rejectedIds)
    if ('reason' in result) {
      options.log?.(`tab ${tabId}'s change set ${message.id} rejected (${result.reason}): ${result.words}`)
      record({ kind: 'rejected', tabId, changeSetId: message.id })
      // A rejected change set ends its step: the others drop its preview.
      const cleared: ServerMessage = { type: 'preview', tabId, after: message.id, changes: [] }
      return [
        { to: tabId, message: { type: 'reject', changeSetId: message.id, reason: result.reason } },
        { to: 'all', except: tabId, message: cleared },
      ]
    }
    remember(result.changeSet, wireBytes)
    record({ kind: 'accepted', member: tab.member, changeSet: result.changeSet, bytes: wireBytes })
    const out: Outgoing[] = [{ to: 'all', message: { type: 'accepted', ...result.changeSet, size: size() } }]
    // The others hear who restored which version; the restorer knows.
    if (message.restore) {
      const restored: ServerMessage = { type: 'restored', tabId, by: conn.name, mark: message.restore }
      out.push({ to: 'all', except: tabId, message: restored })
    }
    if (result.warn) out.push({ to: 'all', message: { type: 'notice', kind: 'nearLimit', size: size() } })
    return out
  }

  /** Whether one more preview from the tab may pass this second; past `previewsPerSecond` it is dropped. */
  function previewTaken(conn: Connected): boolean {
    const time = now()
    if (time - conn.previews.since >= 1000) conn.previews = { since: time, count: 0 }
    if (conn.previews.count >= limits.previewsPerSecond) return false
    conn.previews.count++
    return true
  }

  /**
   * Checks a change set of `author` in D3's order and commits it with the next sequence number, or
   * says why it is rejected: message size and base; caps; apply and the checks; C46; size growth.
   */
  function accept(
    message: Extract<TabMessage, { type: 'changes' }>,
    wireBytes: number,
    author: number,
  ): { changeSet: Accepted; warn: boolean } | Issue {
    if (wireBytes > limits.messageBytes) return reject('tooManyChanges', `a message of ${wireBytes} bytes`)
    if (message.base > seq) return reject('baseInFuture', `base ${message.base}, but the design is at ${seq}`)
    const applied = capIssue(message.changes) ?? applyChangeSet(state, message.changes)
    if ('reason' in applied) return applied
    if (message.kind === 'undo' || message.kind === 'redo') {
      const issue = placedSinceIssue(applied, message, author)
      if (issue) return issue
    }
    const before = size()
    const grown = bytes + bytesWritten(applied.after, state, applied.written)
    const after: DesignSize = {
      layers: applied.after.count('layer'),
      frames: applied.after.count('frame'),
      pages: applied.after.count('page'),
      bytes: grown,
    }
    const tooBig = grownPast(before, after)
    if (tooBig) return reject('designTooBig', tooBig)
    // The design as it was is kept before an agent's first edit since a person's, whether changed or
    // not, and before a restore replaces it; after a restore, it counts as unchanged.
    const keep = message.restore?.versionId ?? null
    const agent = connected.get(author)?.agent
    if (message.kind === 'edit') {
      if (agent !== undefined && !agentEditedLast) takeVersion('beforeAgent', { keep, name: agent })
      agentEditedLast = agent !== undefined
    }
    if (message.restore) takeVersion('beforeRestore', { keep })
    applied.after.commit({ seq: seq + 1, author })
    seq += 1
    bytes = grown
    if (message.restore) markUnchanged()
    else changedSince ??= now()
    const changeSet: Accepted = { seq, author, changeSetId: message.id, changes: message.changes }
    return { changeSet, warn: nearLimit(before, after) }
  }

  /**
   * Why an undo or a redo can't delete what it would (C46), if it can't: a record it deletes, by name
   * or with what holds it, was created or moved there by another tab after the change set's base.
   */
  function placedSinceIssue(
    applied: Applied,
    message: Extract<TabMessage, { type: 'changes' }>,
    author: number,
  ): Issue | undefined {
    for (const key of applied.written) {
      const { part, id } = recordOf(key)
      if (applied.after.get(part, id) || !state.get(part, id)) continue
      const at = state.placedAt(id)
      if (at && at.seq > message.base && at.author !== author) {
        return reject('placedSince', `"${id}" was placed by tab ${at.author} at ${at.seq}, after base ${message.base}`)
      }
    }
    return undefined
  }

  /** Why a change set takes the design past a limit, if it does: only a part it grows counts (D11). */
  function grownPast(before: DesignSize, after: DesignSize): string | undefined {
    const caps = sizeCaps(limits)
    for (const key of SIZE_KEYS) {
      if (after[key] > caps[key] && after[key] > before[key]) return `${after[key]} ${key}, past ${caps[key]}`
    }
    return undefined
  }

  /** Whether the change set took a part of the design past the share of its limit that warns. */
  function nearLimit(before: DesignSize, after: DesignSize): boolean {
    const caps = sizeCaps(limits)
    return SIZE_KEYS.some((key) => {
      const at = caps[key] * limits.warnAt
      return before[key] < at && after[key] >= at
    })
  }

  function size(): DesignSize {
    return { layers: state.count('layer'), frames: state.count('frame'), pages: state.count('page'), bytes }
  }

  /** Keeps an accepted change set in the catch-up log, dropping the oldest past its limits. */
  function remember(changeSet: Accepted, size: number) {
    log.push({ changeSet, bytes: size })
    logBytes += size
    let drop = 0
    while (drop < log.length && (log.length - drop > limits.logChangeSets || logBytes > limits.logBytes)) {
      logBytes -= (log[drop] as { bytes: number }).bytes
      drop++
    }
    if (drop > 0) log = log.slice(drop)
  }

  /**
   * Takes a version of the design as it is now, named `name`, never dropping `keep` to make room, and
   * marks it unchanged: a Before agent version always, any other only while the design is changed.
   */
  function takeVersion(
    kind: NewVersion['kind'],
    { keep = null, name = '' }: { keep?: string | null; name?: string } = {},
  ) {
    if (changedSince === undefined && kind !== 'beforeAgent') return
    versions.push({
      kind,
      name,
      description: '',
      savedBy: null,
      syncId,
      seq,
      schemaVersion: SCHEMA_VERSION,
      records: state.toRecords(),
      keep,
    })
    markUnchanged()
  }

  function markUnchanged() {
    versioned = seq
    changedSince = undefined
  }

  function record(change: Unnumbered) {
    journal.push({ ...change, entry: ++entry } as Entry)
  }

  return {
    syncId: () => syncId,
    seq: () => seq,
    state: () => state,
    size,
    log: () => ({ changeSets: log.length, bytes: logBytes }),
    dead,
    join,
    leave: (tabId) => {
      const tab = tabs.get(tabId)
      if (!connected.delete(tabId)) return []
      if (tab) tab.lastSeen = now()
      return [{ to: 'all', except: tabId, message: { type: 'left', tabId } }]
    },
    setAccess: (tabId, access) => {
      const conn = connected.get(tabId)
      if (!conn || conn.access === access) return []
      conn.access = access
      return [{ to: tabId, message: { type: 'access', access } }]
    },
    receive,
    takeJournal: () => {
      const taken = journal
      journal = []
      return taken
    },
    save: () => ({
      syncId,
      entry,
      seq,
      state: state.toRecords(),
      placed: state.placements(),
      tabs: Object.fromEntries([...tabs].map(([id, t]) => [id, { ...t, rejected: [...t.rejected] }])),
      nextTabId,
      versioned,
    }),
    changedSince: () => changedSince,
    takeAutosave: () => takeVersion('auto'),
    takesBeforeAgent: (tabId) => connected.get(tabId)?.agent !== undefined && !agentEditedLast,
    takeVersions: () => {
      const taken = versions
      versions = []
      return taken
    },
    takeReads: () => {
      const taken = reads
      reads = []
      return taken
    },
  }
}

/** A design's limits, by the part of its size each bounds. */
function sizeCaps(limits: ServerLimits): DesignSize {
  return {
    layers: limits.designLayers,
    frames: limits.designFrames,
    pages: limits.designPages,
    bytes: limits.designBytes,
  }
}

/** Tab `tabId`'s presence, as the other people's tabs hear it: an agent's marked as one. */
function presenceMessage(tabId: number, conn: Connected, presence: Presence): ServerMessage {
  const { person, colour } = conn
  return conn.agent === undefined
    ? { type: 'presence', tabId, person, colour, presence }
    : { type: 'presence', tabId, person, colour, agent: true, presence }
}

/** Whose tab it is, for its number and colour: its member, or the agent working for them. */
function personKey({ member, agent }: { member: Member; agent?: string }): string {
  const memberKey = JSON.stringify([member.workspaceId, member.userId])
  return agent === undefined ? memberKey : `${memberKey} agent ${JSON.stringify(agent)}`
}

/** A connection closed for a message the sync core does not read. */
function closing(reason: string): Closing {
  return { close: SYNC_CLOSE.protocol, reason }
}

function reject(reason: RejectReason, words: string): Issue {
  return { reason, words }
}
