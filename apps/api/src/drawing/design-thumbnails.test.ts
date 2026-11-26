// A design's picture through its route, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`).
import { describe, expect, it } from 'vitest'

import { restyledTestFont } from '@dazbee/fonts/test-fonts'
import { DesignSummary, DesignThumbnail, parseDesign, readImageHeader } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { brand, call, db, run, sibling, storage, workspace } from '../test-api.ts'
import { fontFile } from '../test-files.ts'
import { appendAccepted } from '../workspace/test-journal.ts'
import { drawCover, ensureDesignThumbnail } from './design-thumbnails.ts'
import { HUGE_FACE_BYTES, uploadHugeFamily } from './test-huge-family.ts'

// A design's picture for the home's bento (#84), drawn with CanvasKit like an export.
describe('design thumbnails', { timeout: 30_000 }, () => {
  /**
   * A first page with no frame, then a page whose first frame by order is a story, listed after a
   * square: the cover frame is the story.
   */
  const story = (color: string) => ({
    meta: { designId: 'ignored', name: 'Story' },
    pages: { p1: { name: 'Empty', order: 'a0' }, p2: { name: 'Page 2', order: 'a1' } },
    frames: {
      sq: {
        pageId: 'p2',
        name: 'Square',
        width: 1080,
        height: 1080,
        x: 1280,
        y: 0,
        fills: [{ type: 'solid', color }],
        order: 'a1',
      },
      st: {
        pageId: 'p2',
        name: 'Story',
        width: 1080,
        height: 1920,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color }],
        order: 'a0',
      },
    },
    nodes: {},
  })
  const keyOf = (url: string) => new URL(url).pathname

  it('draws the cover frame, at most 640 a side, once per version', async () => {
    const { json } = await call('a', 'POST', `/brands/${brand.id}/designs`, {
      name: 'Story',
      content: story('#FF48B0FF'),
    })
    const design = DesignSummary.parse(json)
    const first = DesignThumbnail.parse(
      (await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).json,
    )
    // The cover frame's own size, so a tile can be tall before the picture loads.
    expect([first.width, first.height]).toEqual([1080, 1920])
    expect((await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/cover`)).json).toEqual({
      width: 1080,
      height: 1920,
    })
    const bytes = new Uint8Array(await (await fetch(first.url)).arrayBuffer())
    expect(readImageHeader(bytes)).toEqual({ contentType: 'image/png', width: 360, height: 640 })
    // Asked again, the same stored picture.
    const again = DesignThumbnail.parse(
      (await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).json,
    )
    expect(keyOf(again.url)).toBe(keyOf(first.url))
    // Once the design changes, a new one: a change set the sync server appends, not folded yet.
    await appendAccepted(db, design.id, [
      { op: 'set', value: { part: 'frame', id: 'st', key: 'fills' }, to: [{ type: 'solid', color: '#3D6BFFFF' }] },
    ])
    const changed = DesignThumbnail.parse(
      (await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).json,
    )
    expect(keyOf(changed.url)).not.toBe(keyOf(first.url))
  })

  it('draws no section, connector or star: the same picture as the design without them', async () => {
    const plain = story('#22AA66FF')
    const sectioned = {
      ...plain,
      frames: {
        sq: { ...plain.frames.sq, sectionId: 'ads' },
        st: { ...plain.frames.st, sectionId: 'ads', starred: true },
      },
      sections: { ads: { pageId: 'p2', title: 'Ads', order: 'a0' } },
      connectors: {
        one: { pageId: 'p2', from: 'st', to: 'sq', order: 'a0' },
        two: { pageId: 'p2', from: 'ads', to: 'sq', order: 'a1' },
      },
    }
    const pictureOf = async (content: unknown) => {
      const { json } = await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Story', content })
      const { id } = DesignSummary.parse(json)
      const { url } = DesignThumbnail.parse(
        (await call('a', 'GET', `/brands/${brand.id}/designs/${id}/thumbnail`)).json,
      )
      return new Uint8Array(await (await fetch(url)).arrayBuffer())
    }
    expect(await pictureOf(sectioned)).toEqual(await pictureOf(plain))
  })

  it('moves the font bytes to the drawing thread instead of copying them', async () => {
    const parsed = parseDesign(story('#FF48B0FF'))
    if (!parsed.success) throw new Error('the story fixture is a design')
    const font = { family: 'Noto Sans', bytes: fontFile('NotoSans-Regular.ttf') }
    const png = await drawCover(parsed.design, { frameId: 'st', width: 1080, height: 1920 }, 64, {
      fonts: [font],
      fallbackFamilies: [],
      images: {},
    })
    expect(readImageHeader(png)).toMatchObject({ contentType: 'image/png', height: 64 })
    expect(font.bytes.byteLength).toBe(0)
  })

  it("keeps a design's picture to its brand and workspace", async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Mine' })).json)
    expect((await call('a', 'GET', `/brands/${sibling.id}/designs/${design.id}/thumbnail`)).status).toBe(404)
    expect((await call('b', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).status).toBe(404)
  })

  it('has no picture or cover for a design with no frame on any page', async () => {
    const content = { meta: { designId: 'ignored', name: 'Empty' }, pages: { p1: { name: 'Page 1', order: 'a0' } } }
    const design = DesignSummary.parse(
      (
        await call('a', 'POST', `/brands/${brand.id}/designs`, {
          name: 'Empty',
          content: { ...content, frames: {}, nodes: {} },
        })
      ).json,
    )
    const nothing = { error: 'This design has nothing to show yet' }
    expect(await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/thumbnail`)).toEqual({
      status: 404,
      json: nothing,
    })
    expect(await call('a', 'GET', `/brands/${brand.id}/designs/${design.id}/cover`)).toEqual({
      status: 404,
      json: nothing,
    })
  })
})

// A design set in one of the largest CJK families must fit the API's 512 MB: its picture reads only
// the faces its texts use, and pictures asked for at once read their files one picture at a time.
describe('the memory a design picture takes', { timeout: 180_000 }, () => {
  /** A design of one square frame with one text in `family` at `weight`. */
  const oneText = (family: string, weight: number) => ({
    meta: { designId: 'ignored', name: `Huge ${weight}` },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {
      sq: { pageId: 'p1', name: 'Square', width: 400, height: 400, x: 0, y: 0, order: 'a0' },
    },
    nodes: {
      t: {
        type: 'text',
        parentId: 'sq',
        link: 't',
        index: 'a0',
        name: 'Words',
        props: {
          ...{ x: 10, y: 10, width: 380, height: 100, text: 'Hamburgefonstiv' },
          style: { fontFamily: family, fontSize: 40, fontWeight: weight, color: '#000000FF' },
        },
      },
    },
  })

  it('keeps no picture’s CJK-sized faces once the next is drawn', async () => {
    const parsed = parseDesign(oneText('Huge', 400))
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const cover = { frameId: 'sq', width: 400, height: 400 }
    const font = () => restyledTestFont(fontFile('NotoSans-Regular.ttf'), { padding: HUGE_FACE_BYTES })
    let most = 0
    const watch = setInterval(() => (most = Math.max(most, process.memoryUsage().rss)), 5)
    const before = process.memoryUsage().rss
    try {
      // Six pictures, each with its own copy of a 50 MB face, as six designs' pictures read them.
      for (let i = 0; i < 6; i++)
        await drawCover(parsed.design, cover, 64, {
          fonts: [{ family: 'Huge', bytes: font() }],
          fallbackFamilies: [],
          images: {},
        })
    } finally {
      clearInterval(watch)
    }
    // Kept, each face's file would stay twice, in JavaScript and in CanvasKit: 600 MB.
    expect(most - before).toBeLessThan(400 * 1024 * 1024)
  })

  it('reads one face of a family of CJK-sized faces, and draws two pictures one after the other', async () => {
    const family = `Huge ${run}`
    const keys = await uploadHugeFamily(storage, workspace.id, brand.id, family)
    const faceOf = new Map([...keys].map(([face, key]) => [key, face]))
    /** What happened, in order: a face's file read, or a picture stored. */
    const events: string[] = []
    const reads = new Map<string, number>()
    const watched: Storage = {
      ...storage,
      get: async (key) => {
        const bytes = await storage.get(key)
        const face = faceOf.get(key)
        if (bytes && face) {
          events.push(`read ${face}`)
          reads.set(face, (reads.get(face) ?? 0) + bytes.length)
        }
        return bytes
      },
      put: async (key, bytes, type) => {
        if (key.includes('/thumbnail-')) events.push('stored')
        return storage.put(key, bytes, type)
      },
    }
    const [regular, bold] = await Promise.all(
      [400, 700].map(async (weight) =>
        DesignSummary.parse(
          (await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Huge', content: oneText(family, weight) }))
            .json,
        ),
      ),
    )
    if (!regular || !bold) throw new Error('no designs')
    await Promise.all([
      ensureDesignThumbnail(db, watched, workspace.id, regular),
      ensureDesignThumbnail(db, watched, workspace.id, bold),
    ])
    expect([...reads.keys()].sort()).toEqual(['400 normal', '700 normal'])
    for (const bytes of reads.values()) expect(bytes).toBeLessThan(HUGE_FACE_BYTES + 1024 * 1024)
    // Each picture's face is read only once the picture before it is stored.
    expect(events.map((event) => event.replace(/\d+/, 'n'))).toEqual([
      'read n normal',
      'stored',
      'read n normal',
      'stored',
    ])
  })
})
