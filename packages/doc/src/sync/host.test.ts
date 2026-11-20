import { describe, expect, it } from 'vitest'

import {
  type Change,
  type DesignRecords,
  type Member,
  PROTOCOL,
  type Resume,
  type ServerMessage,
  SYNC_CLOSE,
} from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { type Connection, DELETED, type HostOptions, openHost, UNSAVED } from './host.ts'
import { firstSaved } from './journal.ts'
import { memoryJournal, type MemoryRows, memoryRows } from './memory-journal.ts'
import type { Who } from './server.ts'
import { versionText } from './version-text.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
const editor = (member: Member = ANN): Who => ({ member, name: member.userId, access: 'edit' })

const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })

/** A tab's connection: what it heard, and how it was closed. */
interface TestConnection extends Connection {
  heard: ServerMessage[]
  closed?: { code: number; reason: string }
}

function connection(): TestConnection {
  const conn: TestConnection = {
    heard: [],
    send: (message) =>
      conn.heard.push(message.type === 'storedVersion' ? (JSON.parse(versionText(message)) as ServerMessage) : message),
    close: (code, reason) => {
      conn.closed = { code, reason }
    },
  }
  return conn
}

function testOptions(more: Partial<HostOptions> = {}): HostOptions {
  let secrets = 0
  let syncIds = 0
  return {
    hashSecret: (secret) => `hash:${secret}`,
    newSecret: () => `secret${++secrets}`,
    newSyncId: () => `sync${++syncIds}`,
    now: () => 1000,
    ...more,
  }
}

const rows = (): MemoryRows => memoryRows(firstSaved(linkedDesign() as unknown as DesignRecords, 's0'))

const hello = (resume?: Resume) => ({
  type: 'hello',
  protocol: PROTOCOL,
  token: 't',
  waiting: 0,
  ...(resume ? { resume } : {}),
})
const changes = (id: number, base: number, list: Change[]) => ({
  type: 'changes',
  id,
  base,
  kind: 'edit',
  changes: list,
})

/** The welcome a connection heard. */
function welcomeOf(conn: TestConnection) {
  const welcome = conn.heard.find((m) => m.type === 'welcome')
  if (!welcome) throw new Error('no welcome')
  return welcome
}

/** The types of the messages a connection heard. */
const typesOf = (conn: TestConnection) => conn.heard.map((m) => m.type)

describe('openHost', () => {
  it('sends the answers to what it took in only once that is stored (I2)', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    const release = journal.holdNext()
    host.connect(a, hello(), editor())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(a.heard).toEqual([])
    release()
    await host.settled()
    expect(typesOf(a)).toEqual(['welcome'])
    expect(journal.rows.journal.map((e) => e.kind)).toEqual(['issued'])
  })

  it('stores what came in during a write in the next one, and answers each connection open when it was taken in', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    const b = connection()
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    await host.settled()
    const release = journal.holdNext()
    host.message(a, changes(1, 0, [rename('badge', 'One')]), 100)
    await Promise.resolve()
    host.message(b, changes(1, 0, [rename('title', 'Two')]), 100)
    host.close(b)
    release()
    await host.settled()
    expect(journal.writes()).toBe(4)
    expect(journal.rows.journal.map((e) => e.kind)).toEqual(['issued', 'issued', 'accepted', 'accepted'])
    expect(typesOf(a).slice(-3)).toEqual(['accepted', 'accepted', 'left'])
    // b closed before its change set was stored: it hears nothing of it.
    expect(typesOf(b).filter((t) => t === 'accepted')).toEqual([])
    expect(host.server()?.state().get('layer', 'title')?.name).toBe('Two')
  })

  it('passes previews and pongs on at once, while a write is in flight, but only to a tab welcomed', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    const b = connection()
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    await host.settled()
    const release = journal.holdNext()
    host.message(a, changes(1, 0, [rename('badge', 'One')]), 100)
    const c = connection()
    // c's welcome waits on its tab id being stored, behind a's change set.
    host.connect(c, hello(), editor())
    host.message(a, { type: 'preview', after: 1, changes: [] }, 10)
    host.message(b, { type: 'ping' }, 10)
    await Promise.resolve()
    expect(typesOf(b).slice(1)).toEqual(['preview', 'pong'])
    expect(typesOf(a).slice(1)).toEqual(['joined'])
    expect(c.heard).toEqual([])
    release()
    await host.settled()
    // The preview is not held for c: previews come again while a step is open.
    expect(typesOf(c)).toEqual(['welcome'])
    expect(typesOf(b).slice(-2)).toEqual(['accepted', 'joined'])
  })

  it("passes presence on at once to a tab welcomed, and gives a tab joining the others' latest after its welcome", async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    const b = connection()
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    await host.settled()
    const release = journal.holdNext()
    host.message(a, changes(1, 0, [rename('badge', 'One')]), 100)
    const c = connection()
    host.connect(c, hello(), editor({ userId: 'cat', workspaceId: 'w1' }))
    const here = { page: 'p1', pointer: [10, 20], selection: [], frame: null }
    host.message(a, { type: 'presence', ...here }, 60)
    await Promise.resolve()
    expect(typesOf(b).slice(1)).toEqual(['presence'])
    expect(c.heard).toEqual([])
    release()
    await host.settled()
    // c hears Ann's latest after its welcome, whether its join or her presence came first.
    expect(typesOf(c).slice(0, 2)).toEqual(['welcome', 'presence'])
    expect(c.heard[1]).toMatchObject({ type: 'presence', presence: here })
  })

  it('never lets a presence held for a tab joining overtake a later one, whatever writes its welcome waits on', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    const b = connection()
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    await host.settled()
    const ticks = async () => {
      for (let n = 0; n < 10; n++) await Promise.resolve()
    }
    const at = (x: number | null) => ({
      type: 'presence',
      page: 'p1',
      pointer: x === null ? null : [x, 0],
      selection: [],
      frame: null,
    })
    const releaseFirst = journal.holdNext()
    host.message(a, changes(1, 0, [rename('badge', 'One')]), 100)
    const c = connection()
    host.connect(c, hello(), editor({ userId: 'cat', workspaceId: 'w1' }))
    host.message(a, at(1), 60)
    const releaseWelcome = journal.holdNext()
    releaseFirst()
    await ticks()
    host.message(a, at(2), 60)
    host.message(b, changes(1, 1, [rename('title', 'Two')]), 100)
    const releaseLast = journal.holdNext()
    releaseWelcome()
    await ticks()
    expect(typesOf(c)[0]).toBe('welcome')
    host.message(a, at(null), 60)
    releaseLast()
    await host.settled()
    const pointers = c.heard.flatMap((m) => (m.type === 'presence' ? [m.presence.pointer] : []))
    expect(pointers).toEqual([[2, 0], null])
  })

  it('takes a role change in order with the messages around it, and ignores one for a tab not joined', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    host.connect(a, hello(), editor())
    host.message(a, changes(1, 0, [rename('badge', 'One')]), 100)
    host.access(a, 'view')
    host.message(a, changes(2, 1, [rename('badge', 'Two')]), 100)
    host.access(connection(), 'view')
    await host.settled()
    expect(a.heard.slice(1)).toMatchObject([
      { type: 'accepted', changeSetId: 1 },
      { type: 'access', access: 'view' },
      { type: 'reject', changeSetId: 2, reason: 'viewOnly' },
    ])
    host.access(a, 'edit')
    host.message(a, changes(3, 1, [rename('badge', 'Three')]), 100)
    await host.settled()
    expect(a.heard.slice(4)).toMatchObject([
      { type: 'access', access: 'edit' },
      { type: 'accepted', changeSetId: 3 },
    ])
  })

  it('on a failed write, stores nothing after it, closes every connection and opens again from the journal', async () => {
    const journal = memoryJournal(rows())
    const lines: string[] = []
    const host = openHost(journal, testOptions({ log: (line) => lines.push(line) }))
    const a = connection()
    host.connect(a, hello(), editor())
    await host.settled()
    const { tabId, secret, syncId } = welcomeOf(a)
    journal.failNext()
    host.message(a, changes(1, 0, [rename('badge', 'Lost')]), 100)
    host.message(a, changes(2, 0, [rename('title', 'Lost too')]), 100)
    await host.settled()
    expect(a.closed).toEqual({ code: SYNC_CLOSE.storeFailed, reason: UNSAVED })
    expect(typesOf(a)).toEqual(['welcome'])
    expect(lines).toEqual(['a write failed: Error: a planted write failure'])
    expect(host.server()).toBeUndefined()
    // The tab reconnects and resumes: the design opened again holds nothing of what was not stored.
    const back = connection()
    host.connect(back, hello({ syncId, tabId, seq: 0, secret }), editor())
    await host.settled()
    expect(welcomeOf(back)).toMatchObject({ tabId, seq: 0, processed: { lastChangeSet: 0 } })
    expect(host.server()?.state().get('layer', 'badge')?.name).not.toBe('Lost')
  })

  it('turns a second server holding the same design into a failed write, on the one that stored second', async () => {
    const shared = rows()
    const first = openHost(memoryJournal(shared), testOptions())
    const second = openHost(memoryJournal(shared), testOptions())
    const a = connection()
    const b = connection()
    first.connect(a, hello(), editor())
    second.connect(b, hello(), editor(BOB))
    await Promise.all([first.settled(), second.settled()])
    expect(typesOf(a)).toEqual(['welcome'])
    expect(b.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(b.heard).toEqual([])
    // Opened again, the second sees what the first stored, and numbers on from it.
    const again = connection()
    second.connect(again, hello(), editor(BOB))
    await second.settled()
    expect(welcomeOf(again).tabId).toBe(welcomeOf(a).tabId + 1)
    expect(shared.journal.map((e) => e.entry)).toEqual([1, 2])
  })

  it('moves a journal tail that no longer applies to the dead letters before it stores anything, under a new sync id (C43)', async () => {
    const stored = rows()
    const first = openHost(memoryJournal(stored), testOptions())
    const a = connection()
    first.connect(a, hello(), editor())
    await first.settled()
    first.message(a, changes(1, 0, [rename('title', 'T')]), 100)
    await first.settled()
    // The stored state loses the layer the change set wrote: entry 2 no longer applies.
    delete (stored.saved.state.nodes as Record<string, unknown>).title
    const second = openHost(memoryJournal(stored), testOptions())
    const back = connection()
    const { tabId, secret } = welcomeOf(a)
    second.connect(back, hello({ syncId: 's0', tabId, seq: 1, secret }), editor())
    await second.settled()
    expect(stored.dead.map((d) => d.entry.entry)).toEqual([2])
    expect(stored.dead[0]?.reason).toMatch(/^entry 2 no longer applies/)
    // Entry numbers go on past the dead ones (D8).
    expect(stored.saved).toMatchObject({ syncId: 'sync1', entry: 2 })
    expect(welcomeOf(back)).toMatchObject({ syncId: 'sync1', seq: 0 })
    expect(welcomeOf(back).tabId).not.toBe(tabId)
    expect(stored.journal.map((e) => e.entry)).toEqual([3])
    // The first server, still holding the design, can store nothing more: its next write is fenced.
    first.message(a, changes(2, 1, [rename('badge', 'Lost')]), 100)
    await first.settled()
    expect(a.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(typesOf(a).filter((t) => t === 'accepted')).toHaveLength(1)
    expect(stored.journal.map((e) => e.entry)).toEqual([3])
  })

  it('folds the journal once it holds so many accepted entries: the others count by bytes only', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions({ foldEntries: 3 }))
    const a = connection()
    host.connect(a, hello(), editor())
    for (let id = 1; id <= 4; id++) host.message(a, changes(id, id - 1, [rename('badge', `B${id}`)]), 100)
    await host.settled()
    expect(journal.rows.saved).toMatchObject({ entry: 4, seq: 3 })
    expect(journal.rows.journal.map((e) => e.entry)).toEqual([5])
    expect(typesOf(a).filter((t) => t === 'accepted')).toHaveLength(4)
  })

  it('folds the journal once its entries pass so many bytes', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions({ foldBytes: 1 }))
    host.connect(connection(), hello(), editor())
    await host.settled()
    expect([journal.rows.saved.entry, journal.rows.journal]).toEqual([1, []])
  })

  it('takes the events in order when a connection closes inside a close the host made', async () => {
    const host = openHost(memoryJournal(rows()), testOptions())
    const a = connection()
    const b = connection()
    // b's transport reports its close at once, inside the call that closed it.
    b.close = (code, reason) => {
      b.closed = { code, reason }
      host.close(b)
    }
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    host.message(b, { type: 'nonsense' }, 10)
    host.message(a, changes(1, 0, [rename('badge', 'B')]), 100)
    await host.settled()
    expect(b.closed?.code).toBe(SYNC_CLOSE.protocol)
    expect(typesOf(a)).toEqual(['welcome', 'joined', 'left', 'accepted'])
  })

  it('closes a connection that sends before its hello, and the old connection of a tab that connected again', async () => {
    const host = openHost(memoryJournal(rows()), testOptions())
    const early = connection()
    host.message(early, changes(1, 0, []), 10)
    const a = connection()
    host.connect(a, hello(), editor())
    await host.settled()
    expect(early.closed?.code).toBe(SYNC_CLOSE.protocol)
    const { syncId, tabId, secret } = welcomeOf(a)
    const again = connection()
    host.connect(again, hello({ syncId, tabId, seq: 0, secret }), editor())
    await host.settled()
    expect(a.closed).toEqual({ code: SYNC_CLOSE.replaced, reason: 'the tab connected again' })
    expect(welcomeOf(again).tabId).toBe(tabId)
  })

  it('closes every connection waiting when the design cannot be loaded, and loads it again on the next', async () => {
    const journal = memoryJournal(rows())
    let fail = true
    const load = journal.load
    const lines: string[] = []
    const host = openHost(
      { ...journal, load: () => (fail ? Promise.reject(new Error('down')) : load()) },
      testOptions({ log: (line) => lines.push(line) }),
    )
    const a = connection()
    host.connect(a, hello(), editor())
    await host.settled()
    expect(a.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(lines).toEqual(['the design could not be loaded: Error: down'])
    fail = false
    const b = connection()
    host.connect(b, hello(), editor())
    await host.settled()
    expect(typesOf(b)).toEqual(['welcome'])
  })
})

/** Lets promises and timers queued now run. */
const ticks = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Turns a test grants one at a time: `waiting()` says how many were asked for and not yet granted. */
function grantedTurns() {
  const asked: (() => void)[] = []
  return {
    turn: () => new Promise<void>((resolve) => asked.push(resolve)),
    waiting: () => asked.length,
    /** Grants the oldest turn asked for, once what runs now has asked. */
    grant: async () => {
      await ticks()
      asked.shift()?.()
      await ticks()
    },
  }
}

describe('openHost, as a design comes and goes', () => {
  it('closes every connection with designDeleted when a write finds the design gone, and tells its manager', async () => {
    const journal = memoryJournal(rows())
    const lines: string[] = []
    let gone = 0
    const host = openHost(
      journal,
      testOptions({
        log: (line) => lines.push(line),
        dropped: (code) => (gone += code === SYNC_CLOSE.designDeleted ? 1 : 0),
      }),
    )
    const a = connection()
    const b = connection()
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    await host.settled()
    journal.remove()
    host.message(a, changes(1, 0, [rename('badge', 'Gone')]), 100)
    await host.settled()
    expect(a.closed).toEqual({ code: SYNC_CLOSE.designDeleted, reason: DELETED })
    expect(b.closed).toEqual({ code: SYNC_CLOSE.designDeleted, reason: DELETED })
    expect(typesOf(a).filter((t) => t === 'accepted')).toEqual([])
    expect(gone).toBe(1)
    expect(lines).toEqual(['the design was deleted'])
  })

  it('closes a connection with designDeleted when the design is gone as it loads', async () => {
    const journal = memoryJournal(rows())
    journal.remove()
    let gone = 0
    const host = openHost(
      journal,
      testOptions({ dropped: (code) => (gone += code === SYNC_CLOSE.designDeleted ? 1 : 0) }),
    )
    const a = connection()
    host.connect(a, hello(), editor())
    await host.settled()
    expect(a.closed?.code).toBe(SYNC_CLOSE.designDeleted)
    expect(gone).toBe(1)
  })

  it('takes the open and each connect in a turn of its own, the events behind them waiting', async () => {
    const turns = grantedTurns()
    const host = openHost(memoryJournal(rows()), testOptions({ turn: turns.turn }))
    const a = connection()
    const b = connection()
    host.connect(a, hello(), editor())
    host.connect(b, hello(), editor(BOB))
    // The open, then each connect, takes a turn.
    await turns.grant()
    expect([a.heard, b.heard]).toEqual([[], []])
    expect(turns.waiting()).toBe(1)
    await turns.grant()
    expect(typesOf(a)).toEqual(['welcome'])
    expect(b.heard).toEqual([])
    expect(turns.waiting()).toBe(1)
    await turns.grant()
    expect(typesOf(b)).toEqual(['welcome'])
    await host.settled()
  })

  it('folds in a turn of its own, holding exactly what was committed before it', async () => {
    const turns = grantedTurns()
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions({ turn: turns.turn, foldEntries: 2 }))
    const a = connection()
    host.connect(a, hello(), editor())
    await turns.grant()
    await turns.grant()
    await host.settled()
    // Three change sets wait behind b's connect; the second passes the fold's limit.
    host.connect(connection(), hello(), editor(BOB))
    host.message(a, changes(1, 0, [rename('badge', 'One')]), 100)
    host.message(a, changes(2, 0, [rename('badge', 'Two')]), 100)
    host.message(a, changes(3, 0, [rename('badge', 'Three')]), 100)
    await turns.grant()
    // The fold waits for its turn, and the third change set behind it.
    expect(turns.waiting()).toBe(1)
    expect(host.server()?.seq()).toBe(2)
    await turns.grant()
    await host.settled()
    expect(journal.rows.saved).toMatchObject({ entry: 4, seq: 2 })
    expect(journal.rows.journal.map((e) => e.entry)).toEqual([5])
  })

  it('takes an agent’s edit that keeps a Before agent version in a turn of its own, and its next edit at once', async () => {
    const turns = grantedTurns()
    const host = openHost(memoryJournal(rows()), testOptions({ turn: turns.turn }))
    const claude = connection()
    host.connect(claude, hello(), { ...editor(), agent: 'Claude (agent)' })
    await turns.grant()
    await turns.grant()
    await host.settled()

    host.message(claude, changes(1, 0, [rename('badge', 'One')]), 100)
    await ticks()
    expect([turns.waiting(), host.server()?.seq()]).toEqual([1, 0])
    await turns.grant()
    await host.settled()
    host.message(claude, changes(2, 1, [rename('badge', 'Two')]), 100)
    await host.settled()
    expect([turns.waiting(), host.server()?.seq()]).toEqual([0, 2])
  })

  it('unloads only with no tab joined, folding what was stored since the last fold', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    host.connect(a, hello(), editor())
    await host.settled()
    host.message(a, changes(1, 0, [rename('badge', 'Kept')]), 100)
    await host.settled()
    expect(host.bytes()).toBe(host.server()?.size().bytes)
    expect(host.bytes()).toBeGreaterThan(0)
    expect(await host.unload()).toBe(false)
    expect(journal.rows.journal.length).toBe(2)
    host.close(a)
    expect(await host.unload()).toBe(true)
    expect(journal.rows.journal).toEqual([])
    expect(journal.rows.saved).toMatchObject({ entry: 2, seq: 1 })
    expect(host.server()).toBeUndefined()
    expect(host.bytes()).toBe(0)
  })

  it('unloads with no write when nothing was stored since the last fold', async () => {
    const journal = memoryJournal(rows())
    const host = openHost(journal, testOptions())
    const a = connection()
    host.connect(a, hello(), editor())
    await host.settled()
    host.close(a)
    await host.settled()
    expect(await host.unload()).toBe(true)
    const writes = journal.writes()
    // Opened again: its journal is empty, so its unload has nothing to fold.
    const again = openHost(journal, testOptions())
    const { tabId, secret, syncId } = welcomeOf(a)
    const back = connection()
    again.connect(back, hello({ syncId, tabId, seq: 0, secret }), editor())
    again.close(back)
    await again.settled()
    const stored = journal.writes()
    expect(await again.unload()).toBe(true)
    expect(journal.writes()).toBe(stored)
    expect(stored).toBeGreaterThanOrEqual(writes)
  })
})
