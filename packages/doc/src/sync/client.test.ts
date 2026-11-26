// A tab's side of the session: steps open while others' change sets arrive, what the working design
// tells, reloads, and coming back after a dropped connection (FigCraft's reconnect_tests.rs).
import { describe, expect, it } from 'vitest'

import type { Change, DesignRecords, Member, RestoreMark, ServerMessage, Target } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { linkedDesign, testDesign } from '../test-design.ts'
import { holdOf } from '../test-holds.ts'
import type { RecordKey } from './changes.ts'
import { type Client, openClient, type SavedClient, SyncBroken } from './client.ts'
import { firstSaved } from './journal.ts'
import { openServer, type Server } from './server.ts'
import {
  comeBack,
  down,
  edit,
  exchange,
  joinClient,
  testServer,
  testServerOptions,
  up,
  who,
  wire,
} from './test-session.ts'

const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
const MARK: RestoreMark = { versionId: 'v1', kind: 'named', name: 'Sent', takenAt: '2026-11-16T14:30:00.000Z' }

const name = (part: 'page' | 'frame' | 'layer', id: string): Target => ({ part, id, key: 'name' })
const prop = (id: string, key: string): Target => ({ part: 'layer', id, key: 'props', prop: key })
const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })

/** Whether the tab's working and confirmed designs both hold the server's design. */
const inStep = (c: Client, server: Server) =>
  sameValue(c.working().toRecords(), server.state().toRecords()) &&
  sameValue(c.confirmed().toRecords(), server.state().toRecords())

/** What a tab keeps, as it comes back after a trip through storage. */
const copyOf = (c: Client) => wire(c.save()) as SavedClient

describe('openClient', () => {
  describe('steps', () => {
    it('keeps a step open while others’ change sets arrive under it, and sends only what the step wrote (C30)', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      a.open()
      a.write(set(prop('box', 'x'), 10))
      // b renames the box and moves it down while a's step is open.
      const outB = up(server, b, edit(b, 'edit', set(name('layer', 'box'), 'Theirs'), set(prop('box', 'y'), 300)))
      down(b, outB)
      down(a, outB)
      expect(a.working().get('layer', 'box')).toMatchObject({ name: 'Theirs', props: { x: 10, y: 300 } })
      a.write(set(prop('box', 'x'), 20))
      const sent = a.end('move')
      expect(sent).toEqual([{ type: 'changes', id: 1, base: 1, kind: 'edit', changes: [set(prop('box', 'x'), 20)] }])
      exchange(server, a, sent, [a, b])
      expect(inStep(a, server) && inStep(b, server)).toBe(true)
      // The undo takes back a's move only.
      exchange(server, a, a.undo(), [a, b])
      expect(server.state().get('layer', 'box')).toMatchObject({ name: 'Theirs', props: { x: 100, y: 300 } })
    })

    it('writes nothing to a record another tab deleted while the step was open', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      a.open()
      a.write(set(name('layer', 'box'), 'Mine'))
      a.write(set(name('layer', 'headline'), 'Mine too'))
      down(a, up(server, b, edit(b, 'delete', { op: 'delete', part: 'layer', id: 'box' })))
      expect(a.working().get('layer', 'box')).toBeUndefined()
      expect(a.end('rename')).toEqual([
        { type: 'changes', id: 1, base: 1, kind: 'edit', changes: [set(name('layer', 'headline'), 'Mine too')] },
      ])
    })

    it('sends the delete of layers that hold each other in a working design replayed under a crossing move', () => {
      const server = testServer(linkedDesign())
      const [a, b] = [joinClient(server), joinClient(server)]
      const g2 = {
        type: 'group',
        parentId: 'sq',
        link: 'g2',
        index: 'a5',
        name: 'G',
        props: { x: 0, y: 0, width: 9, height: 9 },
      }
      exchange(server, a, edit(a, 'group', { op: 'create', part: 'layer', id: 'g2', record: g2 }), [a, b])
      // b puts g2 into grp while a puts grp into g2: in a's working design each holds the other.
      const moveA = edit(a, 'move', set({ part: 'layer', id: 'grp', key: 'parentId' }, 'g2'))
      const outB = up(server, b, edit(b, 'move', set({ part: 'layer', id: 'g2', key: 'parentId' }, 'grp')))
      down(b, outB)
      down(a, outB)
      const told: RecordKey[] = []
      a.onChange((changed) => told.push(...changed))
      const remove = edit(a, 'delete', { op: 'delete', part: 'layer', id: 'grp' })
      expect(remove).toHaveLength(1)
      expect(a.working().get('layer', 'g2')).toBeUndefined()
      expect(told).toContain('layer/g2')
      exchange(server, a, [...moveA, ...remove], [a, b])
      expect(a.takeNotices()).toEqual([
        { kind: 'rejected', changeSetId: 2, changeSetKind: 'edit', reason: 'structure' },
      ])
      expect([server.state().get('layer', 'grp'), server.state().get('layer', 'g2')]).toEqual([undefined, undefined])
      expect(inStep(a, server) && inStep(b, server)).toBe(true)
    })

    it('puts back a cancelled step’s writes, sends nothing, and keeps redo (C32)', () => {
      const server = testServer()
      const a = joinClient(server)
      exchange(server, a, edit(a, 'rename', set(name('layer', 'box'), 'One')), [a])
      exchange(server, a, a.undo(), [a])
      const told: RecordKey[][] = []
      a.onChange((changed) => told.push([...changed]))
      a.open()
      a.write(set(prop('box', 'x'), 1))
      a.write(set(prop('box', 'x'), 2))
      a.cancel()
      expect(a.working().get('layer', 'box')).toMatchObject({ props: { x: 100 } })
      expect([a.stepOpen(), a.queued(), a.canUndo(), a.redoName()]).toEqual([false, 0, false, 'rename'])
      expect(told).toEqual([['layer/box'], ['layer/box'], ['layer/box']])
    })

    it('makes no undo step of a step that changed nothing, and keeps redo after a step nobody undoes (C32)', () => {
      const server = testServer()
      const a = joinClient(server)
      expect(edit(a, 'edit', set(name('layer', 'box'), 'Box'))).toEqual([])
      exchange(server, a, edit(a, 'rename', set(name('layer', 'box'), 'One')), [a])
      exchange(server, a, a.undo(), [a])
      exchange(server, a, edit(a, null, set(name('layer', 'headline'), 'Not undoable')), [a])
      expect([a.canUndo(), a.redoName()]).toEqual([false, 'rename'])
      exchange(server, a, edit(a, 'rename', set(name('layer', 'headline'), 'Undoable')), [a])
      expect(a.canRedo()).toBe(false)
    })

    it('keeps the newest steps up to the history limit (C32)', () => {
      const server = testServer()
      const a = joinClient(server, who(), { historyLimit: 2 })
      for (const n of [1, 2, 3]) exchange(server, a, edit(a, `rename ${n}`, set(name('page', 'p1'), `Page ${n}`)), [a])
      const undone: (string | undefined)[] = []
      for (; a.canUndo(); exchange(server, a, a.undo(), [a])) undone.push(a.undoName())
      expect(undone).toEqual(['rename 3', 'rename 2'])
      expect(server.state().get('page', 'p1')?.name).toBe('Page 1')
    })

    it('still sends a queued undo of a step a new edit cleared from redo, made again at the front (D5, 1)', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      exchange(server, a, edit(a, 'rename', set(name('layer', 'box'), 'Mine'), set(prop('box', 'x'), 10)), [a, b])
      // The undo waits behind a's queued move; then a new edit clears redo, which held the step.
      const move = edit(a, 'move', set(prop('box', 'y'), 5))
      expect(a.undo()).toEqual([])
      edit(a, 'rename', set(name('page', 'p1'), 'New'))
      expect(a.canRedo()).toBe(false)
      // b writes x before the undo goes out: made again at the front, the undo leaves it.
      exchange(server, b, edit(b, 'move', set(prop('box', 'x'), 99)), [a, b])
      exchange(server, a, move, [a, b])
      expect(server.state().get('layer', 'box')).toMatchObject({ name: 'Mine', props: { x: 99, y: 100 } })
      expect(server.state().get('page', 'p1')?.name).toBe('New')
      expect(inStep(a, server) && inStep(b, server)).toBe(true)
    })

    it('puts back a step over a change set’s limits with a notice, and sends nothing (C39)', () => {
      const server = testServer()
      const a = joinClient(server, who(), { limits: { messageBytes: 300 } })
      expect(edit(a, 'rename', set(name('layer', 'box'), 'x'.repeat(400)))).toEqual([])
      expect([a.queued(), a.canUndo(), a.working().get('layer', 'box')?.name]).toEqual([0, false, 'Box'])
      expect(a.takeNotices()).toEqual([{ kind: 'tooBig', step: 'rename' }])
      // A change set writing more layers than a design may hold is put back too, whatever its size.
      const roomy = joinClient(server)
      roomy.open()
      for (let n = 0; n <= 15_000; n++) {
        const record = {
          type: 'group',
          parentId: 'sq',
          link: `g${n}`,
          index: 'a5',
          name: 'G',
          props: { x: 0, y: 0, width: 1, height: 1 },
        }
        roomy.write({ op: 'create', part: 'layer', id: `g${n}`, record })
      }
      expect([roomy.end('paste'), roomy.takeNotices()]).toEqual([[], [{ kind: 'tooBig', step: 'paste' }]])
    })

    it('rejects an undo made again over a change set’s limits itself, sending nothing over them', () => {
      const server = testServer()
      // The box's name is long, so the undo of its delete, which makes it again, is over the limit.
      const other = joinClient(server)
      exchange(server, other, edit(other, 'rename', set(name('layer', 'box'), 'x'.repeat(400))), [other])
      const a = joinClient(server, who(), { limits: { messageBytes: 300 } })
      exchange(server, a, edit(a, 'delete', { op: 'delete', part: 'layer', id: 'box' }), [a])
      const sent = a.undo()
      expect(sent).toEqual([])
      expect([a.queued(), server.state().get('layer', 'box')]).toEqual([0, undefined])
      expect(a.working().get('layer', 'box')).toBeUndefined()
      expect(a.takeNotices()).toEqual([
        { kind: 'rejected', changeSetId: expect.any(Number), changeSetKind: 'undo', reason: 'tooManyChanges' },
      ])
      // The step waits on its stack, as one the server rejected does, and the tab goes on.
      expect(a.canUndo()).toBe(true)
      exchange(server, a, edit(a, 'rename', set(name('page', 'p1'), 'Next')), [a])
      expect(server.state().get('page', 'p1')?.name).toBe('Next')
      expect(inStep(a, server)).toBe(true)
    })

    it('rejects a redo made again over a change set’s limits itself, and the queue behind it goes on', () => {
      const server = testServer()
      const other = joinClient(server)
      const a = joinClient(server, who(), { limits: { messageBytes: 300 } })
      const g2 = {
        type: 'group',
        parentId: 'sq',
        link: 'g2',
        index: 'a5',
        name: 'G',
        props: { x: 0, y: 0, width: 9, height: 9 },
      }
      exchange(server, a, edit(a, 'group', { op: 'create', part: 'layer', id: 'g2', record: g2 }), [a, other])
      // Another tab gives the group a long name; undone, it goes; redone, it would come back with that name, over the limit.
      exchange(server, other, edit(other, 'rename', set(name('layer', 'g2'), 'x'.repeat(400))), [a, other])
      exchange(server, a, a.undo(), [a, other])
      expect(server.state().get('layer', 'g2')).toBeUndefined()
      // Offline, the redo and a rename behind it queue; back online, the redo is made again at the front.
      a.disconnect()
      server.leave(a.tabId())
      expect(a.redo()).toEqual([])
      edit(a, 'rename', set(name('page', 'p1'), 'Behind'))
      const joined = server.join(wire(a.reconnect('t')), who())
      if ('close' in joined) throw new Error(joined.reason)
      const sent = joined.out.flatMap(({ to, message }) => (to === joined.tabId ? a.receive(wire(message)) : []))
      expect(sent.every((m) => m.type !== 'changes' || m.kind !== 'redo')).toBe(true)
      exchange(server, a, sent, [a])
      expect(a.takeNotices()).toContainEqual({
        kind: 'rejected',
        changeSetId: expect.any(Number),
        changeSetKind: 'redo',
        reason: 'tooManyChanges',
      })
      expect([server.state().get('layer', 'g2'), server.state().get('page', 'p1')?.name]).toEqual([undefined, 'Behind'])
      expect(a.canRedo()).toBe(true)
    })

    it('rebuilds under 1,000 queued change sets in time that grows with them only', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      for (let n = 1; n <= 1000; n++) edit(a, 'move', set(prop('box', 'x'), n))
      const out = up(server, b, edit(b, 'rename', set(name('layer', 'headline'), 'Theirs')))
      const ms = holdOf(() => down(a, out))
      expect(a.working().get('layer', 'headline')?.name).toBe('Theirs')
      expect(a.working().get('layer', 'box')).toMatchObject({ props: { x: 1000 } })
      expect(ms).toBeLessThan(1000)
    })

    it('tells its listeners which records others’ change sets changed', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      const told: RecordKey[][] = []
      a.onChange((changed) => told.push([...changed].sort()))
      // a's queued rename of the headline still shows over b's.
      edit(a, 'rename', set(name('layer', 'headline'), 'Mine'))
      told.length = 0
      down(a, up(server, b, edit(b, 'edit', set(name('layer', 'headline'), 'Theirs'), set(prop('box', 'x'), 5))))
      expect(told).toEqual([['layer/box']])
    })
  })

  describe('what the server tells', () => {
    it('keeps the other tabs, the access, the size and the notices it hears, and asks for a token', () => {
      const server = testServer()
      let asked = 0
      const a = joinClient(server, who(), { onTokenRequest: () => asked++ })
      const b = joinClient(server, who(BOB))
      const heard: string[] = []
      a.onAccess((access) => heard.push(access))
      expect(a.tabs()).toEqual(new Map())
      a.receive({ type: 'joined', tabId: b.tabId(), name: 'bob' })
      expect(b.tabs()).toEqual(new Map([[a.tabId(), 'ann']]))
      expect(a.tabs()).toEqual(new Map([[b.tabId(), 'bob']]))
      a.receive({ type: 'left', tabId: b.tabId() })
      a.receive({ type: 'access', access: 'view' })
      a.receive({ type: 'token' })
      const size = { layers: 1, frames: 2, pages: 3, sections: 4, connectors: 5, bytes: 6 }
      a.receive({ type: 'notice', kind: 'nearLimit', size })
      expect([a.tabs().size, a.access(), asked, a.takeNotices()]).toEqual([0, 'view', 1, [{ kind: 'nearLimit', size }]])
      // Its listeners hear the access change; a tab that comes back as an editor again hears that too.
      expect(comeBack(server, a)).toEqual([])
      expect(heard).toEqual(['view', 'edit'])
      down(a, up(server, b, edit(b, 'rename', set(name('page', 'p1'), 'P'))))
      expect(a.size()).toEqual(server.size())
    })

    it('tells a restore another tab made, and passes over a message type it does not know, staying connected', () => {
      const a = joinClient(testServer())
      expect(a.receive({ type: 'restored', tabId: 9, by: 'bob', mark: MARK })).toEqual([])
      expect(a.takeNotices()).toEqual([{ kind: 'restored', by: 'bob', mark: MARK }])
      expect(a.receive({ type: 'fromANewerServer' } as unknown as ServerMessage)).toEqual([])
      expect([a.isOnline(), a.takeNotices()]).toEqual([true, []])
    })
  })

  describe('restores', () => {
    it('sends a restore’s mark with its change set, and none with its undo or redo', () => {
      const server = testServer()
      const a = joinClient(server)
      a.open()
      a.write(set(name('page', 'p1'), 'Restored'))
      const sent = a.end('restore', MARK)
      expect(sent).toEqual([
        {
          type: 'changes',
          id: 1,
          base: 0,
          kind: 'edit',
          changes: [set(name('page', 'p1'), 'Restored')],
          restore: MARK,
        },
      ])
      exchange(server, a, sent, [a])
      const undo = a.undo()
      expect(undo).toMatchObject([{ kind: 'undo' }])
      expect(undo[0]).not.toHaveProperty('restore')
      exchange(server, a, undo, [a])
      const redo = a.redo()
      expect(redo).toMatchObject([{ kind: 'redo' }])
      expect(redo[0]).not.toHaveProperty('restore')
    })

    it('leaves a newer change of its own that no one undoes to an undo of the restore', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      a.open()
      a.write(set(name('layer', 'box'), 'Restored'))
      a.write(set(name('page', 'p1'), 'Restored'))
      exchange(server, a, a.end('restore', MARK), [a, b])
      // A picture arrives in the restored layer as a change no one undoes.
      exchange(server, a, edit(a, null, set(name('layer', 'box'), 'Arrived')), [a, b])
      exchange(server, a, a.undo(), [a, b])
      expect(server.state().get('layer', 'box')?.name).toBe('Arrived')
      expect(server.state().get('page', 'p1')?.name).not.toBe('Restored')
    })

    it('leaves a change of its own that no one undoes, still unconfirmed at the press, to the undo before it', () => {
      const server = testServer()
      const a = joinClient(server)
      exchange(server, a, edit(a, 'restore', set(name('layer', 'box'), 'Restored')), [a])
      const arrival = edit(a, null, set(name('layer', 'box'), 'Arrived'))
      // The undo waits behind the arrival in the queue, and is made again over it when it goes.
      expect(a.undo()).toEqual([])
      exchange(server, a, arrival, [a])
      expect(server.state().get('layer', 'box')?.name).toBe('Arrived')
    })

    it('counts the mark in a change set’s size: a restore over the limits with it is put back', () => {
      const change = set(name('page', 'p1'), 'Restored')
      const bytes = JSON.stringify({ type: 'changes', id: 1, base: 0, kind: 'edit', changes: [change] }).length
      const server = testServer()
      const a = joinClient(server, who(), { limits: { messageBytes: bytes + 10 } })
      a.open()
      a.write(change)
      expect([a.end('restore', MARK), a.takeNotices()]).toEqual([[], [{ kind: 'tooBig', step: 'restore' }]])
      expect(edit(a, 'restore', change)).toHaveLength(1)
    })

    it('sends a restore queued offline with its mark after a reload', () => {
      const server = testServer()
      const a = joinClient(server)
      a.disconnect()
      server.leave(a.tabId())
      a.open()
      a.write(set(name('page', 'p1'), 'Restored'))
      expect(a.end('restore', MARK)).toEqual([])
      const reloaded = openClient(copyOf(a))
      const joined = server.join(wire(reloaded.reconnect('t')), who())
      expect(down(reloaded, 'out' in joined ? joined.out : [])).toMatchObject([{ kind: 'edit', restore: MARK }])
    })
  })

  describe('reloads', () => {
    it('lets another tab take up a closed tab’s copy and send its work once', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      exchange(server, a, edit(a, 'rename', set(name('page', 'p1'), 'Sent')), [a, b])
      a.disconnect()
      server.leave(a.tabId())
      edit(a, 'rename', set(name('frame', 'sq'), 'Offline'))
      // The tab closes for good; later another tab of the same browser takes up its copy.
      const copy = copyOf(a)
      exchange(server, b, edit(b, 'rename', set(name('layer', 'box'), 'Meanwhile')), [b])
      const taken = openClient(copy)
      expect([taken.isOnline(), taken.queued(), taken.working().get('frame', 'sq')?.name]).toEqual([
        false,
        1,
        'Offline',
      ])
      const joined = server.join(wire(taken.reconnect('t')), who())
      expect('tabId' in joined && joined.tabId).toBe(a.tabId())
      const sends = down(taken, 'out' in joined ? joined.out : [])
      expect(sends).toHaveLength(1)
      exchange(server, taken, sends, [taken, b])
      // A copy of it sent again is ignored.
      expect(up(server, taken, sends)).toEqual([])
      expect([server.seq(), server.state().get('frame', 'sq')?.name, taken.takeNotices()]).toEqual([3, 'Offline', []])
      expect(inStep(taken, server) && inStep(b, server)).toBe(true)
    })

    it('comes back from a copy older than what it sent: it settles what the server took and sends the rest under new ids', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      a.disconnect()
      server.leave(a.tabId())
      edit(a, 'rename', set(name('page', 'p1'), 'Saved offline'))
      const old = copyOf(a)
      // The tab comes back and sends 1, then 2; neither answer arrives, and its copy was never written again.
      down(b, up(server, a, comeBack(server, a)))
      down(b, up(server, a, edit(a, 'rename', set(name('frame', 'sq'), 'Never saved'))))
      const reloaded = openClient(old)
      edit(reloaded, 'rename', set(name('layer', 'box'), 'After the reload'))
      server.leave(a.tabId())
      const joined = server.join(wire(reloaded.reconnect('t')), who())
      exchange(server, reloaded, down(reloaded, 'out' in joined ? joined.out : []), [reloaded, b])
      const names = [
        server.state().get('page', 'p1'),
        server.state().get('frame', 'sq'),
        server.state().get('layer', 'box'),
      ]
      expect(names.map((record) => record?.name)).toEqual(['Saved offline', 'Never saved', 'After the reload'])
      expect([reloaded.queued(), reloaded.takeNotices()]).toEqual([0, []])
      expect(inStep(reloaded, server) && inStep(b, server)).toBe(true)
    })

    it('keeps an open step’s writes across a reload, as one step nobody undoes', () => {
      const server = testServer()
      const a = joinClient(server)
      a.open()
      a.write(set(prop('box', 'x'), 7))
      const reloaded = openClient(copyOf(a))
      expect([reloaded.stepOpen(), reloaded.canUndo(), reloaded.queued()]).toEqual([false, false, 1])
      server.leave(a.tabId())
      const joined = server.join(wire(reloaded.reconnect('t')), who())
      exchange(server, reloaded, down(reloaded, 'out' in joined ? joined.out : []), [reloaded])
      expect(server.state().get('layer', 'box')).toMatchObject({ props: { x: 7 } })
    })

    it('makes an undo that waited at the reload again from the confirmed design', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      exchange(server, a, edit(a, 'rename', set(name('layer', 'box'), 'Mine'), set(prop('box', 'x'), 10)), [a, b])
      const move = edit(a, 'move', set(prop('box', 'y'), 5))
      // The undo waits behind the move; b writes x meanwhile; a reloads before anything comes back.
      expect(a.undo()).toEqual([])
      exchange(server, b, edit(b, 'move', set(prop('box', 'x'), 99)), [b])
      down(b, up(server, a, move))
      const reloaded = openClient(copyOf(a))
      server.leave(a.tabId())
      const joined = server.join(wire(reloaded.reconnect('t')), who())
      exchange(server, reloaded, down(reloaded, 'out' in joined ? joined.out : []), [reloaded, b])
      // The move's undo is undone; b's later x stays.
      expect(server.state().get('layer', 'box')).toMatchObject({ name: 'Mine', props: { x: 99, y: 100 } })
      expect(inStep(reloaded, server) && inStep(b, server)).toBe(true)
    })
  })

  describe('coming back', () => {
    it('tells its listeners what a catch-up changed before a change set it can’t place', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      a.disconnect()
      server.leave(a.tabId())
      exchange(server, b, edit(b, 'rename', set(name('layer', 'headline'), 'New')), [b])
      exchange(server, b, edit(b, 'rename', set(name('layer', 'box'), 'Later')), [b])
      const told = new Set<RecordKey>()
      a.onChange((changed) => changed.forEach((key) => told.add(key)))
      const joined = server.join(wire(a.reconnect('t')), who())
      const welcome = wire('out' in joined ? joined.out[0]?.message : undefined)
      if (welcome?.type !== 'welcome' || !('changeSets' in welcome.catchUp)) throw new Error('no catch-up')
      ;(welcome.catchUp.changeSets[1] as { seq: number }).seq = 99
      expect(() => a.receive(welcome)).toThrow(SyncBroken)
      expect([a.working().get('layer', 'headline')?.name, told.has('layer/headline')]).toEqual(['New', true])
    })

    it('settles a change set whose answer was lost by the catch-up, and sends nothing twice', () => {
      const server = testServer()
      const a = joinClient(server)
      up(server, a, edit(a, 'rename', set(name('page', 'p1'), 'Mine')))
      expect(comeBack(server, a)).toEqual([])
      expect([a.queued(), a.canUndo()]).toEqual([0, true])
      expect(inStep(a, server)).toBe(true)
    })

    it('drops a change set rejected while offline, with no reason, and sends the work made offline', () => {
      const server = testServer()
      const [a, b] = [joinClient(server), joinClient(server)]
      const remove = edit(b, 'delete', { op: 'delete', part: 'frame', id: 'sq' })
      const rename = edit(a, 'rename', set(name('frame', 'sq'), 'Mine'))
      down(b, up(server, b, remove))
      // a's rename is rejected, but a never hears it; it keeps working offline.
      up(server, a, rename)
      a.disconnect()
      expect(edit(a, 'rename', set(name('page', 'p1'), 'Page A'))).toEqual([])
      expect(a.queued()).toBe(2)
      const resend = comeBack(server, a)
      expect(resend).toHaveLength(1)
      expect(a.takeNotices()).toEqual([{ kind: 'rejected', changeSetId: 1, changeSetKind: 'edit' }])
      exchange(server, a, resend, [a, b])
      expect(inStep(a, server) && inStep(b, server)).toBe(true)
      expect(server.state().get('page', 'p1')?.name).toBe('Page A')
    })

    it('catches up with the whole design after a long absence, and with the missed change sets after a short one', () => {
      const server = testServer(undefined, { limits: { logChangeSets: 3 } })
      const [a, b] = [joinClient(server), joinClient(server)]
      a.disconnect()
      for (let i = 0; i < 5; i++) exchange(server, b, edit(b, 'rename', set(name('page', 'p1'), `Page ${i}`)), [b])
      server.leave(a.tabId())
      const long = server.join(wire(a.reconnect('t')), who())
      expect('out' in long && long.out[0]?.message).toMatchObject({ type: 'welcome', catchUp: { design: {} } })
      down(a, 'out' in long ? long.out : [])
      expect(inStep(a, server)).toBe(true)
      a.disconnect()
      exchange(server, b, edit(b, 'rename', set(name('page', 'p1'), 'Later')), [b])
      server.leave(a.tabId())
      const short = server.join(wire(a.reconnect('t')), who())
      expect('out' in short && short.out[0]?.message).toMatchObject({ catchUp: { changeSets: [{ seq: 6 }] } })
      down(a, 'out' in short ? short.out : [])
      expect(inStep(a, server)).toBe(true)
    })

    it('leaves what others changed meanwhile when it undoes after a whole-design catch-up (D5, 2)', () => {
      const server = testServer(undefined, { limits: { logChangeSets: 2 } })
      const [a, b] = [joinClient(server), joinClient(server)]
      exchange(server, a, edit(a, 'rename', set(name('page', 'p1'), 'A page'), set(name('frame', 'sq'), 'A frame')), [
        a,
        b,
      ])
      a.disconnect()
      for (let i = 0; i < 4; i++) exchange(server, b, edit(b, 'rename', set(name('frame', 'sq'), `B frame ${i}`)), [b])
      expect(comeBack(server, a)).toEqual([])
      exchange(server, a, a.undo(), [a, b])
      expect(server.state().get('page', 'p1')?.name).toBe('Page 1')
      expect(server.state().get('frame', 'sq')?.name).toBe('B frame 3')
      expect(inStep(a, server)).toBe(true)
    })

    it('starts over with a notice when the server answers under another sync id', () => {
      const server = testServer()
      const a = joinClient(server)
      a.disconnect()
      edit(a, 'rename', set(name('page', 'p1'), 'Offline'))
      const saved = firstSaved(testDesign() as unknown as DesignRecords, 'other')
      const other = openServer({ saved, journal: [], lastEntry: 0 }, testServerOptions())
      joinClient(other)
      const joined = other.join(wire(a.reconnect('t')), who())
      const welcome = 'out' in joined ? joined.out[0]?.message : undefined
      expect(welcome && a.receive(wire(welcome))).toEqual([])
      expect([a.syncId(), a.tabId(), a.queued(), a.canUndo()]).toEqual(['other', 2, 0, false])
      expect(inStep(a, other)).toBe(true)
      expect(a.takeNotices()).toEqual([{ kind: 'lost', changeSets: 1 }])
    })

    it('starts over when its tab id was dropped, or another member resumes it (C44)', () => {
      const server = testServer(undefined, { limits: { tabIds: 1 } })
      const a = joinClient(server)
      a.disconnect()
      server.leave(a.tabId())
      edit(a, 'rename', set(name('page', 'p1'), 'Offline'))
      // A second tab past the limit drops a's tab id.
      joinClient(server)
      expect(comeBack(server, a)).toEqual([])
      expect([a.tabId(), a.queued(), a.takeNotices()]).toEqual([3, 0, [{ kind: 'lost', changeSets: 1 }]])
      // Another member with a's copy joins as a tab of its own.
      const copy = openClient(copyOf(a))
      edit(copy, 'rename', set(name('page', 'p1'), 'Theirs'))
      expect(comeBack(server, copy, who(BOB))).toEqual([])
      expect([copy.tabId() !== a.tabId(), copy.queued(), copy.takeNotices()]).toEqual([
        true,
        0,
        [{ kind: 'lost', changeSets: 1 }],
      ])
    })
  })
})
