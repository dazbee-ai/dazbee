// Adding a picture to a brand's asset library from an outside link, through the route, against Postgres and
// storage from Docker Compose and stand-in sites for the outside.
import { afterAll, describe, expect, it, vi } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { AssetLink, AssetSummary } from '@dazbee/schema'
import { NESTED_BLURS } from '@dazbee/svg/test-hostile-files'

import { issueTokens, makeAccess } from '../agents/agent-accesses.ts'
import { createApp } from '../app.ts'
import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import { PUBLIC_ADDRESS, testSites } from '../fetch/test-sites.ts'
import { sessionOfRequest } from '../sign-in/session.ts'
import { authorization, brand, db, personA, run, sessionSecret, storage, syncSecret, workspace } from '../test-api.ts'
import { bigPictureSvg, png, sha256, slowPathsSvg } from '../test-files.ts'
import { readSvgAsset } from './svg-assets.ts'

const sites = await testSites()
const app = createApp({
  db,
  storage,
  sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
  syncSecret,
  build: 'test-build',
  outsideFetch: sites.settings,
})
const ck = await loadCanvasKit()

afterAll(async () => {
  await sites.close()
})

/** A real image of one colour from `seed`, `width` × `height`, encoded as `format`. */
function encoded(format: 'JPEG' | 'WEBP', width: number, height: number, seed: string): Uint8Array {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const shade = [...seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 256
  surface.getCanvas().clear(ck.Color(shade, 255 - shade, 90, 1))
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes(ck.ImageFormat[format], 90)
  image.delete()
  surface.delete()
  if (!bytes) throw new Error(`could not encode a ${format}`)
  return bytes
}

/** A small SVG logo whose colour comes from `seed`. */
const svg = (seed: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#${sha256(new TextEncoder().encode(seed)).slice(0, 6)}"/></svg>`,
  )

/** Serves `bytes` at https://shop.test`path`, as `contentType`. */
function serve(path: string, bytes: Uint8Array | string, contentType = 'application/octet-stream') {
  sites.resolveTo('shop.test', [PUBLIC_ADDRESS])
  sites.serve('shop.test', path, (_request, response) =>
    response.writeHead(200, { 'content-type': contentType }).end(bytes),
  )
}

/** Asks `on` (the app above unless given) with the bearer `headers` to add the picture at `body.url` to the brand's library. */
async function addFromUrl(body: Record<string, unknown>, { headers = authorization('a'), on = app } = {}) {
  const response = await on.request(`/workspaces/${workspace.id}/brands/${brand.id}/assets/from-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}

// Recording a picture makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('addAssetFromUrl, through POST /brands/:brandId/assets/from-url', { timeout: 30_000 }, () => {
  it.each([
    ['PNG', 'image/png', () => png(5, 3, `${run}-link`), 5, 3],
    ['JPEG', 'image/jpeg', () => encoded('JPEG', 6, 4, `${run}-jpeg`), 6, 4],
    ['WebP', 'image/webp', () => encoded('WEBP', 7, 2, `${run}-webp`), 7, 2],
    ['SVG', 'image/svg+xml', () => svg(`${run}-svg`), 120, 40],
  ] as const)('adds a %s link to the brand’s library, stored by its hash', async (kind, type, make, width, height) => {
    const bytes = make()
    serve(`/files/${kind}%20picture`, bytes)
    const added = await addFromUrl({ url: `https://shop.test/files/${kind}%20picture` })
    expect(added.status).toBe(201)
    const asset = AssetSummary.parse(added.json)
    expect(asset).toMatchObject({
      brandId: brand.id,
      sha256: sha256(bytes),
      contentType: type,
      byteSize: bytes.length,
      width,
      height,
      name: `${kind} picture`,
      tags: [],
    })
    const link = await app.request(`/workspaces/${workspace.id}/brands/${brand.id}/assets/${asset.id}`, {
      headers: authorization('a'),
    })
    const stored = await fetch(AssetLink.parse(await link.json()).url)
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes)
  })

  it('gives the same asset for the same bytes, keeping its name and adding the tags given', async () => {
    const bytes = png(4, 4, `${run}-twice`)
    serve('/one.png', bytes)
    serve('/same-again.png', bytes)
    const first = AssetSummary.parse(
      (await addFromUrl({ url: 'https://shop.test/one.png', name: 'Red shoe', tags: ['Product', 'shoe'] })).json,
    )
    expect(first).toMatchObject({ name: 'Red shoe', tags: ['product', 'shoe'] })
    const again = await addFromUrl({ url: 'https://shop.test/same-again.png', name: 'Other', tags: ['sale', 'shoe'] })
    expect(again.status).toBe(201)
    expect(AssetSummary.parse(again.json)).toEqual({ ...first, tags: ['product', 'shoe', 'sale'] })
  })

  it('names a picture by its host when its link has no file name', async () => {
    serve('/', png(2, 2, `${run}-root`))
    expect(AssetSummary.parse((await addFromUrl({ url: 'https://shop.test/' })).json).name).toBe('shop.test')
  })

  it.each([
    [
      'a web page',
      '/page',
      () => '<!doctype html><html><body>Shoes</body></html>',
      'text/html; charset=utf-8',
      'The link opens a web page, not a picture: give the link of the picture itself (open the picture on its own and copy its address)',
    ],
    [
      'a GIF',
      '/anim.gif',
      () => 'GIF89a\x01\x00\x01\x00',
      'image/gif',
      'The file at that link is not a PNG, JPEG, WebP or SVG picture (it is image/gif)',
    ],
    [
      'a PNG that doesn’t decode',
      '/broken.png',
      () => png(8, 8, `${run}-broken`).fill(0x55, 33),
      'image/png',
      'The image could not be decoded',
    ],
  ])('refuses %s in a sentence, adding nothing', async (_name, path, body, contentType, sentence) => {
    serve(path, body(), contentType)
    expect(await addFromUrl({ url: `https://shop.test${path}` })).toEqual({ status: 400, json: { error: sentence } })
  })

  it('refuses an SVG file past its limit, and a file past the upload limit', async () => {
    serve('/huge.svg', `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(5_000_001)}</svg>`, 'image/svg+xml')
    expect((await addFromUrl({ url: 'https://shop.test/huge.svg' })).json).toEqual({
      error: 'An SVG file is at most 5 MB; ask for a smaller one',
    })
    sites.serve('shop.test', '/huge.png', (_request, response) =>
      response.writeHead(200, { 'content-length': String(31 * 1024 * 1024) }).end(),
    )
    expect((await addFromUrl({ url: 'https://shop.test/huge.png' })).json).toEqual({
      error: 'The file at that link is larger than 30 MB, the most Dazbee takes; ask for a smaller one',
    })
  })

  it('refuses an SVG file too complex or too big to draw with the sentence an upload gets', async () => {
    serve('/blurs.svg', `${NESTED_BLURS}<!-- ${run} blurs -->`, 'image/svg+xml')
    expect(await addFromUrl({ url: 'https://shop.test/blurs.svg' })).toEqual({
      status: 400,
      json: { error: 'This SVG file is too complex to draw: its blurs and shadows nest more than 4 deep' },
    })
    serve('/big-picture.svg', `${bigPictureSvg()}<!-- ${run} big picture -->`, 'image/svg+xml')
    expect(await addFromUrl({ url: 'https://shop.test/big-picture.svg' })).toEqual({
      status: 400,
      json: { error: 'This SVG file needs too much memory to draw' },
    })
  })

  it('draws an SVG file from a link on its thread, the API answering other requests meanwhile', async () => {
    // A file of 100,000 points takes a while to draw: the API runs its timers and answers
    // meanwhile, never held for half of what adding the file takes.
    serve('/slow.svg', `${slowPathsSvg(50_000)}<!-- ${run} slow -->`, 'image/svg+xml')
    let longestGap = 0
    let last = performance.now()
    const ticks = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
    }, 5)
    const started = performance.now()
    const added = addFromUrl({ url: 'https://shop.test/slow.svg' })
    const health = await app.request('/health')
    expect({ status: health.status, json: await health.json() }).toMatchObject({ status: 200, json: { ok: true } })
    expect((await added).status).toBe(201)
    clearInterval(ticks)
    expect(Math.max(longestGap, performance.now() - last)).toBeLessThan((performance.now() - started) / 2)
  })

  it('answers 503 for an SVG file from a link while four others are read or wait, and adds it when asked again', async () => {
    serve('/waits.svg', svg(`${run}-waits`), 'image/svg+xml')
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    void inDrawingTurn(() => held)
    const square = (i: number) =>
      new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/><!-- ${i} -->`)
    const others = Array.from({ length: 4 }, (_, i) => readSvgAsset(square(i), 32))
    expect(await addFromUrl({ url: 'https://shop.test/waits.svg' })).toEqual({
      status: 503,
      json: { error: 'Dazbee is reading other SVG files; add this one again in a minute' },
    })
    release()
    await Promise.all(others)
    expect((await addFromUrl({ url: 'https://shop.test/waits.svg' })).status).toBe(201)
  })

  it('refuses a picture past 25 megapixels before decoding it', async () => {
    // A PNG whose header says 6,000 × 5,000: within the upload limits, past a linked picture's.
    const big = new Uint8Array(33)
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(big.buffer).setUint32(16, 6_000)
    new DataView(big.buffer).setUint32(20, 5_000)
    big.set([8, 6, 0, 0, 0], 24)
    serve('/poster.png', big)
    expect(await addFromUrl({ url: 'https://shop.test/poster.png' })).toEqual({
      status: 400,
      json: { error: 'A picture from a link is at most 25 megapixels; ask for a smaller one' },
    })
  })

  it('tells a private address, an http link and a site that refuses as the safe fetch’s sentences', async () => {
    sites.resolveTo('inside.test', ['10.0.0.5'])
    expect(await addFromUrl({ url: 'https://inside.test/a.png' })).toEqual({
      status: 400,
      json: { error: 'Dazbee found no public website at inside.test; check the link, or ask the person for another' },
    })
    expect((await addFromUrl({ url: 'http://shop.test/a.png' })).json).toEqual({
      error: 'Dazbee fetches only https links; give the https link',
    })
    sites.serve('shop.test', '/private.png', (_request, response) => response.writeHead(403).end())
    expect((await addFromUrl({ url: 'https://shop.test/private.png' })).json).toEqual({
      error:
        'shop.test refused to give Dazbee this file (403): it may need a sign-in or turn servers away; ask the person for another link, or for the file itself',
    })
  })

  it('refuses a Reviewer, and a view access, before fetching anything', async () => {
    const visits = sites.visits.length
    serve('/reviewer.png', png(2, 2, `${run}-reviewer`))
    expect((await addFromUrl({ url: 'https://shop.test/reviewer.png' }, { headers: authorization('r') })).status).toBe(
      403,
    )
    const access = await makeAccess(db, {
      userId: personA.id,
      workspaceId: workspace.id,
      brandIds: null,
      writes: false,
      clientId: null,
      clientName: 'Claude Code',
    })
    const { accessToken } = await issueTokens(db, access, new Date())
    const viewing = await addFromUrl(
      { url: 'https://shop.test/reviewer.png' },
      { headers: { authorization: `Bearer ${accessToken}` } },
    )
    expect(viewing).toEqual({ status: 403, json: { error: 'Only an Owner, Admin or Editor can do this' } })
    expect(sites.visits.length).toBe(visits)
  })

  it('adds a picture for an access that edits the brand', async () => {
    const access = await makeAccess(db, {
      userId: personA.id,
      workspaceId: workspace.id,
      brandIds: [brand.id],
      writes: true,
      clientId: null,
      clientName: 'Claude Code',
    })
    const { accessToken } = await issueTokens(db, access, new Date())
    serve('/agent.png', png(3, 1, `${run}-agent`))
    const added = await addFromUrl(
      { url: 'https://shop.test/agent.png' },
      { headers: { authorization: `Bearer ${accessToken}` } },
    )
    expect(added.status).toBe(201)
  })

  it('refuses a body that is not a link with tags', async () => {
    expect((await addFromUrl({ url: 'https://shop.test/a.png', tags: 'shoe' })).status).toBe(400)
    expect((await addFromUrl({})).status).toBe(400)
  })

  it('refuses a member past their pictures from links in an hour, across their agents', async () => {
    const limited = createApp({
      db,
      storage,
      sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
      syncSecret,
      build: 'test-build',
      outsideFetch: sites.settings,
      fromUrlPerHour: 2,
    })
    serve('/hourly.png', png(2, 3, `${run}-hourly`))
    const as = { headers: authorization('editor'), on: limited }
    expect((await addFromUrl({ url: 'https://shop.test/hourly.png' }, as)).status).toBe(201)
    expect((await addFromUrl({ url: 'https://shop.test/hourly.png' }, as)).status).toBe(201)
    expect(await addFromUrl({ url: 'https://shop.test/hourly.png' }, as)).toEqual({
      status: 429,
      json: { error: 'This member has added as many pictures from links as they may in an hour (2); try again later' },
    })
    expect((await addFromUrl({ url: 'https://shop.test/hourly.png' }, { on: limited })).status).toBe(201)
  })

  it('answers busy while another picture is being added from a link', async () => {
    sites.resolveTo('slow.test', [PUBLIC_ADDRESS])
    let answer = () => {}
    sites.serve('slow.test', '/held.png', (_request, response) => {
      answer = () => response.end(png(2, 2, `${run}-held`))
    })
    const first = addFromUrl({ url: 'https://slow.test/held.png' })
    await vi.waitFor(() => expect(sites.visits.some(({ path }) => path === '/held.png')).toBe(true))
    expect(await addFromUrl({ url: 'https://shop.test/hourly.png' })).toEqual({
      status: 503,
      json: { error: 'Dazbee is busy adding another picture from a link; try again in a moment' },
    })
    answer()
    expect((await first).status).toBe(201)
  })
})
