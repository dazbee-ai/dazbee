// A design's version history on Postgres: the keep rules as a version is added, two writers at
// once, and the reads and changes. Runs on the database `DATABASE_URL` names (the compose one
// locally and in CI).
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type NewVersion, SCHEMA_VERSION, VERSION_LIMITS } from '@dazbee/schema'

import { brands, designs, designVersions, migrateDatabase, openDatabase, users, workspaces } from './index.ts'
import {
  addVersion,
  deleteVersion,
  listVersions,
  newestVersionMark,
  renameVersion,
  setVersionThumbnail,
  versionRecords,
  versionThumbnail,
} from './versions.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'
const { db, close } = openDatabase(DATABASE_URL, { max: 8 })
const run = randomUUID().slice(0, 8)
const workspaceId = `workspace-${run}`
const brandId = `brand-${run}`
const ann = { id: `ann-${run}`, workosUserId: `workos-ann-${run}`, email: 'ann@example.com', name: 'Ann' }

beforeAll(async () => {
  await migrateDatabase(db)
  await db.insert(workspaces).values({ id: workspaceId, name: 'Workspace' })
  await db.insert(brands).values({ id: brandId, workspaceId, name: 'Brand' })
  await db.insert(users).values(ann)
})
afterAll(() => close())

/** A design of its own, with no version yet. */
async function newDesign(): Promise<string> {
  const id = `design-${randomUUID()}`
  await db.insert(designs).values({ id, workspaceId, brandId, name: 'D', schemaVersion: SCHEMA_VERSION })
  return id
}

/** A version at sequence number `seq`, automatic unless given a kind. */
function version(seq: number, more: Partial<NewVersion> = {}): NewVersion {
  return {
    kind: 'auto',
    name: '',
    description: '',
    savedBy: null,
    syncId: 'sync-1',
    seq,
    schemaVersion: SCHEMA_VERSION,
    records: { meta: { designId: 'd', name: `at ${seq}` }, pages: {}, frames: {}, nodes: {} },
    keep: null,
    ...more,
  }
}

const named = (seq: number) => version(seq, { kind: 'named', name: `Named ${seq}`, savedBy: ann.id })

/** Stores each version, oldest first, a second apart, as adding them in turn would; the ids stored. */
async function addAll(designId: string, versions: NewVersion[]): Promise<string[]> {
  const rows = versions.map((v, at) => ({
    id: `${designId}-${at}`,
    designId,
    kind: v.kind,
    name: v.name,
    description: v.description,
    savedBy: v.savedBy,
    syncId: v.syncId,
    seq: v.seq,
    schemaVersion: v.schemaVersion,
    state: new TextEncoder().encode(JSON.stringify(v.records)),
    takenAt: new Date(Date.UTC(2026, 0, 1) + at * 1000),
  }))
  if (rows.length > 0) await db.insert(designVersions).values(rows)
  return rows.map((row) => row.id)
}

/** The sequence numbers of the design's versions, lowest first. */
const seqs = async (designId: string) =>
  (await db.select({ seq: designVersions.seq }).from(designVersions).where(eq(designVersions.designId, designId)))
    .map((v) => v.seq)
    .sort((a, b) => a - b)

describe('addVersion', () => {
  it('drops the oldest automatic version for the 21st, never a named one', async () => {
    const id = await newDesign()
    await addAll(id, [named(0), ...Array.from({ length: VERSION_LIMITS.automatic }, (_, n) => version(n + 1))])

    expect(await addVersion(db, id, version(21))).toMatchObject({ id: expect.any(String) })

    const after = await seqs(id)
    expect(after).toHaveLength(VERSION_LIMITS.automatic + 1)
    expect(after).toEqual([0, ...Array.from({ length: VERSION_LIMITS.automatic }, (_, n) => n + 2)])
  })

  it('drops the oldest automatic one for the 101st, or answers full when every version is named', async () => {
    const id = await newDesign()
    const all = Array.from({ length: VERSION_LIMITS.versions }, (_, n) => (n < 3 ? version(n) : named(n)))
    await addAll(id, all)
    expect(await addVersion(db, id, named(100))).toMatchObject({ id: expect.any(String) })
    expect((await seqs(id))[0]).toBe(1)

    const full = await newDesign()
    await addAll(
      full,
      Array.from({ length: VERSION_LIMITS.versions }, (_, n) => named(n)),
    )
    expect(await addVersion(db, full, named(100))).toBe('full')
    expect(await addVersion(db, full, version(101))).toBe('full')
    expect(await seqs(full)).toHaveLength(VERSION_LIMITS.versions)
  })

  it('skips an automatic version of the design as its newest version holds it, but adds a named one', async () => {
    const id = await newDesign()
    await addAll(id, [version(4)])
    expect(await addVersion(db, id, version(4))).toBe('unchanged')
    expect(await addVersion(db, id, version(4, { syncId: 'sync-2' }))).toMatchObject({ id: expect.any(String) })
    expect(await addVersion(db, id, named(4))).toMatchObject({ id: expect.any(String) })
    expect(await newestVersionMark(db, id)).toEqual({ syncId: 'sync-1', seq: 4 })
    expect(await newestVersionMark(db, await newDesign())).toBeNull()
  })

  it('adds a Before agent version at the moment of the newest version of another kind, but not of its own', async () => {
    const id = await newDesign()
    await addAll(id, [version(4)])
    const beforeAgent = version(4, { kind: 'beforeAgent', name: 'Claude (agent)' })
    expect(await addVersion(db, id, beforeAgent)).toMatchObject({ id: expect.any(String) })
    expect(await addVersion(db, id, beforeAgent)).toBe('unchanged')
    expect((await listVersions(db, id)).map((v) => [v.kind, v.name])).toEqual([
      ['beforeAgent', 'Claude (agent)'],
      ['auto', ''],
    ])

    const autosaved = await newDesign()
    await addAll(autosaved, [version(4)])
    expect(await addVersion(db, autosaved, version(4))).toBe('unchanged')
  })

  it('never drops the version it is told to keep: the next oldest automatic one goes', async () => {
    const id = await newDesign()
    const [first] = await addAll(
      id,
      Array.from({ length: VERSION_LIMITS.automatic }, (_, n) => version(n)),
    )

    await addVersion(db, id, version(50, { kind: 'beforeRestore', keep: first ?? null }))

    const after = await seqs(id)
    expect(after.slice(0, 2)).toEqual([0, 2])
  })

  it('keeps to the limits when two writers add at once', async () => {
    const id = await newDesign()
    await addAll(
      id,
      Array.from({ length: VERSION_LIMITS.automatic - 1 }, (_, n) => version(n)),
    )

    await Promise.all([addVersion(db, id, version(100)), addVersion(db, id, version(101))])

    expect(await seqs(id)).toHaveLength(VERSION_LIMITS.automatic)
  })

  it('never drops an automatic version once renamed, and refuses a name past the limit', async () => {
    const id = await newDesign()
    const [first] = await addAll(
      id,
      Array.from({ length: VERSION_LIMITS.automatic }, (_, n) => version(n)),
    )
    await renameVersion(db, id, first as string, { name: 'Kept', by: ann.id })

    await addVersion(db, id, version(50))

    expect((await listVersions(db, id)).find((v) => v.id === first)?.kind).toBe('named')
    await expect(addVersion(db, id, { ...named(1), name: 'x'.repeat(201) })).rejects.toThrow(/at most 200/)
  })

  it('answers gone for a design that is not there', async () => {
    expect(await addVersion(db, 'no-such-design', version(1))).toBe('gone')
  })
})

describe('a version’s reads and changes', () => {
  it('lists newest first with who named it, and no records or picture', async () => {
    const id = await newDesign()
    await addAll(id, [version(1), named(2)])

    const listed = await listVersions(db, id)

    expect(listed.map((v) => [v.kind, v.name, v.savedByName])).toEqual([
      ['named', 'Named 2', 'Ann'],
      ['auto', '', null],
    ])
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(
      ['description', 'id', 'kind', 'name', 'savedBy', 'savedByName', 'schemaVersion', 'takenAt'].sort(),
    )
  })

  it('renames an automatic version into a named one by who renamed it; a named one keeps who named it', async () => {
    const id = await newDesign()
    const [auto, kept] = await addAll(id, [version(1), named(2)])

    expect(await renameVersion(db, id, auto as string, { name: 'Good one', description: 'Keep', by: ann.id })).toBe(
      true,
    )
    expect(await renameVersion(db, id, kept as string, { name: 'Renamed', by: 'nobody' })).toBe(true)

    expect((await listVersions(db, id)).map((v) => [v.kind, v.name, v.description, v.savedBy])).toEqual([
      ['named', 'Renamed', '', ann.id],
      ['named', 'Good one', 'Keep', ann.id],
    ])
  })

  it('reads, draws and deletes a version of its own design only', async () => {
    const id = await newDesign()
    const other = await newDesign()
    const [v] = await addAll(id, [version(7)])
    const vid = v as string

    expect(await versionRecords(db, id, vid)).toEqual({
      json: JSON.stringify(version(7).records),
      schemaVersion: SCHEMA_VERSION,
    })
    expect(await versionRecords(db, other, vid)).toBeNull()
    expect(await versionThumbnail(db, id, vid)).toBeNull()
    expect(await setVersionThumbnail(db, other, vid, new Uint8Array([1]))).toBe(false)
    expect(await setVersionThumbnail(db, id, vid, new Uint8Array([1, 2, 3]))).toBe(true)
    expect(await versionThumbnail(db, id, vid)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await renameVersion(db, other, vid, { name: 'x', by: ann.id })).toBe(false)
    expect(await deleteVersion(db, other, vid)).toBe(false)
    expect(await deleteVersion(db, id, vid)).toBe(true)
    expect(await deleteVersion(db, id, vid)).toBe(false)
  })

  it('goes with its design, picture included', async () => {
    const id = await newDesign()
    const [v] = await addAll(id, [version(1)])
    await setVersionThumbnail(db, id, v as string, new Uint8Array([9]))

    await db.delete(designs).where(eq(designs.id, id))

    expect(await db.select().from(designVersions).where(eq(designVersions.designId, id))).toEqual([])
  })
})
