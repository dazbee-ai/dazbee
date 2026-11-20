// The design host's versions: a Before restore version stored ahead of its restore, an Autosave of a
// changed design when asked and as it unloads, when the design counts as changed, and a tab's ask
// for a version's records. On the memory journal, with a clock the tests move.
import { describe, expect, it } from 'vitest'

import {
  type Change,
  type DesignRecords,
  type Member,
  PROTOCOL,
  type RestoreMark,
  SCHEMA_VERSION,
  type ServerMessage,
  SYNC_CLOSE,
} from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { type Connection, type DesignHost, type HostOptions, openHost } from './host.ts'
import { firstSaved } from './journal.ts'
import { type MemoryJournal, memoryJournal, type MemoryRows, memoryRows } from './memory-journal.ts'
import type { Who } from './server.ts'
import { versionText } from './version-text.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
const editor = (member: Member = ANN): Who => ({ member, name: member.userId, access: 'edit' })
const viewer: Who = { member: { userId: 'vic', workspaceId: 'w1' }, name: 'vic', access: 'view' }
/** An agent's tab, working for Ann. */
const agentTab = (agent = 'Claude (agent)'): Who => ({ ...editor(), agent })

const MARK: RestoreMark = { versionId: 'v9', kind: 'named', name: 'Sent', takenAt: '2026-11-16T14:30:00.000Z' }

const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })
const hello = { type: 'hello', protocol: PROTOCOL, token: 't', waiting: 0 }
const changes = (id: number, base: number, list: Change[], restore?: RestoreMark) => ({
  type: 'changes',
  id,
  base,
  kind: 'edit',
  changes: list,
  ...(restore ? { restore } : {}),
})

/** A tab's connection: what it heard, as the wire carries it, and how it was closed. */
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

const rows = (): MemoryRows => memoryRows(firstSaved(linkedDesign() as unknown as DesignRecords, 's0'))

/** A host on `journal`, with the time `clock.now`. */
function hostOn(journal: MemoryJournal, clock = { now: 1000 }, more: Partial<HostOptions> = {}): DesignHost {
  let secrets = 0
  return openHost(journal, {
    hashSecret: (secret) => `hash:${secret}`,
    newSecret: () => `secret${++secrets}`,
    newSyncId: () => 'sync-new',
    now: () => clock.now,
    ...more,
  })
}

/** A host on new rows with Ann's tab joined. */
async function opened(clock = { now: 1000 }) {
  const journal = memoryJournal(rows())
  const host = hostOn(journal, clock)
  const ann = connection()
  host.connect(ann, hello, editor())
  await host.settled()
  return { journal, host, ann }
}

/** Sends a change set from `conn` and waits until it is stored. */
async function send(host: DesignHost, conn: Connection, message: unknown) {
  host.message(conn, message, 100)
  await host.settled()
}

describe('a design host’s versions', () => {
  it('stores a Before restore version of the design as it was, ahead of the restore, keeping the restored one', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Changed')]))
    const before = host.server()?.state().toRecords()

    const release = journal.holdNext()
    host.message(ann, changes(2, 1, [rename('badge', 'Restored')], MARK), 100)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The version write is in flight: the restore's entry waits behind it.
    expect(journal.rows.journal.filter((e) => e.kind === 'accepted')).toHaveLength(1)
    release()
    await host.settled()

    expect(journal.rows.versions).toMatchObject([
      {
        kind: 'beforeRestore',
        name: '',
        savedBy: null,
        syncId: 's0',
        seq: 1,
        keep: 'v9',
        schemaVersion: SCHEMA_VERSION,
      },
    ])
    expect(journal.rows.versions[0]?.records).toEqual(before)
    expect(journal.rows.journal.filter((e) => e.kind === 'accepted')).toHaveLength(2)
    expect(host.changedSince()).toBeUndefined()
  })

  it('stores no restore when its version write fails: the design is dropped and opens again without it', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Changed')]))

    journal.failNext()
    await send(host, ann, changes(2, 1, [rename('badge', 'Restored')], MARK))

    expect(ann.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(journal.rows.versions).toEqual([])
    const again = connection()
    host.connect(again, hello, editor())
    await host.settled()
    expect(host.server()?.state().get('layer', 'badge')?.name).toBe('Changed')
  })

  it('takes no version for a restore of an unchanged design or a rejected one, nor an Autosave as it unloads after a restore', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Restored')], MARK))
    await send(host, ann, changes(2, 9, [rename('badge', 'Never')], MARK))
    expect(journal.rows.versions).toEqual([])

    await send(host, ann, changes(3, 1, [rename('badge', 'Changed')]))
    await send(host, ann, changes(4, 2, [rename('badge', 'Restored again')], MARK))
    expect(journal.rows.versions.map((v) => v.kind)).toEqual(['beforeRestore'])
    host.close(ann)
    expect(await host.unload()).toBe(true)
    expect(journal.rows.versions.map((v) => v.kind)).toEqual(['beforeRestore'])
  })

  it('tells when the design first changed after a version, and takes an Autosave of a changed design only', async () => {
    const clock = { now: 1000 }
    const { journal, host, ann } = await opened(clock)
    expect(host.changedSince()).toBeUndefined()
    host.autosave()
    await host.settled()
    expect(journal.rows.versions).toEqual([])

    clock.now = 2000
    await send(host, ann, changes(1, 0, [rename('badge', 'One')]))
    clock.now = 3000
    await send(host, ann, changes(2, 1, [rename('badge', 'Two')]))
    expect(host.changedSince()).toBe(2000)
    host.autosave()
    await host.settled()

    expect(journal.rows.versions).toMatchObject([{ kind: 'auto', seq: 2, keep: null }])
    expect(journal.rows.versions[0]?.records).toEqual(host.server()?.state().toRecords())
    expect(host.changedSince()).toBeUndefined()
  })

  it('takes an Autosave with the fold of a design that unloads changed; one unchanged folds alone', async () => {
    const changed = await opened()
    await send(changed.host, changed.ann, changes(1, 0, [rename('badge', 'One')]))
    changed.host.close(changed.ann)
    expect(await changed.host.unload()).toBe(true)
    expect(changed.journal.rows.versions).toMatchObject([{ kind: 'auto', seq: 1 }])
    expect(changed.journal.rows.saved).toMatchObject({ seq: 1, versioned: 1 })

    const unchanged = await opened()
    unchanged.host.close(unchanged.ann)
    expect(await unchanged.host.unload()).toBe(true)
    expect(unchanged.journal.rows.versions).toEqual([])
    expect(unchanged.journal.rows.saved.entry).toBe(1)
  })

  it('opens unchanged after a restore and a fold, and takes no Autosave as it unloads again', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Changed')]))
    await send(host, ann, changes(2, 1, [rename('badge', 'Restored')], MARK))
    host.close(ann)
    expect(await host.unload()).toBe(true)
    expect(journal.rows.saved.versioned).toBe(2)

    const reopened = hostOn(journal)
    const bob = connection()
    reopened.connect(bob, hello, editor(BOB))
    await reopened.settled()
    expect(reopened.changedSince()).toBeUndefined()
    reopened.close(bob)
    expect(await reopened.unload()).toBe(true)
    expect(journal.rows.versions.map((v) => v.kind)).toEqual(['beforeRestore'])
  })

  it.each([
    ['its newest version’s sync id and sequence number', 's0', 1, undefined],
    ['a newer sequence number than its newest version', 's0', 0, 5000],
    ['another sync id than its newest version', 'other', 1, 5000],
  ])('opened with %s, counts as changed from when it opened only after it', async (_, syncId, seq, since) => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'One')]))
    host.close(ann)
    await host.unload()
    journal.rows.saved.versioned = 0
    const version = { kind: 'auto' as const, name: '', description: '', savedBy: null, keep: null, schemaVersion: 1 }
    journal.rows.versions.push({ ...version, id: 'v1', syncId, seq, records: journal.rows.saved.state })

    const clock = { now: 5000 }
    const reopened = hostOn(journal, clock)
    reopened.connect(connection(), hello, editor())
    await reopened.settled()
    expect(reopened.changedSince()).toBe(since)
  })

  it('answers a tab’s ask for a version with its records as stored, to that tab alone; none for an unknown id', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Kept')]))
    host.autosave()
    await host.settled()
    const vic = connection()
    host.connect(vic, hello, viewer)
    await host.settled()
    const before = ann.heard.length

    await send(host, vic, { type: 'version', id: 'v1' })
    await send(host, vic, { type: 'version', id: 'nowhere' })

    const stored = journal.rows.versions[0]
    expect(vic.heard.filter((m) => m.type === 'version')).toEqual([
      { type: 'version', id: 'v1', schemaVersion: SCHEMA_VERSION, design: stored?.records },
      { type: 'version', id: 'nowhere', schemaVersion: null, design: null },
    ])
    expect(ann.heard.length).toBe(before)
  })

  it('answers a version asked for before the tab’s welcome went out only after it', async () => {
    const journal = memoryJournal(rows())
    const host = hostOn(journal)
    await host.settled()
    const vic = connection()
    const release = journal.holdNext()
    host.connect(vic, hello, viewer)
    host.message(vic, { type: 'version', id: 'nowhere' }, 30)
    for (let n = 0; n < 5; n++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(vic.heard).toEqual([])

    release()
    await host.settled()

    expect(vic.heard.map((m) => m.type)).toEqual(['welcome', 'version'])
  })

  it('keeps a Before agent version, named by the agent, before the first of a run of agent edits', async () => {
    const { journal, host, ann } = await opened()
    const claude = connection()
    host.connect(claude, hello, agentTab())
    await host.settled()
    const before = host.server()?.state().toRecords()

    await send(host, claude, changes(1, 0, [rename('badge', 'Agent one')]))
    expect(journal.rows.versions).toMatchObject([
      { kind: 'beforeAgent', name: 'Claude (agent)', savedBy: null, syncId: 's0', seq: 0, keep: null },
    ])
    expect(journal.rows.versions[0]?.records).toEqual(before)

    await send(host, claude, changes(2, 1, [rename('badge', 'Agent two')]))
    const other = connection()
    host.connect(other, hello, agentTab('Codex (agent)'))
    await host.settled()
    await send(host, other, changes(1, 2, [rename('badge', 'Other agent')]))
    expect(journal.rows.versions).toHaveLength(1)

    await send(host, ann, changes(1, 3, [rename('badge', 'Ann')]))
    expect(journal.rows.versions).toHaveLength(1)
    const beforeSecond = host.server()?.state().toRecords()
    await send(host, claude, changes(3, 4, [rename('badge', 'Agent again')]))
    expect(journal.rows.versions.map((v) => [v.kind, v.name, v.seq])).toEqual([
      ['beforeAgent', 'Claude (agent)', 0],
      ['beforeAgent', 'Claude (agent)', 4],
    ])
    expect(journal.rows.versions[1]?.records).toEqual(beforeSecond)
  })

  it('keeps no Before agent version for a person’s edits alone', async () => {
    const { journal, host, ann } = await opened()
    const bob = connection()
    host.connect(bob, hello, editor(BOB))
    await host.settled()

    await send(host, ann, changes(1, 0, [rename('badge', 'Ann')]))
    await send(host, bob, changes(1, 1, [rename('badge', 'Bob')]))

    expect(journal.rows.versions).toEqual([])
  })

  it('keeps one Before agent version for an agent’s restore, never dropping the version restored', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Ann')]))
    const claude = connection()
    host.connect(claude, hello, agentTab())
    await host.settled()

    await send(host, claude, changes(1, 1, [rename('badge', 'Restored')], MARK))

    expect(journal.rows.versions).toMatchObject([{ kind: 'beforeAgent', seq: 1, keep: 'v9' }])
  })

  it('keeps no Before agent version for a rejected agent change set, and keeps one for the next accepted', async () => {
    const { journal, host } = await opened()
    const claude = connection()
    host.connect(claude, hello, agentTab())
    await host.settled()

    await send(host, claude, changes(1, 9, [rename('badge', 'Never')]))
    expect(claude.heard.some((m) => m.type === 'reject')).toBe(true)
    expect(journal.rows.versions).toEqual([])

    await send(host, claude, changes(2, 0, [rename('badge', 'Kept')]))
    expect(journal.rows.versions.map((v) => v.kind)).toEqual(['beforeAgent'])
  })

  it('keeps a Before agent version of a design unchanged since its last Autosave', async () => {
    const { journal, host, ann } = await opened()
    await send(host, ann, changes(1, 0, [rename('badge', 'Ann')]))
    host.autosave()
    await host.settled()
    expect(host.changedSince()).toBeUndefined()
    const claude = connection()
    host.connect(claude, hello, agentTab())
    await host.settled()

    await send(host, claude, changes(1, 1, [rename('badge', 'Agent')]))

    expect(journal.rows.versions.map((v) => [v.kind, v.seq])).toEqual([
      ['auto', 1],
      ['beforeAgent', 1],
    ])
  })

  it('counts a design opened with a mark past its sequence number as changed, and keeps it when asked', async () => {
    const journal = memoryJournal(rows())
    journal.rows.saved.versioned = 7
    const host = hostOn(journal)
    host.connect(connection(), hello, editor())
    await host.settled()
    expect(host.changedSince()).toBe(1000)
    host.autosave()
    await host.settled()
    expect(journal.rows.versions).toMatchObject([{ kind: 'auto', seq: 0 }])
    expect(host.changedSince()).toBeUndefined()
  })
})
