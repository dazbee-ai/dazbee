// A design's stored rows as the API's tests read and write them (D8): its folded state, and change
// sets appended to its journal as the sync server appends them, unfolded.
import { appendRows, createDesignSave, type Db, loadDesignRows } from '@dazbee/db'
import { firstSaved } from '@dazbee/doc/sync'
import { type Change, type Design, type DesignRecords, designRecords, type Entry } from '@dazbee/schema'

/** The member a test's change sets are written by. */
const WRITER = { userId: 'test-writer', workspaceId: 'test-workspace' }

/** The design's folded state, as stored; null when it has none. */
export async function savedState(db: Db, designId: string): Promise<DesignRecords | null> {
  return (await loadDesignRows(db, designId))?.saved.state ?? null
}

/** Stores `design` as the design's first state, as the API's create does. */
export function storeDesign(db: Db, designId: string, design: Design): Promise<void> {
  return createDesignSave(db, designId, firstSaved(designRecords(design), `sync-${designId}`))
}

/** Appends a journal entry after the design's last, as the sync server does. */
export async function appendEntry(
  db: Db,
  designId: string,
  entry: (at: { entry: number; seq: number }) => Entry,
): Promise<void> {
  const rows = await loadDesignRows(db, designId)
  if (!rows) throw new Error(`design ${designId} has no stored rows`)
  const seq = rows.journal.reduce((s, e) => (e.kind === 'accepted' ? e.changeSet.seq : s), rows.saved.seq)
  const result = await appendRows(db, designId, [entry({ entry: rows.lastEntry + 1, seq })], rows.lastEntry)
  if (result !== 'stored') throw new Error(`the append was ${result}`)
}

/** Appends an accepted change set of `changes`, unfolded, as the sync server stores one. */
export function appendAccepted(db: Db, designId: string, changes: Change[]): Promise<void> {
  return appendEntry(db, designId, ({ entry, seq }) => ({
    entry,
    kind: 'accepted',
    member: WRITER,
    changeSet: { seq: seq + 1, author: 1, changeSetId: seq + 1, changes },
    bytes: JSON.stringify(changes).length,
  }))
}
