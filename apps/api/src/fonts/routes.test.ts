// The font routes, against Postgres from Docker Compose (`docker compose up -d --wait postgres`).
import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { fontFaces, newId } from '@dazbee/db'
import { MATCH_COPY_VERSION } from '@dazbee/fonts'
import { GOOGLE_FONTS } from '@dazbee/fonts/google'
import { matchCopy } from '@dazbee/fonts/match-copy'
import { variableTestFont } from '@dazbee/fonts/test-fonts'
import {
  brandCatalog,
  FontCatalogParts,
  FontFace,
  FontFamily,
  FontLink,
  FontUploadTicket,
  GOOGLE_MATCH_PATH,
  googleFacePaths,
  googleFontListPath,
} from '@dazbee/schema'

import { app, brand, call, db, otherBrand, run, SHORT_ID, sibling, storage, workspace } from '../test-api.ts'
import { fakeGoogleFonts, fontFile, googleFamily, sha256 } from '../test-files.ts'
import { fontPreview } from './font-file.ts'
import { fontFiles, lastGoogleFontList } from './fonts.ts'
import { importGoogleFamily } from './google.ts'
import { googleFontRoutes } from './routes.ts'

// Recording a font draws its preview with CanvasKit, which takes seconds on a busy two-core CI runner.
describe('fonts', { timeout: 30_000 }, () => {
  const regular = fontFile('NotoSans-Regular.ttf')
  const bold = fontFile('NotoSans-Bold.ttf')
  /** A stand-in Google family of the Noto files, served by a fake google/fonts, removed after the run. */
  const google = googleFamily(`Test Sans ${run}`, [
    { file: 'TestSans-Regular.ttf', bytes: regular, weight: 400 },
    { file: 'TestSans-Bold.ttf', bytes: bold, weight: 700 },
  ])

  afterAll(async () => {
    await db.delete(fontFaces).where(eq(fontFaces.family, google.family))
    await db.delete(fontFaces).where(eq(fontFaces.family, 'Vary Sans'))
  })

  async function upload(as: string, brandId: string, bytes: Uint8Array) {
    const ticket = FontUploadTicket.parse(
      (
        await call(as, 'POST', `/brands/${brandId}/fonts/uploads`, {
          sha256: sha256(bytes),
          byteSize: bytes.length,
          contentType: 'font/ttf',
        })
      ).json,
    )
    if (ticket.face) return { face: ticket.face, uploaded: false }
    expect(
      (await fetch(ticket.upload.url, { method: 'PUT', body: bytes, headers: ticket.upload.headers })).status,
    ).toBe(200)
    const recorded = await call(as, 'POST', `/brands/${brandId}/fonts`, { sha256: sha256(bytes) })
    expect(recorded.status).toBe(201)
    return { face: FontFace.parse(recorded.json), uploaded: true }
  }

  /** The brand's catalog in its two parts, as `as` asks for it. */
  async function catalogOf(as: string, brandId: string) {
    const answer = await call(as, 'GET', `/brands/${brandId}/fonts/catalog`)
    expect(answer.status).toBe(200)
    return FontCatalogParts.parse(answer.json)
  }

  /** What `read` gives while the Google faces stay the same, which other files' tests change at the same time. */
  async function whileGoogleFacesStay<T>(read: () => Promise<T>): Promise<T> {
    for (let tries = 1; ; tries += 1) {
      const before = (await catalogOf('a', brand.id)).google
      const result = await read()
      if ((await catalogOf('a', brand.id)).google === before || tries === 5) return result
    }
  }

  /** Our storage, naming no size of what it holds, as when it compresses what it sends. */
  const unsized = {
    ...storage,
    stream: async (key: string) => {
      const stored = await storage.stream(key)
      return stored && { ...stored, byteSize: null }
    },
  }

  /** The id of the stand-in Google family's face of this weight, once copied. */
  async function googleFaceId(weight: number) {
    const [row] = await db
      .select({ id: fontFaces.id })
      .from(fontFaces)
      .where(and(eq(fontFaces.family, google.family), eq(fontFaces.weight, weight)))
    if (!row) throw new Error(`${google.family} ${weight} was not copied`)
    return row.id
  }

  it('copies a Google family into our storage once, and every brand lists it', async () => {
    const { get } = fakeGoogleFonts(google)
    expect(await importGoogleFamily(db, storage, google, { copied: new Map(), get })).toMatchObject({ copied: 2 })
    const stored = await db.select({ id: fontFaces.id }).from(fontFaces).where(eq(fontFaces.family, google.family))
    expect(stored.map((f) => f.id)).toEqual([expect.stringMatching(SHORT_ID), expect.stringMatching(SHORT_ID)])
    for (const [as, brandId] of [
      ['a', brand.id],
      ['b', otherBrand.id],
    ] as const) {
      const catalog = FontFamily.array().parse((await call(as, 'GET', `/brands/${brandId}/fonts`)).json)
      expect(catalog.find((f) => f.family === google.family)).toMatchObject({
        source: 'google',
        category: 'sans-serif',
        faces: [
          { weight: 400, style: 'normal', source: 'google', byteSize: regular.length },
          { weight: 700, style: 'normal', source: 'google', byteSize: bold.length },
        ],
      })
    }
  })

  it('serves a Google face’s file and preview to anyone, at addresses kept for good', async () => {
    const id = await googleFaceId(400)
    const file = await app.request(`/fonts/google/faces/${id}.ttf`)
    expect(file.status).toBe(200)
    expect(Object.fromEntries(file.headers)).toMatchObject({
      'content-type': 'font/ttf',
      'content-length': String(regular.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    })
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(regular)

    const preview = await app.request(`/fonts/google/faces/${id}.png`)
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/png')
    expect(preview.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect([...new Uint8Array(await preview.arrayBuffer()).subarray(1, 4)]).toEqual([
      ...new TextEncoder().encode('PNG'),
    ])
  })

  it('serves a face’s whole file when storage names no size, as when it compresses what it sends', async () => {
    const id = await googleFaceId(400)
    const file = await googleFontRoutes({ db, storage: unsized }).request(`/fonts/google/faces/${id}.ttf`)
    expect(file.headers.get('content-length')).toBe(String(regular.length))
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(regular)
    const preview = await googleFontRoutes({ db, storage: unsized }).request(`/fonts/google/faces/${id}.png`)
    expect(preview.headers.get('content-length')).toBeNull()
    expect([...new Uint8Array(await preview.arrayBuffer()).subarray(1, 4)]).toEqual([
      ...new TextEncoder().encode('PNG'),
    ])
  })

  it('serves a Google face’s match copy to anyone with the faces’ headers, and none storage names no length of', async () => {
    const id = await googleFaceId(400)
    const copy = matchCopy(regular) ?? new Uint8Array()
    const path = googleFacePaths({ id, source: 'google' })?.match ?? ''
    const file = await app.request(path)
    expect(file.status).toBe(200)
    expect(Object.fromEntries(file.headers)).toMatchObject({
      'content-type': 'font/ttf',
      'content-length': String(copy.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    })
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(copy)
    const unsizedAnswer = await googleFontRoutes({ db, storage: unsized }).request(path)
    expect([unsizedAnswer.status, unsizedAnswer.headers.get('cache-control')]).toEqual([500, 'no-store'])
  })

  it('serves no brand’s upload, no face it lacks and no other name at the Google addresses, and keeps none of those answers', async () => {
    // Another workspace's, so the uploads below stay brand A's only Noto Sans.
    const { face } = await upload('b', otherBrand.id, regular)
    const google400 = await googleFaceId(400)
    const escaped = `%${google400.charCodeAt(0).toString(16)}${google400.slice(1)}`
    for (const path of [
      `/fonts/google/faces/${face.id}.ttf`,
      `/fonts/google/faces/${face.id}.png`,
      '/fonts/google/faces/nosuchface00.ttf',
      `/fonts/google/faces/${google400}.otf`,
      `/fonts/google/faces/${google400}.constructor`,
      `/fonts/google/faces/${google400}`,
      `/fonts/google/faces/${google400}.ttf?v=2`,
      `/fonts/google/faces/${google400}.ttf?`,
      `/fonts/google/${google400}.ttf`,
      `/fonts/google/sources/${google400}.ttf`,
      `/fonts/google/faces/${escaped}.ttf`,
      `${GOOGLE_MATCH_PATH}${face.id}.ttf`,
      `${GOOGLE_MATCH_PATH}nosuchface00.ttf`,
      `${GOOGLE_MATCH_PATH}${google400}.png`,
      `${GOOGLE_MATCH_PATH}${google400}`,
      `${GOOGLE_MATCH_PATH}${google400}.ttf/`,
      `${GOOGLE_MATCH_PATH}${google400}.ttf?`,
      `${GOOGLE_MATCH_PATH}/${google400}.ttf`,
      `${GOOGLE_MATCH_PATH}${escaped}.ttf`,
      GOOGLE_MATCH_PATH,
      `/fonts/google/match/${google400}.ttf`,
      `/fonts/google/match/v${MATCH_COPY_VERSION + 1}/${google400}.ttf`,
    ]) {
      const refused = await app.request(path)
      expect({ path, status: refused.status }).toEqual({ path, status: 404 })
      expect(refused.headers.get('cache-control')).toBe('no-store')
    }
    // A face whose match copy isn't made yet.
    const uncopied = {
      ...storage,
      stream: async (key: string) => (key.includes('/match/') ? null : storage.stream(key)),
    }
    const notYet = await googleFontRoutes({ db, storage: uncopied }).request(`${GOOGLE_MATCH_PATH}${google400}.ttf`)
    expect(notYet.status).toBe(404)
    expect(notYet.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses an address that asks for more files than it may in a minute', async () => {
    const id = await googleFaceId(400)
    const routes = googleFontRoutes({ db, storage, perAddressPerMinute: 1 })
    const ask = (address: string) =>
      routes.request(`/fonts/google/faces/${id}.ttf`, { headers: { 'cf-connecting-ip': address } })
    expect((await ask('203.0.113.7')).status).toBe(200)
    const refused = await ask('203.0.113.7')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('cache-control')).toBe('no-store')
    expect((await ask('203.0.113.8')).status).toBe(200)
    // The Google list counts with the files.
    const list = (await catalogOf('a', brand.id)).google
    const listed = await routes.request(list, { headers: { 'cf-connecting-ip': '203.0.113.7' } })
    expect(listed.status).toBe(429)
    expect(listed.headers.get('cache-control')).toBe('no-store')
    // An IPv6 network of one customer, its /64, counts as one address.
    expect((await ask('2001:db8:1:2::1')).status).toBe(200)
    expect((await ask('2001:db8:1:2:ffff::9')).status).toBe(429)
    expect((await ask('2001:db8:1:3::1')).status).toBe(200)
  })

  it('answers HEAD with the file’s headers, and closes its read of storage', async () => {
    const id = await googleFaceId(400)
    let closed = false
    const watched = {
      ...storage,
      stream: async (key: string) => {
        const stored = await storage.stream(key)
        if (!stored) return null
        const reader = stored.body.getReader()
        const body = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            const { done, value } = await reader.read()
            if (done) controller.close()
            else controller.enqueue(value)
          },
          cancel: async () => {
            closed = true
            await reader.cancel()
          },
        })
        return { ...stored, body }
      },
    }
    const head = await googleFontRoutes({ db, storage: watched }).request(`/fonts/google/faces/${id}.ttf`, {
      method: 'HEAD',
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(regular.length))
    expect(head.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await head.text()).toBe('')
    expect(closed).toBe(true)
  })

  it('lists a Google family with its place in the popularity order and its scripts', async () => {
    const [listed] = GOOGLE_FONTS
    if (!listed) throw new Error('GOOGLE_FONTS is empty')
    // A face of the family in a weight Google has none of, so it stands beside any face copied before.
    const row = {
      id: newId(),
      source: 'google',
      family: listed.family,
      weight: 1,
      style: 'italic',
      sha256: 'f'.repeat(64),
      byteSize: 1,
    } as const
    await db.insert(fontFaces).values(row)
    try {
      const catalog = FontFamily.array().parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
      expect(catalog.find((f) => f.family === listed.family)).toMatchObject({ rank: 1, scripts: listed.scripts })
      expect(catalog.find((f) => f.family === google.family)).not.toHaveProperty('rank')
    } finally {
      await db.delete(fontFaces).where(eq(fontFaces.id, row.id))
    }
  })

  it('uploads a font for a brand, named by its own tables, with a preview, and keeps it to that brand', async () => {
    const { face, uploaded } = await upload('a', brand.id, bold)
    expect(uploaded).toBe(true)
    expect(face.id).toMatch(SHORT_ID)
    expect(face).toMatchObject({
      family: 'Noto Sans',
      weight: 700,
      style: 'normal',
      source: 'upload',
      byteSize: bold.length,
    })
    expect(await upload('a', brand.id, bold)).toEqual({ face, uploaded: false })

    const link = FontLink.parse((await call('a', 'GET', `/brands/${brand.id}/fonts/faces/${face.id}`)).json)
    expect(new Uint8Array(await (await fetch(link.url)).arrayBuffer())).toEqual(bold)
    const preview = new Uint8Array(await (await fetch(link.previewUrl)).arrayBuffer())
    expect([...preview.subarray(1, 4)]).toEqual([...new TextEncoder().encode('PNG')])
    // A face that draws its name previews it, as when no scripts are asked for.
    expect(preview).toEqual(await fontPreview(bold, { family: 'Noto Sans', weight: 700, style: 'normal' }))

    const mine = FontFamily.array().parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
    expect(mine.find((f) => f.family === 'Noto Sans')?.faces.map((f) => f.id)).toEqual([face.id])
    const theirs = FontFamily.array().parse((await call('a', 'GET', `/brands/${sibling.id}/fonts`)).json)
    expect(theirs.find((f) => f.family === 'Noto Sans')).toBeUndefined()
    expect((await call('a', 'GET', `/brands/${sibling.id}/fonts/faces/${face.id}`)).status).toBe(404)
    expect((await call('b', 'GET', `/brands/${brand.id}/fonts`)).status).toBe(404)
    expect((await call(null, 'GET', `/brands/${brand.id}/fonts`)).status).toBe(401)
  })

  it('previews an upload with no Latin letters in its own script, not in boxes for its name', async () => {
    const naskh = fontFile('NotoNaskhArabic-Regular.ttf')
    const { face } = await upload('a', brand.id, naskh)
    expect(face.family).toBe('Noto Naskh Arabic')
    const link = FontLink.parse((await call('a', 'GET', `/brands/${brand.id}/fonts/faces/${face.id}`)).json)
    const preview = new Uint8Array(await (await fetch(link.previewUrl)).arrayBuffer())
    const style = { family: 'Noto Naskh Arabic', weight: 400, style: 'normal' } as const
    expect(preview).toEqual(await fontPreview(naskh, style, ['Arab']))
    expect(preview).not.toEqual(await fontPreview(naskh, style))
  })

  it('lists a variable font with its range of weights, never beside a face of one weight in its style', async () => {
    const variable = variableTestFont()
    // The same font with its fvar table renamed and its weight class 700: Vary Sans in one weight.
    const bold = variableTestFont()
    const view = new DataView(bold.buffer)
    for (let i = 0; i < view.getUint16(4); i++) {
      const record = 12 + i * 16
      const tag = new TextDecoder().decode(bold.subarray(record, record + 4))
      if (tag === 'fvar') bold.set(new TextEncoder().encode('xvar'), record)
      if (tag === 'OS/2') view.setUint16(view.getUint32(record + 8) + 4, 700)
    }
    // And as an italic of one weight: the OS/2 selection's italic bit, with the fvar table renamed too.
    const italic = bold.slice()
    const italicView = new DataView(italic.buffer)
    for (let i = 0; i < italicView.getUint16(4); i++) {
      const record = 12 + i * 16
      if (new TextDecoder().decode(italic.subarray(record, record + 4)) === 'OS/2')
        italicView.setUint16(italicView.getUint32(record + 8) + 62, 0x1)
    }
    const listed = async () =>
      FontFamily.array()
        .parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
        .find((f) => f.family === 'Vary Sans')
        ?.faces.filter((f) => f.style === 'normal')
        .map(({ weight, weights }) => ({ weight, weights }))
    const italics = async () =>
      FontFamily.array()
        .parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
        .find((f) => f.family === 'Vary Sans')
        ?.faces.filter((f) => f.style === 'italic')
        .map((f) => f.weight)

    expect((await upload('a', brand.id, italic)).face).toMatchObject({ weight: 700, style: 'italic' })

    expect((await upload('a', brand.id, bold)).face).toMatchObject({ family: 'Vary Sans', weight: 700 })
    expect(await listed()).toEqual([{ weight: 700, weights: undefined }])
    // The variable font takes the place of every face of its family and style.
    const { face } = await upload('a', brand.id, variable)
    expect(face).toMatchObject({ family: 'Vary Sans', weight: 400, weights: { min: 100, max: 900 } })
    expect(await listed()).toEqual([{ weight: 400, weights: { min: 100, max: 900 } }])
    // And a face of one weight takes the place of the variable one.
    await upload('a', brand.id, bold)
    expect(await listed()).toEqual([{ weight: 700, weights: undefined }])
    // None of it touched the italic.
    expect(await italics()).toEqual([700])
  })

  it('gives Node the same bytes for the faces a design uses, uploads and Google alike', async () => {
    await upload('a', brand.id, bold)
    const uses = (...families: string[]) =>
      families.map((family) => ({ family, weight: 400, style: 'normal' as const }))
    const files = await fontFiles(db, storage, workspace.id, brand.id, [
      ...uses('Noto Sans', google.family, 'Not A Font'),
      { family: google.family, weight: 700, style: 'normal' },
    ])
    const byFamily = (family: string) =>
      files
        .filter((f) => f.family === family)
        .map((f) => sha256(f.bytes))
        .sort()
    expect(byFamily('Noto Sans')).toEqual([sha256(bold)])
    expect(byFamily(google.family)).toEqual([sha256(regular), sha256(bold)].sort())
    expect(files).toHaveLength(3)
    // Another brand has no upload of that family.
    expect(await fontFiles(db, storage, workspace.id, sibling.id, uses('Noto Sans'))).toEqual([])
  })

  it('refuses a file that is not a font, and an upload of the wrong type', async () => {
    const text = new TextEncoder().encode(`not a font ${run}`)
    const ticket = FontUploadTicket.parse(
      (
        await call('a', 'POST', `/brands/${brand.id}/fonts/uploads`, {
          sha256: sha256(text),
          byteSize: text.length,
          contentType: 'font/ttf',
        })
      ).json,
    )
    if (!ticket.upload) throw new Error('expected an upload URL')
    await fetch(ticket.upload.url, { method: 'PUT', body: text, headers: ticket.upload.headers })
    expect((await call('a', 'POST', `/brands/${brand.id}/fonts`, { sha256: sha256(text) })).json).toEqual({
      error: 'The upload is not a TrueType or OpenType font',
    })
    expect((await call('a', 'POST', `/brands/${brand.id}/fonts`, { sha256: 'e'.repeat(64) })).json).toEqual({
      error: 'Nothing was uploaded for that SHA-256',
    })
    expect(
      (
        await call('a', 'POST', `/brands/${brand.id}/fonts/uploads`, {
          sha256: 'a'.repeat(64),
          byteSize: 10,
          contentType: 'font/woff2',
        })
      ).status,
    ).toBe(400)
  })

  it('serves the Google list to anyone at an address kept for good, which every brand’s catalog names beside its own uploads', async () => {
    await upload('a', brand.id, bold)
    await upload('b', otherBrand.id, regular)
    const { mine, theirs, answer, whole } = await whileGoogleFacesStay(async () => {
      const mine = await catalogOf('a', brand.id)
      const theirs = await catalogOf('b', otherBrand.id)
      const answer = await app.request(mine.google)
      const whole = FontFamily.array().parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
      return { mine, theirs, answer, whole }
    })
    expect(theirs.google).toBe(mine.google)
    expect(mine.uploads.map((f) => f.family)).toContain('Noto Sans')
    expect(mine.uploads.every((f) => f.source === 'upload')).toBe(true)
    expect(theirs.uploads.find((f) => f.family === 'Noto Sans')?.faces.map((f) => f.byteSize)).toEqual([regular.length])

    expect(answer.status).toBe(200)
    const bytes = new Uint8Array(await answer.arrayBuffer())
    expect(Object.fromEntries(answer.headers)).toMatchObject({
      'content-type': 'application/json',
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    })
    const list = FontFamily.array().parse(JSON.parse(new TextDecoder().decode(bytes)))
    expect(list.find((f) => f.family === google.family)?.faces).toHaveLength(2)
    // No brand's upload is in it, and no face of one.
    expect(list.filter((f) => f.source !== 'google' || f.faces.some((face) => face.source !== 'google'))).toEqual([])
    const uploaded = new Set([...mine.uploads, ...theirs.uploads].flatMap((f) => f.faces.map((face) => face.id)))
    expect(list.flatMap((f) => f.faces).filter((face) => uploaded.has(face.id))).toEqual([])

    // Joined, the two parts are the whole catalog the brand is listed.
    expect(brandCatalog(list, mine.uploads)).toEqual(whole)
    expect((await call('b', 'GET', `/brands/${brand.id}/fonts/catalog`)).status).toBe(404)
    expect((await call(null, 'GET', `/brands/${brand.id}/fonts/catalog`)).status).toBe(401)
  })

  it('names a new address once a Google face is added, and keeps none of the answers at any other', async () => {
    const before = (await catalogOf('a', brand.id)).google
    const row = {
      id: newId(),
      source: 'google',
      family: google.family,
      weight: 2,
      style: 'italic',
      sha256: 'e'.repeat(64),
      byteSize: 1,
    } as const
    await db.insert(fontFaces).values(row)
    try {
      const after = (await catalogOf('a', brand.id)).google
      expect(after).not.toBe(before)
      const bytes = new Uint8Array(await (await app.request(after)).arrayBuffer())
      // Named by the hash of its bytes, so the same faces give the same address on every server.
      expect(after).toBe(`/fonts/google/lists/${sha256(bytes).slice(0, 32)}.js`)
      const list = FontFamily.array().parse(JSON.parse(new TextDecoder().decode(bytes)))
      expect(list.find((f) => f.family === google.family)?.faces.map((f) => f.id)).toContain(row.id)
      const hash = /([\w-]+)\.js$/.exec(after)?.[1] ?? ''
      for (const path of [
        before,
        `/fonts/google/lists/${hash}.json`,
        `/fonts/google/lists/${hash}`,
        `/fonts/google/lists/${hash}.js?v=2`,
        `/fonts/google/lists/${hash.toUpperCase()}.js`,
        `/fonts/google/lists/%${hash.charCodeAt(0).toString(16)}${hash.slice(1)}.js`,
        `/fonts/google/lists/${'0'.repeat(hash.length)}.js`,
        `/fonts/google/faces/${hash}.js`,
      ]) {
        const refused = await app.request(path)
        expect({ path, status: refused.status }).toEqual({ path, status: 404 })
        expect(refused.headers.get('cache-control')).toBe('no-store')
      }
    } finally {
      await db.delete(fontFaces).where(eq(fontFaces.id, row.id))
    }
  })

  it('answers the last list built from memory, and asks the database about another at most once a while', async () => {
    await catalogOf('a', brand.id)
    const last = await lastGoogleFontList()
    if (!last) throw new Error('no Google list was built')
    let asked = 0
    const counted = new Proxy(db, {
      get: (target, key, receiver) => {
        if (key === 'select') asked += 1
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const routes = googleFontRoutes({ db: counted, storage })
    expect((await routes.request(googleFontListPath(last.hash))).status).toBe(200)
    expect(asked).toBe(0)
    for (const digit of '12345') {
      const refused = await routes.request(`/fonts/google/lists/${digit.repeat(32)}.js`)
      expect(refused.status).toBe(404)
      expect(refused.headers.get('cache-control')).toBe('no-store')
    }
    // One fingerprint, and one build when the faces changed meanwhile.
    expect(asked).toBeLessThanOrEqual(2)
  })

  it('keeps none of an answer that failed', async () => {
    const down = {
      select: () => {
        throw new Error('the database is down')
      },
    } as unknown as typeof db
    const failed = await googleFontRoutes({ db: down, storage }).request(`/fonts/google/lists/${'7'.repeat(32)}.js`)
    expect(failed.status).toBe(500)
    expect(failed.headers.get('cache-control')).toBe('no-store')
  })

  it('lists only the families asked for, as the brand sees them', async () => {
    await upload('a', brand.id, bold)
    const ask = async (brandId: string, ...families: string[]) => {
      const query = new URLSearchParams(families.map((family): [string, string] => ['family', family]))
      const answer = await call('a', 'GET', `/brands/${brandId}/fonts?${query}`)
      expect(answer.status).toBe(200)
      return FontFamily.array().parse(answer.json)
    }
    const whole = FontFamily.array().parse((await call('a', 'GET', `/brands/${brand.id}/fonts`)).json)
    const asked = await ask(brand.id, google.family, 'Noto Sans', 'Not A Font')
    expect(asked).toEqual(whole.filter((f) => f.family === 'Noto Sans' || f.family === google.family))
    expect(asked.find((f) => f.family === 'Noto Sans')?.source).toBe('upload')
    // Another brand of the workspace has no upload of Noto Sans.
    expect((await ask(sibling.id, google.family, 'Noto Sans')).map((f) => f.family)).toEqual([google.family])
    const tooMany = new URLSearchParams(
      Array.from({ length: 101 }, (_, i): [string, string] => ['family', `Family ${i}`]),
    )
    expect((await call('a', 'GET', `/brands/${brand.id}/fonts?${tooMany}`)).status).toBe(400)
  })
})
