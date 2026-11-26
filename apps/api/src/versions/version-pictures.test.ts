// A version's picture through its route, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`): drawn once, kept in the version's row, gone with it.
import { describe, expect, it, vi } from 'vitest'

import { addVersion } from '@dazbee/db'
import { type DesignInput, DesignSummary, parseDesign, readImageHeader, SCHEMA_VERSION } from '@dazbee/schema'

import { app, authorization, brand, call, db, workspacePath } from '../test-api.ts'

/** How many pictures were drawn, and a wait each draw takes first, when a test sets one. */
const draws = vi.hoisted(() => ({ count: 0, wait: Promise.resolve() }))
vi.mock('../drawing/design-thumbnails.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../drawing/design-thumbnails.ts')>()
  return {
    ...real,
    drawCover: async (...args: Parameters<typeof real.drawCover>) => {
      draws.count++
      await draws.wait
      return real.drawCover(...args)
    },
  }
})

/** A design of one story frame. */
const story: DesignInput = {
  meta: { designId: 'ignored', name: 'ignored' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    st: {
      pageId: 'p1',
      name: 'Story',
      width: 1080,
      height: 1920,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FF48B0FF' }],
      order: 'a0',
    },
  },
  nodes: {},
}

/** A design of brand A with one automatic version holding `records`: its id and the version's. */
async function withVersion(records: unknown) {
  const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Story' })).json)
  const added = await addVersion(db, design.id, {
    kind: 'auto',
    name: '',
    description: '',
    savedBy: null,
    syncId: 'sync',
    seq: 1,
    schemaVersion: SCHEMA_VERSION,
    records: records as never,
    keep: null,
  })
  if (typeof added !== 'object') throw new Error(`not added: ${added}`)
  return { designId: design.id, versionId: added.id }
}

/** The picture route as `as` asks it: the status and the bytes. */
async function picture(as: string, designId: string, versionId: string) {
  const path = `${workspacePath(as)}/brands/${brand.id}/designs/${designId}/versions/${versionId}/thumbnail`
  const response = await app.request(path, { headers: authorization(as) })
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

describe('version pictures', { timeout: 30_000 }, () => {
  it('draws the cover frame once for two requests, at most 320 a side, for a Reviewer too, and keeps it', async () => {
    const parsed = parseDesign(story)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const { designId, versionId } = await withVersion(parsed.design)
    const before = draws.count

    const [first, second] = await Promise.all([picture('a', designId, versionId), picture('r', designId, versionId)])
    const third = await picture('a', designId, versionId)

    expect([first.status, first.type, second.status]).toEqual([200, 'image/png', 200])
    expect(readImageHeader(first.bytes)).toEqual({ contentType: 'image/png', width: 180, height: 320 })
    expect(second.bytes).toEqual(first.bytes)
    expect(third.bytes).toEqual(first.bytes)
    expect(draws.count - before).toBe(1)
  })

  it('draws no section, connector or star: the same picture as the version without them', async () => {
    const frames = story.frames as Record<string, Record<string, unknown>>
    const square = { ...frames.st, name: 'Square', width: 1080, height: 1080, x: 1280, order: 'a1' }
    const plain = { ...story, frames: { st: frames.st, sq: square } }
    const sectioned = {
      ...plain,
      frames: { st: { ...frames.st, sectionId: 'ads', starred: true }, sq: { ...square, sectionId: 'ads' } },
      sections: { ads: { pageId: 'p1', title: 'Ads', order: 'a0' } },
      connectors: {
        one: { pageId: 'p1', from: 'st', to: 'sq', order: 'a0' },
        two: { pageId: 'p1', from: 'ads', to: 'st', order: 'a1' },
      },
    }
    const pictureOf = async (input: unknown) => {
      const parsed = parseDesign(input)
      if (!parsed.success) throw new Error(parsed.errors.join('\n'))
      const { designId, versionId } = await withVersion(parsed.design)
      return (await picture('a', designId, versionId)).bytes
    }
    expect(await pictureOf(sectioned)).toEqual(await pictureOf(plain))
  })

  it('answers a request through another design with no picture, even while the version’s is drawn', async () => {
    const parsed = parseDesign(story)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const { designId, versionId } = await withVersion(parsed.design)
    const other = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Other' })).json)

    let release = () => {}
    draws.wait = new Promise((resolve) => (release = resolve))
    const before = draws.count
    const drawing = picture('a', designId, versionId)
    while (draws.count === before) await new Promise((resolve) => setTimeout(resolve, 5))
    const through = await picture('a', other.id, versionId)
    release()

    expect(through.status).toBe(404)
    expect((await drawing).status).toBe(200)
  })

  it('draws a version without a layer the schema refuses, none for a version with no frame, and none once deleted', async () => {
    const parsed = parseDesign(story)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const bad = { type: 'graphic', parentId: 'st', link: 'bad', index: 'a0', name: 'Bad', props: { x: 'left' } }
    const broken = await withVersion({ ...parsed.design, nodes: { bad } })
    const empty = await withVersion({ ...parsed.design, frames: {} })

    expect((await picture('a', broken.designId, broken.versionId)).status).toBe(200)
    expect((await picture('a', empty.designId, empty.versionId)).status).toBe(404)
    await call('a', 'DELETE', `/brands/${brand.id}/designs/${broken.designId}/versions/${broken.versionId}`)
    expect((await picture('a', broken.designId, broken.versionId)).status).toBe(404)
  })
})
