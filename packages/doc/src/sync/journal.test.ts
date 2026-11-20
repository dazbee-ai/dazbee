import { describe, expect, it } from 'vitest'

import type { Change, DesignRecords, Entry, Member, NewVersion, Saved } from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import {
  applyChangeSet,
  Fenced,
  firstSaved,
  noteChangeSet,
  replay,
  runWrite,
  type Write,
  WriteQueue,
} from './journal.ts'
import { memoryJournal, memoryRows } from './memory-journal.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }

const design = () => linkedDesign() as unknown as DesignRecords
const saved = (): Saved => firstSaved(design(), 's0')
const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })

function issued(entry: number, tabId = 1, at = 0, dropped: number[] = []): Entry {
  return { entry, kind: 'issued', tabId, member: ANN, secretHash: 'h', at, dropped }
}
const rejected = (entry: number, changeSetId: number, tabId = 1): Entry => ({
  entry,
  kind: 'rejected',
  tabId,
  changeSetId,
})
function accepted(entry: number, seq: number, changes: Change[], changeSetId = seq): Entry {
  return { entry, kind: 'accepted', member: ANN, changeSet: { seq, author: 1, changeSetId, changes }, bytes: 50 }
}

/** Starts the queue's next write, collecting what goes out before it. */
function next(queue: WriteQueue<string>, sent: string[]): Write | undefined {
  return queue.next((out) => sent.push(...out))
}

describe('WriteQueue', () => {
  it('stores everything committed while a write is in flight in one append, and answers once it is stored (I2)', () => {
    const queue = new WriteQueue<string>(0)
    const sent: string[] = []
    queue.commit([issued(1)], ['welcome'])
    expect(next(queue, sent)).toEqual({ type: 'append', entries: [issued(1)], expected: 0 })
    queue.commit([accepted(2, 1, [])], ['one'])
    queue.commit([accepted(3, 2, [])], ['two'])
    expect(next(queue, sent)).toBeUndefined()
    expect(sent).toEqual([])
    expect(queue.stored()).toEqual(['welcome'])
    const grouped = next(queue, sent)
    expect(grouped).toMatchObject({ type: 'append', expected: 1 })
    expect(grouped?.type === 'append' && grouped.entries.map((e) => e.entry)).toEqual([2, 3])
    expect(queue.stored()).toEqual(['one', 'two'])
    expect(queue.busy()).toBe(false)
  })

  it('sends an answer that commits nothing at once, and one that waits behind a write after it', () => {
    const queue = new WriteQueue<string>(0)
    const sent: string[] = []
    queue.commit([], ['left'])
    expect(next(queue, sent)).toBeUndefined()
    expect(sent).toEqual(['left'])
    queue.commit([issued(1)], ['welcome'])
    next(queue, sent)
    queue.commit([], ['preview'])
    expect(next(queue, sent)).toBeUndefined()
    expect(sent).toEqual(['left'])
    sent.push(...queue.stored())
    next(queue, sent)
    expect(sent).toEqual(['left', 'welcome', 'preview'])
  })

  it('folds after the entries before it, naming the last one stored, and appends after the fold', () => {
    const queue = new WriteQueue<string>(4)
    const sent: string[] = []
    queue.commit([issued(5)], [])
    const fold = { ...saved(), entry: 5 }
    queue.fold(fold)
    queue.commit([issued(6, 2)], [])
    expect(next(queue, sent)).toMatchObject({ type: 'append', expected: 4 })
    queue.stored()
    expect(next(queue, sent)).toEqual({ type: 'fold', saved: fold, expected: 5 })
    queue.stored()
    expect(next(queue, sent)).toMatchObject({ type: 'append', expected: 5, entries: [issued(6, 2)] })
  })

  it('numbers on past a buried tail: entry numbers never go back (D8)', () => {
    const queue = new WriteQueue<string>(9)
    const sent: string[] = []
    queue.bury({ ...saved(), entry: 9 }, 4, 'entry 4 no longer applies')
    expect(next(queue, sent)).toMatchObject({ type: 'bury', expected: 9, from: 4, reason: 'entry 4 no longer applies' })
    queue.stored()
    queue.commit([issued(10)], [])
    expect(next(queue, sent)).toMatchObject({ type: 'append', expected: 9 })
  })

  it('stores a version after what was committed before it, naming no fence, and what is committed after it next', async () => {
    const queue = new WriteQueue<string>(0)
    const sent: string[] = []
    const version: NewVersion = {
      kind: 'beforeRestore',
      name: '',
      description: '',
      savedBy: null,
      syncId: 's0',
      seq: 1,
      schemaVersion: 1,
      records: design(),
      keep: 'v1',
    }
    queue.commit([issued(1)], ['before'])
    queue.version(version)
    queue.commit([accepted(2, 1, [])], ['after'])
    const types: string[] = []
    const journal = memoryJournal(memoryRows(saved()))
    for (let write = next(queue, sent); write; write = next(queue, sent)) {
      types.push(write.type)
      await runWrite(journal, write)
      sent.push(...queue.stored())
    }
    expect([types, sent]).toEqual([
      ['append', 'version', 'append'],
      ['before', 'after'],
    ])
    expect(journal.rows.versions).toEqual([{ ...version, id: 'v1' }])
    expect(journal.rows.lastEntry).toBe(2)
  })

  it('writes nothing after a failed write, and sends none of the answers waiting', () => {
    const queue = new WriteQueue<string>(0)
    const sent: string[] = []
    queue.commit([issued(1)], ['welcome'])
    next(queue, sent)
    queue.commit([issued(2, 2)], ['joined'])
    queue.failed()
    expect(queue.busy()).toBe(false)
    expect(queue.stored()).toEqual([])
    expect(next(queue, sent)).toBeUndefined()
    expect(sent).toEqual([])
  })
})

describe('memoryJournal', () => {
  it('stores appends and folds under the fence, and loads what it stored', async () => {
    const journal = memoryJournal(memoryRows(saved()))
    await runWrite(journal, { type: 'append', entries: [issued(1), issued(2, 2)], expected: 0 })
    const loaded = await journal.load()
    expect([loaded.lastEntry, loaded.journal.map((e) => e.entry)]).toEqual([2, [1, 2]])
    await journal.fold({ ...loaded.saved, entry: 2 }, 2)
    expect(await journal.load()).toMatchObject({ lastEntry: 2, journal: [], saved: { entry: 2 } })
    expect(journal.writes()).toBe(2)
  })

  it('fails the write of a second writer that loaded before the first stored, before and after a fold', async () => {
    const rows = memoryRows(saved())
    const first = memoryJournal(rows)
    const second = memoryJournal(rows)
    await first.append([issued(1)], 0)
    await expect(second.append([issued(1, 2)], 0)).rejects.toBeInstanceOf(Fenced)
    await first.fold({ ...saved(), entry: 1 }, 1)
    // The fold leaves the fence where it was: a writer that loaded before it still fails after it.
    await expect(second.append([issued(1, 2)], 0)).rejects.toBeInstanceOf(Fenced)
    await expect(second.fold({ ...saved(), entry: 0 }, 0)).rejects.toBeInstanceOf(Fenced)
    expect(rows.journal).toEqual([])
    expect(rows.lastEntry).toBe(1)
  })

  it('moves the entries from the first dead one to the dead letters, keeping the fence where it was', async () => {
    const rows = memoryRows(saved())
    const journal = memoryJournal(rows)
    const second = memoryJournal(rows)
    await journal.append([issued(1), accepted(2, 1, []), accepted(3, 2, [])], 0)
    await journal.bury({ ...saved(), syncId: 's1', entry: 3 }, 3, 2, 'entry 2 no longer applies')
    expect(rows.dead.map((d) => [d.entry.entry, d.reason])).toEqual([
      [2, 'entry 2 no longer applies'],
      [3, 'entry 2 no longer applies'],
    ])
    expect([rows.lastEntry, rows.journal, rows.saved.syncId]).toEqual([3, [], 's1'])
    // A writer that loaded before the dead entries were stored still fails after the bury.
    await expect(second.append([issued(2, 2)], 1)).rejects.toBeInstanceOf(Fenced)
    await journal.append([issued(4, 2)], 3)
    expect(rows.lastEntry).toBe(4)
  })

  it('fails a planted write with nothing stored, and holds one until released', async () => {
    const rows = memoryRows(saved())
    const journal = memoryJournal(rows)
    journal.failNext()
    await expect(journal.append([issued(1)], 0)).rejects.toThrow('planted')
    expect(rows.journal).toEqual([])
    const release = journal.holdNext()
    let done = false
    const held = journal.append([issued(1)], 0).then(() => (done = true))
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await held
    expect(rows.lastEntry).toBe(1)
  })
})

describe('applyChangeSet', () => {
  it('applies on an overlay, leaving the state as it was, or gives why not', () => {
    const state = replay({ saved: saved(), journal: [], lastEntry: 0 }).state
    const applied = applyChangeSet(state, [rename('badge', 'B')])
    expect('after' in applied && applied.after.get('layer', 'badge')?.name).toBe('B')
    expect(state.get('layer', 'badge')?.name).not.toBe('B')
    expect(applyChangeSet(state, [rename('nope', 'B')])).toMatchObject({ reason: 'cannotApply' })
  })
})

describe('noteChangeSet', () => {
  it('keeps the latest change set id, and at most 1,024 rejected ids', () => {
    const tab = { member: ANN, secretHash: 'h', lastChangeSet: 0, rejected: [], lastSeen: 0 }
    for (let id = 1; id <= 1030; id++) noteChangeSet(tab, id, true)
    noteChangeSet(tab, 3, false)
    expect([tab.lastChangeSet, tab.rejected.length, tab.rejected[0]]).toEqual([1030, 1024, 7])
    // A server opened with a lower limit keeps fewer.
    noteChangeSet(tab, 1031, true, 2)
    expect(tab.rejected).toEqual([1030, 1031])
  })
})

describe('replay', () => {
  it('applies the journal to the folded state: tab ids, rejected ids and change sets', () => {
    const journal = [
      issued(1),
      accepted(2, 1, [rename('badge', 'One')]),
      rejected(3, 2),
      accepted(4, 2, [rename('title', 'T')], 3),
    ]
    const replayed = replay({ saved: saved(), journal, lastEntry: 4 })
    expect([replayed.entry, replayed.seq, replayed.nextTabId, replayed.dead]).toEqual([4, 2, 2, undefined])
    expect(replayed.state.get('layer', 'badge')?.name).toBe('One')
    expect(replayed.tabs.get(1)).toMatchObject({ lastChangeSet: 3, rejected: [2] })
    expect(replayed.accepted.map((a) => a.changeSet.seq)).toEqual([1, 2])
  })

  it('replays a stored entry that sets a layer’s bindings whole, and the entries after it', () => {
    const bindings = (to?: object): Change => ({
      op: 'set',
      value: { part: 'layer', id: 'bg', key: 'bindings' },
      ...(to ? { to } : {}),
    })
    const fill = (to: string): Change => ({
      op: 'set',
      value: { part: 'layer', id: 'bg', key: 'bindings', prop: 'fill' },
      to,
    })
    const journal = [
      issued(1),
      accepted(2, 1, [bindings({ fill: 'brand:primary' })]),
      accepted(3, 2, [fill('brand:accent'), rename('bg', 'Back')]),
    ]
    const replayed = replay({ saved: saved(), journal, lastEntry: 3 })
    expect([replayed.entry, replayed.seq, replayed.dead]).toEqual([3, 2, undefined])
    expect(replayed.state.get('layer', 'bg')).toMatchObject({ name: 'Back', bindings: { fill: 'brand:accent' } })
    const unbound = replay({ saved: saved(), journal: [...journal, accepted(4, 3, [bindings()])], lastEntry: 4 })
    expect([unbound.entry, unbound.dead]).toEqual([4, undefined])
    expect(Object.hasOwn(unbound.state.get('layer', 'bg') as object, 'bindings')).toBe(false)
  })

  it('keeps when each tab id was given out, and drops the ones its entry dropped', () => {
    const replayed = replay({ saved: saved(), journal: [issued(1, 1, 100), issued(2, 2, 200, [1])], lastEntry: 2 })
    expect([...replayed.tabs]).toEqual([
      [2, { member: ANN, secretHash: 'h', lastChangeSet: 0, rejected: [], lastSeen: 200 }],
    ])
  })

  it('gives out no tab id a dead entry gave', () => {
    const journal = [accepted(1, 1, [rename('gone', 'X')]), issued(2, 7)]
    expect(replay({ saved: saved(), journal, lastEntry: 2 }).nextTabId).toBe(8)
  })

  it('stops at the first entry that no longer applies, with it and every one after it dead (C43)', () => {
    const journal = [
      issued(1),
      accepted(2, 1, [rename('badge', 'One')]),
      accepted(3, 2, [rename('gone', 'X')]),
      issued(4, 2),
    ]
    const replayed = replay({ saved: saved(), journal, lastEntry: 4 })
    expect([replayed.entry, replayed.seq, replayed.nextTabId]).toEqual([2, 1, 3])
    expect(replayed.dead?.entries.map((e) => e.entry)).toEqual([3, 4])
    expect(replayed.dead?.reason).toMatch(/^entry 3 no longer applies: /)
  })

  it.each<[string, Entry[], RegExp]>([
    ['a gap in the entries', [issued(1), issued(3)], /^entry 3 no longer applies: it follows entry 1$/],
    [
      'a gap in the sequence numbers',
      [accepted(1, 2, [])],
      /^entry 1 no longer applies: change set 2 does not follow 0$/,
    ],
  ])('stops at %s', (_, journal, reason) => {
    expect(replay({ saved: saved(), journal, lastEntry: 3 }).dead?.reason).toMatch(reason)
  })

  it('checks a change set as a live one is, but for role and size', () => {
    const cycle: Change = { op: 'set', value: { part: 'layer', id: 'grp', key: 'parentId' }, to: 'title' }
    expect(replay({ saved: saved(), journal: [accepted(1, 1, [cycle])], lastEntry: 1 }).dead?.entries).toHaveLength(1)
  })
})
