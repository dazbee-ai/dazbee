// A design's version history through the API, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`): who may list, save, rename, delete and copy a version,
// and what each stores.
import { describe, expect, it } from 'vitest'

import { addVersion, designVersions, loadDesignRows } from '@dazbee/db'
import {
  type DesignInput,
  DesignSummary,
  type NewVersion,
  parseDesign,
  SCHEMA_VERSION,
  VERSION_LIMITS,
  VersionSummary,
} from '@dazbee/schema'

import { brand, call, db, otherBrand, sibling } from '../test-api.ts'

/** A design of one page and one square frame holding a box named `box`. */
const content = (boxName = 'Box'): DesignInput => ({
  meta: { designId: 'ignored', name: 'ignored' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
  },
  nodes: {
    box: {
      type: 'graphic',
      parentId: 'sq',
      link: 'box',
      index: 'a0',
      name: boxName,
      props: { x: 10, y: 10, width: 100, height: 100, shape: { kind: 'rect' } },
    },
  },
})

const versions = (designId: string) => `/brands/${brand.id}/designs/${designId}/versions`

/** A design of brand A, made as `a` (its owner). */
async function newDesign(name = 'Spring sale', boxName?: string) {
  const made = await call('a', 'POST', `/brands/${brand.id}/designs`, { name, content: content(boxName) })
  return DesignSummary.parse(made.json)
}

/** An automatic version of the design, at a place in its history no named one holds. */
function auto(seq: number, records = parsed(content('Autosaved'))): NewVersion {
  return {
    kind: 'auto',
    name: '',
    description: '',
    savedBy: null,
    syncId: 'elsewhere',
    seq,
    schemaVersion: SCHEMA_VERSION,
    records,
    keep: null,
  }
}

function parsed(input: DesignInput) {
  const result = parseDesign(input)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

const listOf = async (as: string, designId: string) =>
  VersionSummary.array().parse((await call(as, 'GET', versions(designId))).json)

describe('the version history', () => {
  it('saves a named version, "Version N" when the name is empty, and lists newest first with who named it', async () => {
    const design = await newDesign()
    const first = await call('a', 'POST', versions(design.id), { name: '' })
    expect(first.status).toBe(201)
    await addVersion(db, design.id, auto(9))
    const second = await call('a', 'POST', versions(design.id), { name: '  Sent to client ', description: 'Round 2' })

    expect(VersionSummary.parse(first.json)).toMatchObject({ kind: 'named', name: 'Version 1', savedBy: 'Ann Archer' })
    expect(VersionSummary.parse(second.json)).toMatchObject({ name: 'Sent to client', description: 'Round 2' })
    expect((await listOf('a', design.id)).map((v) => [v.kind, v.name, v.savedBy])).toEqual([
      ['named', 'Sent to client', 'Ann Archer'],
      ['auto', '', null],
      ['named', 'Version 1', 'Ann Archer'],
    ])
  })

  it('records the stored design’s place, so an Autosave of it unchanged is skipped', async () => {
    const design = await newDesign()
    await call('a', 'POST', versions(design.id), { name: 'Kept' })
    const rows = await loadDesignRows(db, design.id)

    const again = await addVersion(db, design.id, { ...auto(rows?.saved.seq ?? -1), syncId: rows?.saved.syncId ?? '' })

    expect(again).toBe('unchanged')
  })

  it('answers 409 with the history-full words when every version is named', async () => {
    const design = await newDesign()
    const full: (typeof designVersions.$inferInsert)[] = Array.from({ length: VERSION_LIMITS.versions }, (_, n) => ({
      id: `${design.id}-${n}`,
      designId: design.id,
      kind: 'named',
      name: `Named ${n}`,
      syncId: 'sync',
      seq: n,
      schemaVersion: SCHEMA_VERSION,
      state: new TextEncoder().encode('{}'),
    }))
    await db.insert(designVersions).values(full)

    expect(await call('a', 'POST', versions(design.id), { name: 'One more' })).toEqual({
      status: 409,
      json: { error: 'The version history is full. Delete a version to save another.' },
    })
  })

  it('renames an automatic version into a named one by the renamer, refusing an empty name, and deletes one', async () => {
    const design = await newDesign()
    const added = await addVersion(db, design.id, auto(3))
    const id = typeof added === 'object' ? added.id : ''

    expect((await call('a', 'PATCH', `${versions(design.id)}/${id}`, { name: '   ' })).status).toBe(400)
    const renamed = await call('a', 'PATCH', `${versions(design.id)}/${id}`, { name: 'Good one', description: 'Why' })
    expect(VersionSummary.parse(renamed.json)).toMatchObject({
      kind: 'named',
      name: 'Good one',
      description: 'Why',
      savedBy: 'Ann Archer',
    })
    expect((await call('a', 'DELETE', `${versions(design.id)}/${id}`)).status).toBe(204)
    expect(await listOf('a', design.id)).toEqual([])
    expect((await call('a', 'DELETE', `${versions(design.id)}/${id}`)).status).toBe(404)
  })

  it('opens a version as a copy: a design of the brand with its records, named after the design and the version', async () => {
    const design = await newDesign('Spring sale', 'Then')
    const named = VersionSummary.parse((await call('a', 'POST', versions(design.id), { name: 'Sent' })).json)
    const records = parsed(content('Autosaved'))
    // A layer this schema refuses: the copy leaves it out.
    const broken = { ...records, nodes: { ...records.nodes, bad: { ...records.nodes.box, props: { x: 'left' } } } }
    const added = await addVersion(db, design.id, auto(4, broken as never))
    const autoId = typeof added === 'object' ? added.id : ''

    const fromNamed = DesignSummary.parse((await call('a', 'POST', `${versions(design.id)}/${named.id}/copy`, {})).json)
    const fromAuto = await call('a', 'POST', `${versions(design.id)}/${autoId}/copy`, {})
    const given = await call('a', 'POST', `${versions(design.id)}/${named.id}/copy`, { name: 'Mine' })

    expect(fromNamed).toMatchObject({ brandId: brand.id, name: 'Spring sale (Sent)' })
    expect(DesignSummary.parse(fromAuto.json).name).toBe('Spring sale (Autosave)')
    expect(DesignSummary.parse(given.json).name).toBe('Mine')
    const copied = (await loadDesignRows(db, DesignSummary.parse(fromAuto.json).id))?.saved.state
    expect(Object.keys(copied?.nodes ?? {})).toEqual(['box'])
    expect((copied?.nodes.box as { name: string }).name).toBe('Autosaved')
    expect(await listOf('a', fromNamed.id)).toEqual([])
  })

  it('names a copy of a Before agent version with the agent’s name, or Before agent when it has none', async () => {
    const design = await newDesign('Spring sale')
    const ids = []
    for (const [seq, name] of [
      [5, 'Claude (agent)'],
      [6, ''],
    ] as const) {
      const added = await addVersion(db, design.id, { ...auto(seq), kind: 'beforeAgent', name })
      ids.push(typeof added === 'object' ? added.id : '')
    }

    const copies = []
    for (const id of ids) copies.push(await call('a', 'POST', `${versions(design.id)}/${id}/copy`, {}))

    expect(copies.map((copy) => DesignSummary.parse(copy.json).name)).toEqual([
      'Spring sale (Before Claude (agent))',
      'Spring sale (Before agent)',
    ])
  })

  it('lets a Reviewer list a design’s versions and nothing more', async () => {
    const design = await newDesign()
    const id = VersionSummary.parse((await call('a', 'POST', versions(design.id), { name: 'Kept' })).json).id

    expect((await call('r', 'GET', versions(design.id))).status).toBe(200)
    const refused = [
      await call('r', 'POST', versions(design.id), { name: 'Mine' }),
      await call('r', 'PATCH', `${versions(design.id)}/${id}`, { name: 'Mine' }),
      await call('r', 'DELETE', `${versions(design.id)}/${id}`),
      await call('r', 'POST', `${versions(design.id)}/${id}/copy`, {}),
    ]
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403, 403])
    expect(refused[0]?.json).toEqual({ error: 'Only an Owner, Admin or Editor can do this' })
    expect((await listOf('a', design.id)).map((v) => v.name)).toEqual(['Kept'])
  })

  it('answers 404 for a design or version of another brand or workspace, on every route', async () => {
    const design = await newDesign()
    const id = VersionSummary.parse((await call('a', 'POST', versions(design.id), { name: 'Kept' })).json).id
    const other = await newDesign('Other')
    const elsewhere = [
      ['a', `/brands/${sibling.id}/designs/${design.id}/versions`],
      ['b', `/brands/${otherBrand.id}/designs/${design.id}/versions`],
    ] as const
    for (const [as, path] of elsewhere) {
      const answers = [
        await call(as, 'GET', path),
        await call(as, 'POST', path, { name: 'x' }),
        await call(as, 'PATCH', `${path}/${id}`, { name: 'x' }),
        await call(as, 'DELETE', `${path}/${id}`),
        await call(as, 'POST', `${path}/${id}/copy`, {}),
        await call(as, 'GET', `${path}/${id}/thumbnail`),
      ]
      expect(answers.map((a) => a.status)).toEqual([404, 404, 404, 404, 404, 404])
    }
    // Another design's version, through this design.
    const answers = [
      await call('a', 'PATCH', `${versions(other.id)}/${id}`, { name: 'x' }),
      await call('a', 'DELETE', `${versions(other.id)}/${id}`),
      await call('a', 'POST', `${versions(other.id)}/${id}/copy`, {}),
      await call('a', 'GET', `${versions(other.id)}/${id}/thumbnail`),
    ]
    expect(answers.map((a) => a.status)).toEqual([404, 404, 404, 404])
  })
})
