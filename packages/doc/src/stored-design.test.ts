// A reader of a stored design (the API's duplicate, cover, thumbnail and asset uses) applies the
// journal as the sync server does and stops at the same entry (D8).
import { describe, expect, it } from 'vitest'

import type { Change, DesignRecords, Entry, Member } from '@dazbee/schema'

import { readDesign } from './store.ts'
import { storedDesign } from './stored-design.ts'
import { firstSaved, type Loaded } from './sync/journal.ts'
import { openServer } from './sync/server.ts'
import { linkedDesign } from './test-design.ts'

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })
const accepted = (entry: number, seq: number, changes: Change[]): Entry => ({
  entry,
  kind: 'accepted',
  member: ANN,
  changeSet: { seq, author: 1, changeSetId: seq, changes },
  bytes: 50,
})

/** A stored design whose journal renames two layers, then holds a change set that no longer applies, and one after it. */
function rowsWithDeadTail(): Loaded {
  const saved = firstSaved(linkedDesign() as unknown as DesignRecords, 's0')
  const journal: Entry[] = [
    { entry: 1, kind: 'issued', tabId: 1, member: ANN, secretHash: 'h', at: 0, dropped: [] },
    accepted(2, 1, [rename('badge', 'Stored')]),
    accepted(3, 2, [rename('title', 'Stored too')]),
    accepted(4, 3, [rename('no-such-layer', 'Never')]),
    accepted(5, 4, [rename('badge', 'After the bad one')]),
  ]
  return { saved, journal, lastEntry: 5 }
}

describe('storedDesign', () => {
  it('applies the journal as the server does, stopping at the same entry', () => {
    const loaded = rowsWithDeadTail()
    const server = openServer(structuredClone(loaded), { hashSecret: (s) => s })
    const read = storedDesign(loaded)
    expect(server.dead?.entries.map((e) => e.entry)).toEqual([4, 5])
    expect(read.entry).toBe(3)
    expect(read.seq).toBe(server.seq())
    expect(read.design).toEqual(readDesign({ snapshot: () => server.state().toRecords() }))
    expect(read.design.nodes.badge?.name).toBe('Stored')
    expect(read.leftOut).toEqual([])
  })

  it('reads a design with no journal as its folded state', () => {
    const loaded = rowsWithDeadTail()
    loaded.journal = []
    loaded.lastEntry = 0
    expect(storedDesign(loaded)).toMatchObject({ syncId: 's0', entry: 0, seq: 0 })
    expect(storedDesign(loaded).design.nodes.badge?.name).toBe(linkedDesign().nodes.badge?.name)
  })

  it('opens a design stored before sections and connectors with none, and stores it back with its frames as they were', () => {
    const loaded = rowsWithDeadTail()
    loaded.journal = loaded.journal.slice(0, 3)
    loaded.lastEntry = 3
    const stored = structuredClone(loaded.saved.state)
    expect(stored).not.toHaveProperty('sections')
    expect(Object.values(stored.frames as Record<string, object>).some((f) => 'sectionId' in f || 'starred' in f)).toBe(
      false,
    )
    const read = storedDesign(loaded)
    expect([read.design.sections, read.design.connectors]).toEqual([{}, {}])
    expect(read.leftOut).toEqual([])
    // The server folds it back with its frames, pages and meta as stored, and no sections or connectors.
    const saved = openServer(structuredClone(loaded), { hashSecret: (s) => s }).save().state
    expect(Object.keys(saved)).toEqual(['meta', 'pages', 'frames', 'nodes'])
    expect(saved.frames).toEqual(stored.frames)
    expect(read.records.frames).toEqual(stored.frames)
  })
})
