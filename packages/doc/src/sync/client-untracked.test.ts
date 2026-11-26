// A tab's own changes that no one undoes, as arrivals of AI results are (ADR-0004): its earlier steps' undo and
// redo leave what they wrote, as they leave another tab's writes.
import { describe, expect, it } from 'vitest'

import type { Change, RestoreMark, Target } from '@dazbee/schema'

import { edit, exchange, joinClient, testServer } from './test-session.ts'

const MARK: RestoreMark = { versionId: 'v1', kind: 'named', name: 'Sent', takenAt: '2026-11-16T14:30:00.000Z' }

const name = (part: 'page' | 'frame' | 'layer', id: string): Target => ({ part, id, key: 'name' })
const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })

describe('openClient', () => {
  describe('its own changes no one undoes', () => {
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
  })
})
