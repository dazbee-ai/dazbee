// A design's version history in Postgres: adding a version under the keep rules, and the reads and
// changes the API and the sync server make. The keep rules run in the transaction that adds, with the
// design's row locked, so two writers never race past them: at most `VERSION_LIMITS.versions` per
// design and `VERSION_LIMITS.automatic` automatic ones; the oldest automatic one (never `keep`) makes
// room; a named one is never dropped; an automatic one is not added when the newest version holds
// the same sync id and sequence number, but a Before agent one only when the newest is one too. The lock is a no-key update, which a fold's share of the
// design's key passes; an append, which marks the design updated, waits for the version's insert,
// whose bytes are made before the lock is taken. A name or a description past `VERSION_LIMITS` is
// refused.
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { type NewVersion, VERSION_LIMITS, type VersionKind } from '@dazbee/schema'

import { newId } from './ids.ts'
import type { Db } from './index.ts'
import { designs, designVersions, users } from './tables.ts'

/** What adding a version did: added under its id; unchanged since the newest; no room; or the design is gone. */
export type AddedVersion = { id: string } | 'unchanged' | 'full' | 'gone'

/** A version as the history lists it: no records, no picture. */
export interface VersionRow {
  id: string
  kind: VersionKind
  name: string
  description: string
  /** Who named it, and their name; null for an automatic version or a person gone. */
  savedBy: string | null
  savedByName: string | null
  schemaVersion: number
  takenAt: Date
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Adds `version` to the history of design `designId`, under the keep rules. */
export async function addVersion(db: Db, designId: string, version: NewVersion): Promise<AddedVersion> {
  checkWords(version.name, version.description)
  const state = encoder.encode(JSON.stringify(version.records))
  return db.transaction(async (tx): Promise<AddedVersion> => {
    const [design] = await tx
      .select({ id: designs.id })
      .from(designs)
      .where(eq(designs.id, designId))
      .for('no key update')
    if (!design) return 'gone'
    const held = await tx
      .select({
        id: designVersions.id,
        kind: designVersions.kind,
        syncId: designVersions.syncId,
        seq: designVersions.seq,
      })
      .from(designVersions)
      .where(eq(designVersions.designId, designId))
      .orderBy(asc(designVersions.takenAt), asc(designVersions.id))
    const automatic = version.kind !== 'named'
    const newest = held.at(-1)
    if (automatic && newest && sameMoment(newest, version)) return 'unchanged'
    const automatics = held.filter((v) => v.kind !== 'named').length
    let count = held.length
    if ((automatic && automatics >= VERSION_LIMITS.automatic) || count >= VERSION_LIMITS.versions) {
      // Found as it deletes, so a version renamed or deleted meanwhile is passed for the next oldest.
      const dropped = await tx.execute(sql`
        delete from ${designVersions} where ${designVersions.id} = (
          select ${designVersions.id} from ${designVersions}
          where ${designVersions.designId} = ${designId} and ${designVersions.kind} <> 'named'
            and ${designVersions.id} <> ${version.keep ?? ''}
          order by ${designVersions.takenAt}, ${designVersions.id} limit 1)
        returning ${designVersions.id}`)
      count -= dropped.rows.length
    }
    if (count >= VERSION_LIMITS.versions) return 'full'
    const id = newId()
    await tx.insert(designVersions).values({
      id,
      designId,
      kind: version.kind,
      name: version.name,
      description: version.description,
      savedBy: version.savedBy,
      syncId: version.syncId,
      seq: version.seq,
      schemaVersion: version.schemaVersion,
      state,
      // Taken once the lock is held, so the history's order is the order versions were added.
      takenAt: sql`clock_timestamp()`,
    })
    return { id }
  })
}

/** The sync id and sequence number of the design's newest version; null with none. */
export async function newestVersionMark(db: Db, designId: string): Promise<{ syncId: string; seq: number } | null> {
  const [newest] = await db
    .select({ syncId: designVersions.syncId, seq: designVersions.seq })
    .from(designVersions)
    .where(eq(designVersions.designId, designId))
    .orderBy(desc(designVersions.takenAt), desc(designVersions.id))
    .limit(1)
  return newest ?? null
}

/** Every version of the design, newest first, with who named it: no records, no picture. */
export function listVersions(db: Db, designId: string): Promise<VersionRow[]> {
  return db
    .select({
      id: designVersions.id,
      kind: designVersions.kind,
      name: designVersions.name,
      description: designVersions.description,
      savedBy: designVersions.savedBy,
      savedByName: users.name,
      schemaVersion: designVersions.schemaVersion,
      takenAt: designVersions.takenAt,
    })
    .from(designVersions)
    .leftJoin(users, eq(users.id, designVersions.savedBy))
    .where(eq(designVersions.designId, designId))
    .orderBy(desc(designVersions.takenAt), desc(designVersions.id))
}

/** A version's records as stored, their JSON as text, and their schema version; null for none of this design. */
export async function versionRecords(
  db: Db,
  designId: string,
  id: string,
): Promise<{ json: string; schemaVersion: number } | null> {
  const [row] = await db
    .select({ state: designVersions.state, schemaVersion: designVersions.schemaVersion })
    .from(designVersions)
    .where(of(designId, id))
  return row ? { json: decoder.decode(row.state), schemaVersion: row.schemaVersion } : null
}

/**
 * Renames a version, and sets its description when one is given. An automatic version becomes
 * named, by `by`, which keeps it; a named one keeps who named it. False for none of this design.
 */
export async function renameVersion(
  db: Db,
  designId: string,
  id: string,
  { name, description, by }: { name: string; description?: string; by: string },
): Promise<boolean> {
  checkWords(name, description ?? '')
  const renamed = await db
    .update(designVersions)
    .set({
      name,
      ...(description === undefined ? {} : { description }),
      kind: 'named',
      savedBy: sql`case when ${designVersions.kind} = 'named' then ${designVersions.savedBy} else ${by} end`,
    })
    .where(of(designId, id))
    .returning({ id: designVersions.id })
  return renamed.length > 0
}

/** Deletes a version, its picture with it; false for none of this design. */
export async function deleteVersion(db: Db, designId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(designVersions).where(of(designId, id)).returning({ id: designVersions.id })
  return deleted.length > 0
}

/** A version's picture, as PNG bytes; null when it has none yet, or for none of this design. */
export async function versionThumbnail(db: Db, designId: string, id: string): Promise<Uint8Array | null> {
  const [row] = await db.select({ thumbnail: designVersions.thumbnail }).from(designVersions).where(of(designId, id))
  return row?.thumbnail ?? null
}

/** Stores a version's picture; false for none of this design. */
export async function setVersionThumbnail(db: Db, designId: string, id: string, png: Uint8Array): Promise<boolean> {
  const set = await db
    .update(designVersions)
    .set({ thumbnail: png })
    .where(of(designId, id))
    .returning({ id: designVersions.id })
  return set.length > 0
}

/**
 * Whether an automatic version adds nothing to the newest: it holds the same sync id and sequence
 * number, and for a Before agent version it is one too, so one is kept beside an Autosave of that moment.
 */
function sameMoment(newest: { kind: VersionKind; syncId: string; seq: number }, version: NewVersion) {
  if (version.kind === 'beforeAgent' && newest.kind !== 'beforeAgent') return false
  return newest.syncId === version.syncId && newest.seq === version.seq
}

/** Throws for a name or a description past the history's limits. */
function checkWords(name: string, description: string) {
  if (name.length > VERSION_LIMITS.nameChars)
    throw new RangeError(`a version's name is at most ${VERSION_LIMITS.nameChars} characters`)
  if (description.length > VERSION_LIMITS.descriptionChars)
    throw new RangeError(`a version's description is at most ${VERSION_LIMITS.descriptionChars} characters`)
}

/** The version `id` of design `designId`. */
function of(designId: string, id: string) {
  return and(eq(designVersions.designId, designId), eq(designVersions.id, id))
}
