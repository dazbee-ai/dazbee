import { describe, expect, it } from 'vitest'

import {
  type Change,
  type DesignRecords,
  PROTOCOL,
  type RestoreMark,
  type ServerMessage,
  SYNC_CLOSE,
  SYNC_LIMITS,
} from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { firstSaved } from './journal.ts'
import { openServer } from './server.ts'
import {
  ANN,
  BOB,
  changes,
  editor,
  fresh,
  hello,
  joined,
  nameOf,
  parentOf,
  restart,
  send,
  set,
  testOptions,
  to,
  viewer,
} from './test-server.ts'

const MARK: RestoreMark = { versionId: 'v1', kind: 'named', name: 'Sent', takenAt: '2026-11-16T14:30:00.000Z' }

describe('openServer', () => {
  describe('accepting', () => {
    it('accepts a change set and tells every tab, the author included, with the next sequence number', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const out = server.receive(a.tabId, changes(1, 0, [set(nameOf('badge'), 'Badge')]), 100)
      expect(to(a.tabId, out)).toMatchObject([{ type: 'accepted', seq: 1, author: a.tabId, changeSetId: 1 }])
      expect(to(b.tabId, out)).toMatchObject([{ type: 'accepted', seq: 1 }])
      expect(server.state().get('layer', 'badge')?.name).toBe('Badge')
    })

    it('ignores a change set it took in already (FigCraft: a duplicate)', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      send(server, a.tabId, 1, [set(nameOf('badge'), 'One')])
      expect(send(server, a.tabId, 1, [set(nameOf('badge'), 'Two')])).toEqual([])
      expect(server.seq()).toBe(1)
      expect(server.state().get('layer', 'badge')?.name).toBe('One')
    })

    it.each<[string, Change[], string]>([
      [
        'a value the schema does not take',
        [set({ part: 'layer', id: 'badge', key: 'props', prop: 'x' }, 'left')],
        'invalidRecord',
      ],
      ['a cycle', [set(parentOf('grp'), 'title')], 'structure'],
      [
        'deleting the last page',
        [
          { op: 'delete', part: 'page', id: 'p1' },
          { op: 'delete', part: 'page', id: 'p2' },
        ],
        'structure',
      ],
      ['a shared link in a frame', [set({ part: 'layer', id: 'badge', key: 'link' }, 'bg')], 'structure'],
      ['a write to a layer type', [set({ part: 'layer', id: 'badge', key: 'type' }, 'text')], 'cannotApply'],
      ['a write to the design id', [set({ part: 'meta', id: 'meta', key: 'designId' }, 'd2')], 'cannotApply'],
      ['a `__proto__` key', [set({ part: 'layer', id: 'badge', key: '__proto__' }, {})], 'cannotApply'],
    ])('rejects %s whole, to its author only, and stays connected (FigCraft)', (_, list, reason) => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const before = JSON.stringify(server.state().toRecords())
      const out = server.receive(a.tabId, changes(1, 0, [set(nameOf('title'), 'T'), ...list]), 100)
      expect(to(a.tabId, out)).toEqual([{ type: 'reject', changeSetId: 1, reason }])
      expect(to(b.tabId, out)).toEqual([{ type: 'preview', tabId: a.tabId, after: 1, changes: [] }])
      expect(JSON.stringify(server.state().toRecords())).toBe(before)
      expect(server.seq()).toBe(0)
      // The tab goes on: its next change set is taken in.
      expect(send(server, a.tabId, 2, [set(nameOf('title'), 'T')])).toMatchObject([{ type: 'accepted', seq: 1 }])
    })

    it('tells every tab but its author who restored which version, once the restore is accepted; a rejected one, no one', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const restore = { ...changes(1, 0, [set(nameOf('badge'), 'Old')]), restore: MARK }
      const out = server.receive(a.tabId, restore, 100)
      expect(to(b.tabId, out)).toMatchObject([
        { type: 'accepted', seq: 1 },
        { type: 'restored', tabId: a.tabId, by: 'ann', mark: MARK },
      ])
      expect(to(a.tabId, out)).toMatchObject([{ type: 'accepted', seq: 1 }])
      const rejected = server.receive(a.tabId, { ...changes(2, 9, []), restore: MARK }, 100)
      expect(to(b.tabId, rejected).map((message) => message.type)).toEqual(['preview'])
    })

    it('rejects a base in the future, and a change set of a member who may only view', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      expect(to(a.tabId, server.receive(a.tabId, changes(1, 5, [set(nameOf('badge'), 'B')]), 100))).toEqual([
        { type: 'reject', changeSetId: 1, reason: 'baseInFuture' },
      ])
      const v = joined(server, viewer())
      expect(send(server, v.tabId, 1, [set(nameOf('badge'), 'B')])).toEqual([
        { type: 'reject', changeSetId: 1, reason: 'viewOnly' },
      ])
      // A viewer's preview goes nowhere.
      expect(server.receive(v.tabId, { type: 'preview', after: 1, changes: [] }, 10)).toEqual([])
    })

    it('accepts what the tab sent as it sent it, and makes no value of its own (I7)', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const list: Change[] = [
        {
          op: 'create',
          part: 'layer',
          id: 'g2',
          record: {
            type: 'group',
            parentId: 'sq',
            link: 'g2',
            index: 'a5',
            name: 'G',
            props: { x: 0, y: 0, width: 1, height: 1 },
          },
        },
        set(parentOf('badge'), 'g2'),
      ]
      const [accepted] = send(server, a.tabId, 1, list) as [Extract<ServerMessage, { type: 'accepted' }>]
      expect(accepted.changes).toEqual(list)
      // The record holds what was sent and nothing the schema would default.
      expect(server.state().get('layer', 'g2')).toEqual(list[0]?.op === 'create' ? list[0].record : undefined)
    })

    it('keeps a design under its limits, but takes a change set that does not grow a design past one (D11)', () => {
      const clock = { now: 1000 }
      const server = openServer(fresh(), { ...testOptions(clock), limits: { designLayers: 15 } })
      const a = joined(server)
      const group = (id: string) => ({
        op: 'create' as const,
        part: 'layer' as const,
        id,
        record: {
          type: 'group',
          parentId: 'other',
          link: id,
          index: 'a5',
          name: 'G',
          props: { x: 0, y: 0, width: 1, height: 1 },
        },
      })
      // The linked design holds 14 layers: one more fits, a second doesn't.
      expect(send(server, a.tabId, 1, [group('n1')])).toMatchObject([{ type: 'accepted' }])
      expect(send(server, a.tabId, 2, [group('n2')])).toEqual([
        { type: 'reject', changeSetId: 2, reason: 'designTooBig' },
      ])
      // A full design (here, past a lowered limit) is still edited, and edited back under it.
      const lowered = restart(server, testOptions(clock), undefined)
      const b = joined(lowered)
      expect(lowered.size().layers).toBe(15)
      const smaller = openServer(
        { saved: lowered.save(), journal: [], lastEntry: lowered.save().entry },
        { ...testOptions(clock), limits: { designLayers: 10 } },
      )
      const c = joined(smaller)
      expect(send(smaller, c.tabId, 1, [set(nameOf('badge'), 'B')])).toMatchObject([{ type: 'accepted' }])
      expect(send(smaller, c.tabId, 2, [{ op: 'delete', part: 'layer', id: 'n1' }])).toMatchObject([
        { type: 'accepted' },
      ])
      expect(send(smaller, c.tabId, 3, [group('n3')])).toEqual([
        { type: 'reject', changeSetId: 3, reason: 'designTooBig' },
      ])
      expect(b.tabId).toBeGreaterThan(0)
    })

    it('warns every tab once a design passes 80% of a limit', () => {
      const server = openServer(fresh(), { ...testOptions(), limits: { designLayers: 18 } })
      const a = joined(server)
      const group = (id: string): Change => ({
        op: 'create',
        part: 'layer',
        id,
        record: {
          type: 'group',
          parentId: 'other',
          link: id,
          index: 'a5',
          name: 'G',
          props: { x: 0, y: 0, width: 1, height: 1 },
        },
      })
      // 14 layers; 80% of 18 is 14.4.
      const out = send(server, a.tabId, 1, [group('n1')])
      expect(out.map((m) => m.type)).toEqual(['accepted', 'notice'])
      expect(send(server, a.tabId, 2, [group('n2')]).map((m) => m.type)).toEqual(['accepted'])
    })
  })

  describe('the limits of sections and connectors', () => {
    const made = (part: 'section' | 'connector', from: number, count: number): Change[] =>
      Array.from({ length: count }, (_, i) => ({
        op: 'create',
        part,
        id: `${part}-${from + i}`,
        record:
          part === 'section'
            ? { pageId: 'p1', title: 'S', order: 'a0' }
            : { pageId: 'p1', from: 'sq', to: 'story', order: 'a0' },
      }))

    it.each([
      ['section', SYNC_LIMITS.designSections, 'sections'],
      ['connector', SYNC_LIMITS.designConnectors, 'connectors'],
    ] as const)('warns at 80%% of the %s limit, and refuses the one past it', (part, limit, key) => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const warnAt = limit * SYNC_LIMITS.warnAt
      expect(send(server, a.tabId, 1, made(part, 0, warnAt - 1)).map((m) => m.type)).toEqual(['accepted'])
      const warned = send(server, a.tabId, 2, made(part, warnAt - 1, 1))
      expect(warned.map((m) => m.type)).toEqual(['accepted', 'notice'])
      expect(warned[1]).toMatchObject({ type: 'notice', kind: 'nearLimit', size: { [key]: warnAt } })
      expect(send(server, a.tabId, 3, made(part, warnAt, limit - warnAt)).map((m) => m.type)).toEqual(['accepted'])
      expect(server.size()[key]).toBe(limit)
      expect(send(server, a.tabId, 4, made(part, limit, 1))).toEqual([
        { type: 'reject', changeSetId: 4, reason: 'designTooBig' },
      ])
    })
  })

  describe('sizes', () => {
    it('rejects a change set whose message is over the limit, and drops a preview over its own', () => {
      const server = openServer(fresh(), { ...testOptions(), limits: { messageBytes: 200, previewBytes: 50 } })
      const a = joined(server)
      const b = joined(server, editor(BOB))
      expect(to(a.tabId, server.receive(a.tabId, changes(1, 0, [set(nameOf('badge'), 'B')]), 201))).toEqual([
        { type: 'reject', changeSetId: 1, reason: 'tooManyChanges' },
      ])
      expect(to(a.tabId, server.receive(a.tabId, changes(2, 0, [set(nameOf('badge'), 'B')]), 200))).toMatchObject([
        { type: 'accepted' },
      ])
      const preview = { type: 'preview', after: 2, changes: [] }
      expect(to(b.tabId, server.receive(a.tabId, preview, 51))).toEqual([])
      expect(to(b.tabId, server.receive(a.tabId, preview, 50))).toEqual([
        { type: 'preview', tabId: a.tabId, after: 2, changes: [] },
      ])
    })
  })

  describe('undo and redo across tabs (C46)', () => {
    /** Tab A made group g2 holding the badge; tab B then moved the title into it. */
    function crossed() {
      const clock = { now: 1000 }
      const server = openServer(fresh(), testOptions(clock))
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const g2 = {
        type: 'group',
        parentId: 'sq',
        link: 'g2',
        index: 'a5',
        name: 'G',
        props: { x: 0, y: 0, width: 1, height: 1 },
      }
      send(server, a.tabId, 1, [{ op: 'create', part: 'layer', id: 'g2', record: g2 }, set(parentOf('badge'), 'g2')])
      send(server, b.tabId, 1, [set(parentOf('price'), 'g2')])
      return { server, a, b, clock }
    }
    /** Tab A's undo of making g2, made on the design it knew (base 1). */
    const undoMake = (): Change[] => [set(parentOf('badge'), 'sq'), { op: 'delete', part: 'layer', id: 'g2' }]

    it('rejects an undo whose delete would take what another tab placed after its base', () => {
      const { server, a } = crossed()
      const out = to(a.tabId, server.receive(a.tabId, changes(2, 1, undoMake(), 'undo'), 100))
      expect(out).toEqual([{ type: 'reject', changeSetId: 2, reason: 'placedSince' }])
      expect(server.state().get('layer', 'price')?.parentId).toBe('g2')
    })

    it('rejects an undo deleting by name a layer another tab brought back after its base', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const record = { ...(server.state().get('layer', 'badge') as Record<string, unknown>) }
      send(server, b.tabId, 1, [{ op: 'delete', part: 'layer', id: 'badge' }])
      // B's undo brings the badge back at 2; A's undo, made on base 0, deletes it again by name.
      send(server, b.tabId, 2, [{ op: 'create', part: 'layer', id: 'badge', record }], 'undo')
      expect(server.seq()).toBe(2)
      const out = to(
        a.tabId,
        server.receive(a.tabId, changes(1, 0, [{ op: 'delete', part: 'layer', id: 'badge' }], 'undo'), 100),
      )
      expect(out).toEqual([{ type: 'reject', changeSetId: 1, reason: 'placedSince' }])
    })

    it('takes an undo deleting what its own tab placed after its base', () => {
      const { server, b } = crossed()
      // B's undo, on base 1, deletes g2 with the title B moved into it at 2, and the badge A placed at 1.
      const out = to(
        b.tabId,
        server.receive(b.tabId, changes(2, 1, [{ op: 'delete', part: 'layer', id: 'g2' }], 'undo'), 100),
      )
      expect(out).toMatchObject([{ type: 'accepted', seq: 3 }])
    })

    it('takes the same delete as an edit, and as an undo made on a base that saw the move', () => {
      const edit = crossed()
      expect(to(edit.a.tabId, edit.server.receive(edit.a.tabId, changes(2, 1, undoMake(), 'edit'), 100))).toMatchObject(
        [{ type: 'accepted' }],
      )
      const seen = crossed()
      expect(to(seen.a.tabId, seen.server.receive(seen.a.tabId, changes(2, 2, undoMake(), 'undo'), 100))).toMatchObject(
        [{ type: 'accepted' }],
      )
    })

    it('still rejects it after a fold and a restart: placements are saved', () => {
      const { server, a, clock } = crossed()
      const saved = server.save()
      server.takeJournal()
      const reopened = openServer({ saved, journal: [], lastEntry: saved.entry }, testOptions(clock))
      const back = joined(reopened, editor(ANN), {
        syncId: saved.syncId,
        tabId: a.tabId,
        seq: 2,
        secret: a.welcome.secret,
      })
      expect(back.tabId).toBe(a.tabId)
      expect(to(a.tabId, reopened.receive(a.tabId, changes(2, 1, undoMake(), 'undo'), 100))).toEqual([
        { type: 'reject', changeSetId: 2, reason: 'placedSince' },
      ])
      // And after a restart that replays the journal instead.
      const { server: again, a: a2 } = crossed()
      const replayed = restart(again, testOptions(clock), firstSaved(linkedDesign() as unknown as DesignRecords, 's0'))
      joined(replayed, editor(ANN), { syncId: 's0', tabId: a2.tabId, seq: 2, secret: a2.welcome.secret })
      expect(to(a2.tabId, replayed.receive(a2.tabId, changes(2, 1, undoMake(), 'undo'), 100))).toEqual([
        { type: 'reject', changeSetId: 2, reason: 'placedSince' },
      ])
    })
  })

  describe('joining', () => {
    it('welcomes a new tab with the whole design, and tells the others it joined', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      expect(a.welcome).toMatchObject({
        type: 'welcome',
        syncId: 's0',
        tabId: 1,
        seq: 0,
        secret: 'secret1',
        access: 'edit',
        tabs: {},
      })
      expect('design' in a.welcome.catchUp).toBe(true)
      const b = joined(server, editor(BOB))
      expect(b.welcome.tabs).toEqual({ [a.tabId]: 'ann' })
      expect(to(a.tabId, b.out)).toEqual([{ type: 'joined', tabId: b.tabId, name: 'bob' }])
      expect(to(b.tabId, server.leave(a.tabId))).toEqual([{ type: 'left', tabId: a.tabId }])
      expect(server.leave(b.tabId)).toEqual([{ to: 'all', except: b.tabId, message: { type: 'left', tabId: b.tabId } }])
    })

    it('resumes a tab id with its secret, for its member, with the change sets it missed', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      send(server, a.tabId, 1, [set(nameOf('badge'), 'One')])
      server.leave(a.tabId)
      const b = joined(server, editor(BOB))
      send(server, b.tabId, 1, [set(nameOf('badge'), 'Two')])
      const back = joined(server, editor(ANN), { syncId: 's0', tabId: a.tabId, seq: 1, secret: a.welcome.secret }, 3)
      expect(back.tabId).toBe(a.tabId)
      expect(back.welcome.processed).toEqual({ lastChangeSet: 1, rejected: [] })
      expect(back.welcome.catchUp).toMatchObject({ changeSets: [{ seq: 2, author: b.tabId }] })
    })

    it('joins as a new tab a resume by another member, with another secret, or under another sync id (C44, I12)', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      server.leave(a.tabId)
      const resume = { syncId: 's0', tabId: a.tabId, seq: 0, secret: a.welcome.secret }
      expect(joined(server, editor(BOB), resume).tabId).not.toBe(a.tabId)
      expect(joined(server, editor(ANN), { ...resume, secret: 'guess' }).tabId).not.toBe(a.tabId)
      expect(joined(server, editor(ANN), { ...resume, syncId: 'old' }).tabId).not.toBe(a.tabId)
      expect(joined(server, editor(ANN), resume).tabId).toBe(a.tabId)
    })

    it('sends the whole design when the missed change sets times those waiting pass the limit, or the log lost some', () => {
      const server = openServer(fresh(), { ...testOptions(), limits: { catchUpWork: 10, logChangeSets: 4 } })
      const a = joined(server)
      for (let i = 1; i <= 3; i++) send(server, a.tabId, i, [set(nameOf('badge'), `B${i}`)])
      const resume = (seq: number) => ({ syncId: 's0', tabId: a.tabId, seq, secret: a.welcome.secret })
      expect(joined(server, editor(), resume(0), 3).welcome.catchUp).toMatchObject({ changeSets: [{}, {}, {}] })
      expect('design' in joined(server, editor(), resume(0), 4).welcome.catchUp).toBe(true)
      for (let i = 4; i <= 6; i++) send(server, a.tabId, i, [set(nameOf('badge'), `B${i}`)])
      expect(server.log().changeSets).toBe(4)
      expect('design' in joined(server, editor(), resume(1), 0).welcome.catchUp).toBe(true)
      expect(joined(server, editor(), resume(2), 0).welcome.catchUp).toMatchObject({ changeSets: [{}, {}, {}, {}] })
    })

    it('keeps at most so many tab ids, dropping the one not connected for longest', () => {
      const clock = { now: 1000 }
      const server = openServer(fresh(), { ...testOptions(clock), limits: { tabIds: 2 } })
      const a = joined(server)
      clock.now = 2000
      const b = joined(server)
      server.leave(b.tabId)
      clock.now = 3000
      server.leave(a.tabId)
      clock.now = 4000
      joined(server)
      expect(Object.keys(server.save().tabs).map(Number)).toEqual([a.tabId, 3])
    })

    it('never drops a connected tab id to keep under the limit', () => {
      const server = openServer(fresh(), { ...testOptions(), limits: { tabIds: 2 } })
      joined(server)
      joined(server)
      joined(server)
      expect(Object.keys(server.save().tabs).map(Number)).toEqual([1, 2, 3])
    })

    it('drops every tab id not connected for 30 days first, and a restart keeps the drops and when each tab was seen', () => {
      const clock = { now: 1000 }
      const options = () => ({ ...testOptions(clock), limits: { tabIds: 3, tabIdleMs: 1000 } })
      const server = openServer(fresh(), options())
      for (const at of [1000, 1500, 4500]) {
        clock.now = at
        server.leave(joined(server).tabId)
      }
      clock.now = 5000
      // Over the limit by one, but tabs 1 and 2 have not connected for 1,000 ms: both go.
      const d = joined(server)
      const tabs = server.save().tabs
      expect(Object.keys(tabs).map(Number)).toEqual([3, d.tabId])
      const replayed = restart(server, options(), firstSaved(linkedDesign() as unknown as DesignRecords, 's0'))
      expect(replayed.save().tabs).toEqual(tabs)
    })

    it('sends the whole design to a resume from a sequence number the design has not reached', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      send(server, a.tabId, 1, [set(nameOf('badge'), 'B')])
      const back = joined(server, editor(), { syncId: 's0', tabId: a.tabId, seq: 2, secret: a.welcome.secret })
      expect(back.tabId).toBe(a.tabId)
      expect('design' in back.welcome.catchUp).toBe(true)
    })

    it('drops the oldest change sets from the catch-up log past its bytes', () => {
      const server = openServer(fresh(), { ...testOptions(), limits: { logBytes: 250 } })
      const a = joined(server)
      for (let i = 1; i <= 3; i++) send(server, a.tabId, i, [set(nameOf('badge'), `B${i}`)])
      expect(server.log()).toEqual({ changeSets: 2, bytes: 200 })
    })

    it('tells no one a tab joined again when it connects again before its old connection closed', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const again = joined(server, editor(), { syncId: 's0', tabId: a.tabId, seq: 0, secret: a.welcome.secret })
      expect(again.tabId).toBe(a.tabId)
      expect(to(b.tabId, again.out)).toEqual([])
    })

    it('remembers at most 1,024 rejected change set ids per tab', () => {
      const server = openServer(fresh(), testOptions())
      const v = joined(server, viewer())
      for (let id = 1; id <= 1030; id++) send(server, v.tabId, id, [set(nameOf('badge'), 'B')])
      const rejected = server.save().tabs[v.tabId]?.rejected ?? []
      expect([rejected.length, rejected[0], rejected.at(-1)]).toEqual([1024, 7, 1030])
    })

    it('closes a connection for a message it does not read: no hello first, a malformed one, another protocol', () => {
      const server = openServer(fresh(), testOptions())
      const closed = { close: SYNC_CLOSE.protocol }
      expect(server.join({ type: 'ping' }, editor())).toMatchObject(closed)
      expect(server.join({ ...hello(), protocol: PROTOCOL + 1 }, editor())).toMatchObject(closed)
      expect(server.receive(9, { type: 'ping' }, 10)).toMatchObject(closed)
      const a = joined(server)
      expect(server.receive(a.tabId, { type: 'changes', id: 1 }, 10)).toMatchObject(closed)
      expect(server.receive(a.tabId, hello(), 10)).toMatchObject(closed)
      expect(server.receive(a.tabId, { type: 'ping' }, 10)).toEqual([{ to: a.tabId, message: { type: 'pong' } }])
    })
  })

  describe('opening', () => {
    it('opens a restarted design as it was, and every tab resumes', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      const b = joined(server, editor(BOB))
      send(server, a.tabId, 1, [set(nameOf('badge'), 'One')])
      send(server, b.tabId, 1, [set(nameOf('title'), 'Two')])
      const records = JSON.stringify(server.state().toRecords())
      const reopened = restart(server, testOptions(), firstSaved(linkedDesign() as unknown as DesignRecords, 's0'))
      expect([reopened.seq(), JSON.stringify(reopened.state().toRecords())]).toEqual([2, records])
      expect(reopened.log().changeSets).toBe(2)
      for (const [tab, member] of [
        [a, ANN],
        [b, BOB],
      ] as const) {
        const back = joined(reopened, editor(member), {
          syncId: 's0',
          tabId: tab.tabId,
          seq: 2,
          secret: tab.welcome.secret,
        })
        expect(back.tabId).toBe(tab.tabId)
      }
    })

    it('opens at the last entry that applies, under a new sync id, with the rest dead (C43)', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      send(server, a.tabId, 1, [set(nameOf('badge'), 'One')])
      send(server, a.tabId, 2, [set(nameOf('title'), 'Two')])
      joined(server, editor(BOB))
      const journal = server.takeJournal()
      // The second change set no longer applies: its layer is gone from the stored state.
      const stored = firstSaved(linkedDesign() as unknown as DesignRecords, 's0')
      delete (stored.state.nodes as Record<string, unknown>).title
      const lines: string[] = []
      const reopened = openServer(
        { saved: stored, journal, lastEntry: 4 },
        { ...testOptions(), log: (l) => lines.push(l) },
      )
      expect(reopened.syncId()).toBe('sync1')
      expect(reopened.seq()).toBe(1)
      expect(reopened.dead?.entries.map((e) => e.entry)).toEqual([3, 4])
      expect(lines[0]).toMatch(
        /^entry 3 no longer applies: .*title.* 2 entries to the dead letters, new sync id sync1$/,
      )
      // Entry numbers and tab ids go on past the dead ones: none is given out twice (D8).
      expect(reopened.save()).toMatchObject({ entry: 4, nextTabId: 3 })
      // A tab that comes back joins as new.
      expect(joined(reopened, editor(), { syncId: 's0', tabId: a.tabId, seq: 2, secret: a.welcome.secret }).tabId).toBe(
        3,
      )
      expect(reopened.takeJournal().map((e) => e.entry)).toEqual([5])
    })
  })
})
