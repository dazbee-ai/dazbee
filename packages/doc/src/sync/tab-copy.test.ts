// A tab copy written as entries (D9): a step writes only small ones, the log folds when the tab is
// idle, and the entries always add up to what the client saves.
import { describe, expect, it } from 'vitest'

import type { Accepted, Change, RestoreMark, Target } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { linkedDesign } from '../test-design.ts'
import { type Client, openClient, type SavedClient } from './client.ts'
import type { Outgoing, Server } from './server.ts'
import { type Entries, FOLD_LOG, putEntries, restoreEntries, TabCopy } from './tab-copy.ts'
import { down, edit, exchange, joinClient, testServer, up, who, wire } from './test-session.ts'
import { groupHeights, withGroupHeights } from './test-sim-edits.ts'

const name = (part: 'page' | 'layer', id: string): Target => ({ part, id, key: 'name' })
const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })

/** The names the server took for page p1 and layer title, in its order, from every accepted change set. */
const namesTaken = (server: Server) =>
  server
    .takeJournal()
    .flatMap((entry) =>
      entry.kind === 'accepted'
        ? entry.changeSet.changes.flatMap((change) =>
            change.op === 'set' && change.value.key === 'name' && change.value.id !== 'price' ? [change.to] : [],
          )
        : [],
    )

/** A tab's copy, kept as it writes it: a new one, or the one in `entries` it took up after a reload. */
function copyOf(c: Client, entries: Entries = new Map()) {
  const copy = new TabCopy(entries)
  let heard: Accepted[] = []
  /** Writes the copy; returns what the write put and removed. */
  const write = () => {
    const written = copy.write(wire(c.save()), heard)
    putEntries(entries, written)
    heard = []
    return written
  }
  /** Delivers `out` to the tab, keeping the change sets it takes. */
  const take = (out: readonly Outgoing[]) => {
    for (const { to, except, message } of out) {
      if ((to !== 'all' && to !== c.tabId()) || except === c.tabId() || message.type !== 'accepted') continue
      const { seq, author, changeSetId, changes } = wire(message)
      heard.push({ seq, author, changeSetId, changes })
    }
    return down(c, out)
  }
  return { entries, write, take }
}

describe('TabCopy', () => {
  it('writes the whole design once, then a step writes its queue entry and another tab’s change set a log entry', () => {
    const server = testServer(linkedDesign())
    const [a, b] = [joinClient(server), joinClient(server)]
    const copy = copyOf(a)
    const first = copy.write()
    expect([...first.put.keys()].sort()).toEqual(['head', 'tab'])
    // a's step waits in its queue: one small entry, and the head's next id.
    const sent = edit(a, 'rename', set(name('layer', 'title'), 'Mine'))
    const step = copy.write()
    expect([[...step.put.keys()].sort(), step.remove]).toEqual([['head', 'queue/1'], []])
    expect(step.bytes).toBeLessThan(first.bytes / 5)
    // b's change set lands first; then a's own: each is one log entry, and a's queue entry goes.
    copy.take(up(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs'))))
    copy.take(up(server, a, sent))
    const landed = copy.write()
    expect([[...landed.put.keys()].sort(), landed.remove]).toEqual([['log/1', 'log/2'], ['queue/1']])
  })

  it('keeps a queued restore’s mark in its entries', () => {
    const a = joinClient(testServer(linkedDesign()))
    const copy = copyOf(a)
    const mark: RestoreMark = { versionId: 'v1', kind: 'auto', name: '', takenAt: '2026-11-16T14:30:00.000Z' }
    a.open()
    a.write(set(name('page', 'p1'), 'Restored'))
    a.end('restore', mark)
    copy.write()
    expect(restoreEntries(copy.entries).queue).toMatchObject([{ kind: 'edit', restore: mark }])
    expect(restoreEntries(copy.entries)).toEqual(wire(a.save()))
  })

  it('folds the log into the design once the tab is idle and the log is long, and never while a change set waits', () => {
    const server = testServer(linkedDesign())
    const [a, b] = [joinClient(server), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    const theirs = (n: number) => copy.take(up(server, b, edit(b, 'rename', set(name('page', 'p1'), `P${n}`))))
    // Idle, with a log of exactly the limit: no fold yet.
    for (let n = 0; n < FOLD_LOG.changeSets; n++) theirs(n)
    expect(copy.write().put.has('tab')).toBe(false)
    // Past the limit while a's change set waits: still no fold.
    const sent = edit(a, 'rename', set(name('layer', 'title'), 'Waiting'))
    theirs(FOLD_LOG.changeSets)
    expect(copy.write().put.has('tab')).toBe(false)
    // a's own change set lands: the tab is idle, and the next write folds the log.
    copy.take(up(server, a, sent))
    const folded = copy.write()
    expect(folded.put.has('tab')).toBe(true)
    expect([...copy.entries.keys()].sort()).toEqual(['head', 'tab'])
    expect(restoreEntries(copy.entries)).toEqual(wire(a.save()))
  })

  it('stores nothing more for a tab that made no change set since its reload', () => {
    const server = testServer(linkedDesign())
    const a = joinClient(server)
    const copy = copyOf(a)
    edit(a, 'rename', set(name('page', 'p1'), 'Queued'))
    copy.write()
    const reloaded = openClient(restoreEntries(copy.entries))
    expect(wire(reloaded.save())).toEqual(wire(a.save()))
    expect(Object.keys(copy.entries.get('head') as object).sort()).toEqual(['access', 'nextId', 'owed'])
  })

  it('writes the tab entry again when the log no longer leads to the confirmed design', () => {
    const server = testServer(linkedDesign(), { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    // a misses two change sets and catches up with the whole design.
    up(server, b, edit(b, 'rename', set(name('page', 'p1'), 'One')))
    up(server, b, edit(b, 'rename', set(name('page', 'p1'), 'Two')))
    server.leave(a.tabId())
    a.disconnect()
    const joined = server.join(wire(a.reconnect('t')), who())
    if ('close' in joined) throw new Error(joined.reason)
    for (const { message } of joined.out) a.receive(wire(message))
    const rewritten = copy.write()
    expect(rewritten.put.has('tab')).toBe(true)
    expect(restoreEntries(copy.entries)).toEqual(wire(a.save()))
  })
})

describe('restoreEntries', () => {
  it('adds the entries up to exactly what the client saves: queue, steps shared and the open step', () => {
    const server = testServer(withGroupHeights(linkedDesign()))
    const options = { recompute: groupHeights }
    const [a, b] = [joinClient(server, undefined, options), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    const checks: SavedClient[] = []
    const check = () => {
      copy.write()
      const saved = wire(a.save())
      checks.push(saved)
      expect(restoreEntries(copy.entries)).toEqual(saved)
    }
    // b's change set crosses a's: a owes the group's height once its own lands.
    const move: Change[] = [
      set({ part: 'layer', id: 'badge', key: 'parentId' }, 'grp'),
      set({ part: 'layer', id: 'badge', key: 'index' }, 'a5'),
    ]
    const sent = edit(a, 'move', ...move)
    check()
    copy.take(up(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs'))))
    check()
    copy.take(up(server, a, sent))
    check()
    // An undo and its follow-up share one step; an open step comes back too.
    a.disconnect()
    a.undo()
    a.open()
    a.write(set(name('layer', 'title'), 'Open'))
    check()
    expect(checks.at(-1)?.queue.length).toBeGreaterThan(0)
    const back = openClient(restoreEntries(copy.entries), options)
    expect(back.working().toRecords()).toEqual(openClient(wire(a.save()), options).working().toRecords())
  })

  it('keeps the values a tab still owes while its recompute waits', () => {
    const server = testServer(withGroupHeights(linkedDesign()))
    const [a, b] = [joinClient(server, undefined, { recompute: () => 'wait' }), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    const sent = edit(a, 'move', set({ part: 'layer', id: 'badge', key: 'parentId' }, 'grp'))
    copy.take(up(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs'))))
    copy.take(up(server, a, sent))
    copy.write()
    const saved = wire(a.save())
    expect([saved.owed.length > 0, restoreEntries(copy.entries)]).toEqual([true, saved])
  })

  describe('reloaded more than once before the tab comes back, from a copy older than what it sent', () => {
    it.each([
      [2, 'alone'],
      [3, 'alone'],
      [2, 'with a second tab'],
      [3, 'with a second tab'],
    ])('sends every edit made offline across %i reloads once, in order (%s)', (reloads, others) => {
      const server = testServer(linkedDesign())
      const a = joinClient(server)
      const b = others === 'alone' ? undefined : joinClient(server)
      const everyone = (c: Client) => (b ? [c, b] : [c])
      const first = copyOf(a)
      // a sends one change set its tab copy holds, then two it never holds, and hears no answer.
      const kept = edit(a, 'rename', set(name('layer', 'title'), 'Kept'))
      first.write()
      if (b) down(b, up(server, a, kept))
      else up(server, a, kept)
      for (const n of [1, 2]) {
        const out = up(server, a, edit(a, 'rename', set(name('layer', 'title'), `Sent ${n}`)))
        if (b) down(b, out)
      }
      server.leave(a.tabId())
      let tab = a
      for (let n = 1; n <= reloads; n++) {
        tab = openClient(restoreEntries(first.entries))
        const copy = copyOf(tab, first.entries)
        edit(tab, 'rename', set(name('page', 'p1'), `Offline ${n}`))
        copy.write()
        if (b) exchange(server, b, edit(b, 'rename', set(name('layer', 'price'), `Theirs ${n}`)), [b])
      }
      const joined = server.join(wire(tab.reconnect('t')), who())
      if ('close' in joined) throw new Error(joined.reason)
      exchange(server, tab, down(tab, joined.out), everyone(tab))
      const offline = Array.from({ length: reloads }, (_, n) => `Offline ${n + 1}`)
      expect(namesTaken(server)).toEqual(['Kept', 'Sent 1', 'Sent 2', ...offline])
      expect([tab.queued(), tab.takeNotices()]).toEqual([0, []])
      for (const c of everyone(tab)) expect(sameValue(c.working().toRecords(), server.state().toRecords())).toBe(true)
    })

    it.each([
      ['the change sets it missed', 100, 'page', 'p1'],
      ['the whole design', 1, 'layer', 'price'],
    ] as const)(
      'sends a change set the server took once only, back from a tab copy written before it came back (catch-up: %s)',
      (_, logChangeSets, part, id) => {
        const server = testServer(linkedDesign(), { limits: { logChangeSets } })
        const [a, b] = [joinClient(server), joinClient(server)]
        const first = copyOf(a)
        first.write()
        server.leave(a.tabId())
        // Reloaded before the server welcomed it, the tab edits, and its tab copy holds the edit.
        const back = openClient(restoreEntries(first.entries))
        const copy = copyOf(back, first.entries)
        edit(back, 'rename', set(name('page', 'p1'), 'Mine'))
        copy.write()
        const stale = new Map(wire([...first.entries]))
        // It comes back and the server takes the edit; the tab copy's writes since are lost.
        const joined = server.join(wire(back.reconnect('t')), who())
        if ('close' in joined) throw new Error(joined.reason)
        exchange(server, back, down(back, joined.out), [back, b])
        server.leave(back.tabId())
        // Another tab writes after it: twice, so that a log of one change set catches the tab up with the whole design.
        exchange(server, b, edit(b, 'rename', set(name(part, id), 'Theirs')), [b])
        exchange(server, b, edit(b, 'rename', set(name('layer', 'title'), 'Later')), [b])
        const again = openClient(restoreEntries(stale))
        const rejoined = server.join(wire(again.reconnect('t')), who())
        if ('close' in rejoined) throw new Error(rejoined.reason)
        exchange(server, again, down(again, rejoined.out), [again, b])
        expect(namesTaken(server).filter((taken) => taken === 'Mine')).toEqual(['Mine'])
        expect(server.state().get(part, id)?.name).toBe('Theirs')
        expect([again.queued(), again.takeNotices()]).toEqual([0, []])
        expect(sameValue(again.working().toRecords(), server.state().toRecords())).toBe(true)
      },
    )

    it.each([
      ['the change sets it missed', 100],
      ['the whole design', 1],
    ] as const)(
      'sends a change set the server took once only, though the device kept a -0 the server took as 0 (catch-up: %s)',
      (_, logChangeSets) => {
        const server = testServer(linkedDesign(), { limits: { logChangeSets } })
        const [a, b] = [joinClient(server), joinClient(server)]
        server.leave(a.tabId())
        const back = openClient(structuredClone(a.save()))
        edit(back, 'move', set({ part: 'layer', id: 'title', key: 'props', prop: 'x' }, -0))
        // The device keeps values as they are; the wire carries JSON. The tab copy's writes after the welcome are lost.
        const stale = structuredClone(back.save())
        const joined = server.join(wire(back.reconnect('t')), who())
        if ('close' in joined) throw new Error(joined.reason)
        exchange(server, back, down(back, joined.out), [back, b])
        server.leave(back.tabId())
        exchange(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs')), [b])
        exchange(server, b, edit(b, 'rename', set(name('layer', 'title'), 'Later')), [b])
        const again = openClient(stale)
        const rejoined = server.join(wire(again.reconnect('t')), who())
        if ('close' in rejoined) throw new Error(rejoined.reason)
        exchange(server, again, down(again, rejoined.out), [again, b])
        expect([server.seq(), again.queued(), again.takeNotices()]).toEqual([3, 0, []])
      },
    )

    it('tells the person of an edit made under a reused id that no longer applies, after a catch-up of the whole design', () => {
      const server = testServer(linkedDesign(), { limits: { logChangeSets: 1 } })
      const [a, b] = [joinClient(server), joinClient(server)]
      const first = copyOf(a)
      first.write()
      // a sends a change set its tab copy never holds, and hears no answer.
      down(b, up(server, a, edit(a, 'rename', set(name('layer', 'title'), 'Sent'))))
      server.leave(a.tabId())
      const back = openClient(restoreEntries(first.entries))
      edit(back, 'rename', set(name('layer', 'price'), 'Mine'))
      // Another tab deletes the layer the edit renames, and writes once more.
      exchange(server, b, edit(b, 'delete', { op: 'delete', part: 'layer', id: 'price' }), [b])
      exchange(server, b, edit(b, 'rename', set(name('page', 'p1'), 'Later')), [b])
      const joined = server.join(wire(back.reconnect('t')), who())
      if ('close' in joined) throw new Error(joined.reason)
      exchange(server, back, down(back, joined.out), [back, b])
      expect(server.state().get('layer', 'title')?.name).toBe('Sent')
      expect([back.queued(), back.takeNotices()]).toMatchObject([0, [{ kind: 'rejected', changeSetKind: 'edit' }]])
    })
  })
})
