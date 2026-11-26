// The workspace, brand and design routes, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`).
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { appendRows, designs, loadDesignRows } from '@dazbee/db'
import {
  ApiError,
  BrandSummary,
  designRecords,
  DesignSummary,
  OpenedDesign,
  parseDesign,
  SCHEMA_VERSION,
  SyncToken,
  WorkspaceSummary,
} from '@dazbee/schema'
import { verifySyncToken } from '@dazbee/sync-token'

import {
  app,
  authorization,
  brand,
  call,
  db,
  other,
  otherBrand,
  personA,
  run,
  SHORT_ID,
  sibling,
  syncSecret,
  workspace,
  workspacePath,
} from '../test-api.ts'
import { storedDesign } from './designs.ts'
import { appendAccepted, appendEntry, savedState, storeDesign } from './test-journal.ts'

describe('the workspace', () => {
  it('answers each workspace a person is a member of at its own path, with one session token', async () => {
    const inA = { as: 'both', workspace: workspace.id }
    const inB = { as: 'both', workspace: other.id }
    expect(WorkspaceSummary.parse((await call(inA, 'GET', '')).json)).toEqual(workspace)
    expect(WorkspaceSummary.parse((await call(inB, 'GET', '')).json)).toEqual(other)
    const aBrands = BrandSummary.array().parse((await call(inA, 'GET', '/brands')).json)
    expect(aBrands.map((b) => b.id)).toEqual(expect.arrayContaining([brand.id, sibling.id]))
    expect(aBrands.map((b) => b.id)).not.toContain(otherBrand.id)
    expect(BrandSummary.array().parse((await call(inB, 'GET', '/brands')).json)).toEqual([
      { id: otherBrand.id, name: otherBrand.name },
    ])
    expect((await call(inB, 'GET', `/brands/${otherBrand.id}/designs`)).status).toBe(200)
    expect((await call(inA, 'GET', `/brands/${otherBrand.id}/designs`)).status).toBe(404)
  })

  it('answers a workspace the person is not a member of as if it did not exist', async () => {
    expect(await call({ as: 'a', workspace: other.id }, 'GET', '/brands')).toEqual({
      status: 404,
      json: { error: 'No such workspace' },
    })
  })

  it('answers with the workspace asked for', async () => {
    expect(WorkspaceSummary.parse((await call('a', 'GET', '')).json)).toEqual(workspace)
    expect(WorkspaceSummary.parse((await call('b', 'GET', '')).json)).toEqual(other)
  })

  it('renames that workspace only, trimmed, and refuses an empty name or an empty change', async () => {
    const renamed = await call('b', 'PATCH', '', { name: '  Northwind Studio ' })
    expect(WorkspaceSummary.parse(renamed.json)).toEqual({ ...other, name: 'Northwind Studio' })
    expect(WorkspaceSummary.parse((await call('a', 'GET', '')).json).name).toBe(workspace.name)
    expect((await call('b', 'PATCH', '', { name: '   ' })).status).toBe(400)
    expect((await call('b', 'PATCH', '', {})).status).toBe(400)
    await call('b', 'PATCH', '', { name: other.name })
  })

  it('lets an Owner or Admin rename it, and refuses an Editor', async () => {
    expect(await call('editor', 'PATCH', '', { name: 'Mine now' })).toEqual({
      status: 403,
      json: { error: 'Only an Owner or Admin can do this' },
    })
    try {
      const renamed = await call('admin', 'PATCH', '', { name: 'Agency A2' })
      expect(renamed).toEqual({ status: 200, json: { ...workspace, name: 'Agency A2' } })
    } finally {
      await call('a', 'PATCH', '', { name: workspace.name })
    }
  })
})

describe('designs per brand', () => {
  it('creates, lists and opens a design', async () => {
    const created = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Spring sale' })
    expect(created.status).toBe(201)
    const design = DesignSummary.parse(created.json)
    expect(design).toMatchObject({ brandId: brand.id, name: 'Spring sale' })
    expect(design.id).toMatch(SHORT_ID)

    const listed = await call('a', 'GET', `/brands/${brand.id}/designs`)
    expect(
      DesignSummary.array()
        .parse(listed.json)
        .map((d) => d.id),
    ).toEqual([design.id])

    // Opened, it names the member the session is, whose tab copies the editor takes up (D9).
    const opened = await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}`)
    expect(opened).toEqual({
      status: 200,
      json: OpenedDesign.parse({ ...design, member: { userId: personA.id, workspaceId: workspace.id } }),
    })
  })

  /** The schema version the design's record holds. */
  const versionOf = async (id: string) =>
    (await db.select({ schemaVersion: designs.schemaVersion }).from(designs).where(eq(designs.id, id)))[0]
      ?.schemaVersion

  it('starts a design as one page holding one empty, white 1080×1080 frame, already in the store for the sync server', async () => {
    const { json } = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Blank' })
    const { id } = DesignSummary.parse(json)
    const state = await savedState(db, id)
    expect(state).toEqual({
      meta: { designId: id, name: 'Blank' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: {
        f1: {
          pageId: 'p1',
          name: 'Feed square',
          width: 1080,
          height: 1080,
          x: 0,
          y: 0,
          fills: [{ type: 'solid', color: '#FFFFFFFF' }],
          order: 'a0',
        },
      },
      nodes: {},
    })
    expect(await versionOf(id)).toBe(SCHEMA_VERSION)
    // Its own sync id, at entry 0.
    const rows = await loadDesignRows(db, id)
    expect(rows).toMatchObject({ saved: { entry: 0, seq: 0 }, journal: [], lastEntry: 0 })
    const other = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Two' })).json)
    expect((await loadDesignRows(db, other.id))?.saved.syncId).not.toBe(rows?.saved.syncId)
  })

  it('starts a design from given content, under its own id and name, at the schema version of now', async () => {
    const portrait = (pageId: string) => ({
      pageId,
      name: 'Portrait',
      width: 1080,
      height: 1350,
      x: 0,
      y: 0,
      fills: [],
      order: 'a0',
    })
    const content = {
      meta: { designId: 'ignored', name: 'Ignored', schemaVersion: SCHEMA_VERSION + 1 },
      pages: { p1: { name: 'Card 1', order: 'a0' }, p2: { name: 'Card 2', order: 'a1' } },
      frames: { 'p1-pt': portrait('p1'), 'p2-pt': portrait('p2') },
      nodes: {},
    }
    const { status, json } = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Carousel', content })
    expect(status).toBe(201)
    const { id } = DesignSummary.parse(json)
    expect(await savedState(db, id)).toEqual({
      ...content,
      meta: { designId: id, name: 'Carousel' },
    })
    expect(await versionOf(id)).toBe(SCHEMA_VERSION)
  })

  it('opens, syncs and copies a design whose id is a UUID, the copy under a short id', async () => {
    const id = randomUUID()
    const parsed = parseDesign({
      meta: { designId: id, name: 'Older' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: {},
      nodes: {},
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    await db
      .insert(designs)
      .values({ id, workspaceId: workspace.id, brandId: brand.id, name: 'Older', schemaVersion: SCHEMA_VERSION })
    await storeDesign(db, id, parsed.design)

    const opened = await call('a', 'GET', `/brands/${brand.id}/designs/${id}`)
    expect(opened.status).toBe(200)
    expect(DesignSummary.parse(opened.json)).toMatchObject({ id, name: 'Older' })
    const { token } = SyncToken.parse((await call('a', 'POST', `/brands/${brand.id}/designs/${id}/sync-token`)).json)
    expect(verifySyncToken(syncSecret, token, id)).toMatchObject({ ok: true, payload: { designId: id } })
    const copied = await call('a', 'POST', `/brands/${brand.id}/designs/${id}/duplicate`, {})
    expect(DesignSummary.parse(copied.json).id).toMatch(SHORT_ID)
  })

  it('lists only the asked brand’s designs, newest change first', async () => {
    const first = DesignSummary.parse(
      (await call('a', 'POST', `/brands/${sibling.id}/designs`, { name: 'First' })).json,
    )
    const second = DesignSummary.parse(
      (await call('a', 'POST', `/brands/${sibling.id}/designs`, { name: 'Second' })).json,
    )
    const { json } = await call('a', 'GET', `/brands/${sibling.id}/designs`)
    expect(
      DesignSummary.array()
        .parse(json)
        .map((d) => d.id),
    ).toEqual([second.id, first.id])
  })

  it('lists and creates brands within the workspace only', async () => {
    const created = await call('a', 'POST', '/brands', { name: 'New brand' })
    expect(created.status).toBe(201)
    expect(BrandSummary.parse(created.json).id).toMatch(SHORT_ID)
    const { json } = await call('a', 'GET', '/brands')
    expect(
      BrandSummary.array()
        .parse(json)
        .map((c) => c.name),
    ).toEqual(['Brand A', 'Brand A2', 'New brand'])
    const theirs = await call('b', 'GET', '/brands')
    expect(
      BrandSummary.array()
        .parse(theirs.json)
        .map((c) => c.id),
    ).toEqual([otherBrand.id])
  })
})

describe('refusals', () => {
  it('refuses every route without a session', async () => {
    for (const [method, path] of [
      ['GET', ''],
      ['PATCH', ''],
      ['GET', '/brands'],
      ['POST', '/brands'],
      ['GET', `/brands/${brand.id}/designs`],
      ['POST', `/brands/${brand.id}/designs`],
    ] as const) {
      const response = await call(null, method, path, method === 'GET' ? undefined : { name: 'x' })
      expect(response, `${method} ${path}`).toEqual({ status: 401, json: { error: 'Sign in first' } })
    }
  })

  it('answers another workspace’s brand and design as if they did not exist', async () => {
    const theirs = DesignSummary.parse(
      (await call('b', 'POST', `/brands/${otherBrand.id}/designs`, { name: 'Theirs' })).json,
    )
    expect((await call('a', 'GET', `/brands/${otherBrand.id}/designs`)).status).toBe(404)
    expect((await call('a', 'GET', `/brands/${otherBrand.id}/designs/${theirs.id}`)).status).toBe(404)
    expect((await call('a', 'POST', `/brands/${otherBrand.id}/designs`, { name: 'Sneaky' })).status).toBe(404)
    // The owner still sees it.
    expect((await call('b', 'GET', `/brands/${otherBrand.id}/designs/${theirs.id}`)).status).toBe(200)

    // Every brand route answers "No such brand", for another workspace's brand and for one that doesn't
    // exist, before it reads the body: the empty body would be refused as not valid.
    for (const brandId of [otherBrand.id, `no-such-brand-${run}`]) {
      for (const [method, path] of [
        ['GET', 'designs'],
        ['POST', 'designs'],
        ['GET', `designs/${theirs.id}`],
        ['PATCH', `designs/${theirs.id}`],
        ['DELETE', `designs/${theirs.id}`],
        ['POST', `designs/${theirs.id}/duplicate`],
        ['GET', `designs/${theirs.id}/cover`],
        ['GET', `designs/${theirs.id}/thumbnail`],
        ['POST', `designs/${theirs.id}/sync-token`],
        ['GET', 'assets'],
        ['POST', 'assets/uploads'],
        ['POST', 'assets'],
        ['GET', 'assets/any'],
        ['PATCH', 'assets/any'],
        ['GET', 'assets/any/uses'],
        ['DELETE', 'assets/any'],
        ['GET', 'assets/any/thumbnail'],
        ['GET', 'templates'],
        ['POST', 'templates'],
        ['PATCH', 'templates/any'],
        ['DELETE', 'templates/any'],
        ['GET', 'templates/any/thumbnail'],
        ['POST', 'templates/any/designs'],
        ['GET', 'kit'],
        ['PUT', 'kit'],
        ['GET', 'fonts'],
        ['POST', 'fonts/uploads'],
        ['POST', 'fonts'],
        ['GET', 'fonts/faces/any'],
      ] as const) {
        const response = await call('a', method, `/brands/${brandId}/${path}`, method === 'GET' ? undefined : {})
        expect(response, `${method} /brands/${brandId}/${path}`).toEqual({
          status: 404,
          json: { error: 'No such brand' },
        })
      }
    }
  })

  it('refuses a design opened under another brand of the same workspace', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    const { status, json } = await call('a', 'GET', `/brands/${sibling.id}/designs/${design.id}`)
    expect(status).toBe(404)
    expect(ApiError.parse(json).error).toBe('No such design')
  })

  it('refuses a bad body and a design that is not valid, saying why', async () => {
    const empty = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: '  ' })
    expect(empty.status).toBe(400)
    expect(ApiError.parse(empty.json).error).toMatch(/^name:/)
    const broken = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Broken', content: { meta: {} } })
    expect(broken.status).toBe(400)
    expect(ApiError.parse(broken.json).error).toMatch(/^The design is not valid: /)
    const notJson = await app.request(`${workspacePath('a')}/brands/${brand.id}/designs`, {
      method: 'POST',
      headers: authorization('a'),
      body: '{',
    })
    expect(notJson.status).toBe(400)
  })
})

describe('sync tokens', () => {
  it('issues a token for a design the session may open, good for that design only', async () => {
    const design = DesignSummary.parse(
      (await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Tokened' })).json,
    )
    const { status, json } = await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/sync-token`)
    expect(status).toBe(200)
    const { token, expiresAt, member } = SyncToken.parse(json)
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now())
    expect(member).toEqual({ userId: personA.id, workspaceId: workspace.id })
    expect(verifySyncToken(syncSecret, token, design.id)).toMatchObject({
      ok: true,
      payload: {
        designId: design.id,
        workspaceId: workspace.id,
        userId: personA.id,
        role: 'owner',
        schemaVersion: SCHEMA_VERSION,
      },
    })
    expect(verifySyncToken(syncSecret, token, 'another-design')).toEqual({
      ok: false,
      reason: 'token for another design',
    })
  })

  it('carries the schema version the design’s record holds', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Newer' })).json)
    await db
      .update(designs)
      .set({ schemaVersion: SCHEMA_VERSION + 1 })
      .where(eq(designs.id, design.id))
    const { token } = SyncToken.parse(
      (await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/sync-token`)).json,
    )
    expect(verifySyncToken(syncSecret, token, design.id)).toMatchObject({
      ok: true,
      payload: { schemaVersion: SCHEMA_VERSION + 1 },
    })
  })

  it('carries the role the membership gives, so a Reviewer’s token says so', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Read' })).json)
    const { token } = SyncToken.parse(
      (await call('r', 'POST', `/brands/${brand.id}/designs/${design.id}/sync-token`)).json,
    )
    expect(verifySyncToken(syncSecret, token, design.id)).toMatchObject({ ok: true, payload: { role: 'reviewer' } })
  })

  it("carries the member's name, which the other tabs show; empty for a person who gave none", async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Named' })).json)
    const named = SyncToken.parse((await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/sync-token`)).json)
    expect(verifySyncToken(syncSecret, named.token, design.id)).toMatchObject({
      ok: true,
      payload: { name: 'Ann Archer' },
    })
    const unnamed = SyncToken.parse(
      (await call('r', 'POST', `/brands/${brand.id}/designs/${design.id}/sync-token`)).json,
    )
    expect(verifySyncToken(syncSecret, unnamed.token, design.id)).toMatchObject({ ok: true, payload: { name: '' } })
  })

  it('refuses a person’s session that asks for an agent’s name, and signs none for an empty body or `{}`', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    const path = `/brands/${brand.id}/designs/${design.id}/sync-token`
    expect(await call('a', 'POST', path, { agent: 'Claude Code (agent)' })).toEqual({
      status: 400,
      json: { error: 'Only an agent’s token names an agent' },
    })
    for (const asked of [await call('a', 'POST', path), await call('a', 'POST', path, {})]) {
      const signed = verifySyncToken(syncSecret, SyncToken.parse(asked.json).token, design.id)
      expect(signed.ok && 'agent' in signed.payload).toBe(false)
    }
    expect((await call('a', 'POST', path, 'not an object')).status).toBe(400)
  })

  it('issues none without a session, for another workspace, or under another brand', async () => {
    const mine = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    expect((await call(null, 'POST', `/brands/${brand.id}/designs/${mine.id}/sync-token`)).status).toBe(401)
    expect((await call('b', 'POST', `/brands/${brand.id}/designs/${mine.id}/sync-token`)).status).toBe(404)
    expect((await call('a', 'POST', `/brands/${sibling.id}/designs/${mine.id}/sync-token`)).status).toBe(404)
  })
})

describe('renaming, copying and deleting designs (#159)', () => {
  it('renames, copies and deletes a design of the brand, and nothing of another workspace', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Draft' })).json)
    const renamed = await call('a', 'PATCH', `/brands/${brand.id}/designs/${design.id}`, { name: '  Spring launch ' })
    expect(DesignSummary.parse(renamed.json)).toMatchObject({ id: design.id, name: 'Spring launch' })
    expect((await call('a', 'PATCH', `/brands/${brand.id}/designs/${design.id}`, { name: '  ' })).status).toBe(400)
    expect((await call('b', 'PATCH', `/brands/${brand.id}/designs/${design.id}`, { name: 'Taken' })).status).toBe(404)

    // A copy has the content under its own id, named after the original.
    const copied = await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/duplicate`, {})
    expect(copied.status).toBe(201)
    const copy = DesignSummary.parse(copied.json)
    expect(copy).toMatchObject({ name: 'Spring launch copy', brandId: brand.id })
    expect(copy.id).not.toBe(design.id)
    expect(copy.id).toMatch(SHORT_ID)
    expect((await savedState(db, copy.id))?.meta).toMatchObject({ designId: copy.id, name: 'Spring launch copy' })

    // Deleting takes the design and its stored rows; the copy stays.
    expect((await call('b', 'DELETE', `/brands/${brand.id}/designs/${design.id}`)).status).toBe(404)
    expect((await call('a', 'DELETE', `/brands/${brand.id}/designs/${design.id}`)).status).toBe(204)
    expect((await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}`)).status).toBe(404)
    expect(await savedState(db, design.id)).toBeNull()
    expect((await call('a', 'DELETE', `/brands/${brand.id}/designs/${design.id}`)).status).toBe(404)
    expect((await call('a', 'GET', `/brands/${brand.id}/designs/${copy.id}`)).status).toBe(200)
    // The sync server storing to a deleted design learns it is gone, and stores nothing.
    expect(await appendRows(db, design.id, [], 0)).toBe('gone')
    expect(await savedState(db, design.id)).toBeNull()
  })

  it('copies sections, connectors and stars with the design, and stores none for a design without them', async () => {
    const content = {
      meta: { designId: 'any', name: 'Grouped' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: {
        sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0', sectionId: 's1' },
        wide: { pageId: 'p1', name: 'Wide', width: 200, height: 100, x: 300, y: 0, order: 'a1', starred: true },
      },
      nodes: {},
      sections: { s1: { pageId: 'p1', title: 'Ads', order: 'a0' } },
      connectors: { c1: { pageId: 'p1', from: 's1', to: 'wide', order: 'a0' } },
    }
    const design = DesignSummary.parse(
      (await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Grouped', content })).json,
    )
    const copied = DesignSummary.parse(
      (await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/duplicate`, {})).json,
    )
    const copy = await storedDesign(db, copied.id)
    expect(copy?.sections).toEqual(content.sections)
    expect(copy?.connectors).toEqual(content.connectors)
    expect(copy?.frames.sq?.sectionId).toBe('s1')
    expect(copy?.frames.wide?.starred).toBe(true)
    const plain = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Plain' })).json)
    expect(Object.keys((await savedState(db, plain.id)) ?? {})).toEqual(['meta', 'pages', 'frames', 'nodes'])
  })

  it('copies the original as stored, with the change sets its journal holds since the last fold, up to one that no longer applies', async () => {
    const design = DesignSummary.parse(
      (await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Launch' })).json,
    )
    // The sync server stores an editor's change sets in the journal, unfolded: a second page with
    // its frame, and a layer drawn on the first frame.
    const sun = {
      type: 'graphic',
      parentId: 'f1',
      link: 'sun',
      index: 'a0',
      name: 'Sun',
      props: {
        x: 60,
        y: 60,
        width: 240,
        height: 240,
        shape: { kind: 'ellipse' },
        fills: [{ type: 'solid', color: '#FFC400FF' }],
      },
    }
    await appendAccepted(db, design.id, [
      { op: 'create', part: 'page', id: 'p2', record: { name: 'Page 2', order: 'a1' } },
      {
        op: 'create',
        part: 'frame',
        id: 'story',
        record: { pageId: 'p2', name: 'Story', width: 1080, height: 1920, x: 0, y: 0, fills: [], order: 'a0' },
      },
    ])
    await appendAccepted(db, design.id, [{ op: 'create', part: 'layer', id: 'sun', record: sun }])
    // An entry that no longer follows the one before it: the server opens before it, and so does a reader.
    await appendEntry(db, design.id, ({ entry, seq }) => ({
      entry,
      kind: 'accepted',
      member: { userId: 'test-writer', workspaceId: 'test-workspace' },
      changeSet: {
        seq: seq + 5,
        author: 1,
        changeSetId: 9,
        changes: [{ op: 'set', value: { part: 'layer', id: 'sun', key: 'name' }, to: 'Moon' }],
      },
      bytes: 10,
    }))

    const copied = await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/duplicate`, {})
    const copy = DesignSummary.parse(copied.json)
    const original = await storedDesign(db, design.id)
    if (!original) throw new Error('no original')
    expect(Object.keys(original.pages)).toEqual(['p1', 'p2'])
    expect(original.nodes.sun?.name).toBe('Sun')
    // The copy is folded: its state holds what the original's journal did.
    expect(await savedState(db, copy.id)).toEqual({
      ...designRecords(original),
      meta: { ...original.meta, designId: copy.id, name: 'Launch copy' },
    })
  })
})
