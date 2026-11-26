// The sync server's undo and redo across tabs (C46) for connectors: one counts as placed in its
// ends, a frame or a section, though its page holds it.
import { describe, expect, it } from 'vitest'

import { openServer } from './server.ts'
import { BOB, changes, editor, fresh, joined, send, testOptions, to } from './test-server.ts'

describe('openServer: an undo of what another tab drew a connector to', () => {
  it('rejects an undo deleting a section or frame another tab drew a connector to after its base', () => {
    const server = openServer(fresh(), testOptions())
    const a = joined(server)
    const b = joined(server, editor(BOB))
    const mine = { pageId: 'p1', title: 'Mine', order: 'a5' }
    const late = { ...(server.state().get('frame', 'tall') as Record<string, unknown>), x: 9000, order: 'a9' }
    send(server, a.tabId, 1, [
      { op: 'create', part: 'section', id: 'mine', record: mine },
      { op: 'create', part: 'frame', id: 'late', record: late },
    ])
    send(server, b.tabId, 1, [
      {
        op: 'create',
        part: 'connector',
        id: 'one',
        record: { pageId: 'p1', from: 'other', to: 'mine', order: 'a5' },
      },
      { op: 'create', part: 'connector', id: 'two', record: { pageId: 'p1', from: 'late', to: 'tall', order: 'a6' } },
    ])
    for (const [n, id, part] of [
      [2, 'mine', 'section'],
      [3, 'late', 'frame'],
    ] as const) {
      const out = to(a.tabId, server.receive(a.tabId, changes(n, 1, [{ op: 'delete', part, id }], 'undo'), 100))
      expect(out).toEqual([{ type: 'reject', changeSetId: n, reason: 'placedSince' }])
    }
    // Made on a base that saw the connectors, the same undo is taken: the tab holds it back itself.
    const seen = to(
      a.tabId,
      server.receive(a.tabId, changes(4, 2, [{ op: 'delete', part: 'frame', id: 'late' }], 'undo'), 100),
    )
    expect(seen).toMatchObject([{ type: 'accepted' }])
  })
})
