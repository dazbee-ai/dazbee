// Filling a brand kit from the brand's website, through POST /brands/:brandId/kit/from-website, against Postgres and
// storage from Docker Compose, stored sample pages served by stand-in sites, and catalog families the tests add.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { AssetLink, BrandFromWebsiteAnswer } from '@dazbee/schema'

import { createApp } from '../app.ts'
import { PUBLIC_ADDRESS, testSites } from '../fetch/test-sites.ts'
import { sessionOfRequest } from '../sign-in/session.ts'
import {
  addPerson,
  authorization,
  db,
  run,
  sessionSecret,
  storage,
  syncSecret,
  uploadImage,
  workspace,
} from '../test-api.ts'
import { png } from '../test-files.ts'
import { accessToken, addSampleFamilies, kitCall, newBrand, sample } from './test-websites.ts'

const sites = await testSites()
const app = createApp({
  db,
  storage,
  sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
  syncSecret,
  build: 'test-build',
  outsideFetch: sites.settings,
})

let removeSampleFamilies = () => Promise.resolve()

beforeAll(async () => {
  removeSampleFamilies = await addSampleFamilies()
})

afterAll(async () => {
  await removeSampleFamilies()
  await sites.close()
})

/** Serves `body` at https://`host``path` as `contentType`. */
function serve(host: string, path: string, body: string | Uint8Array, contentType: string) {
  sites.resolveTo(host, [PUBLIC_ADDRESS])
  sites.serve(host, path, (_request, response) => response.writeHead(200, { 'content-type': contentType }).end(body))
}

/** Serves the Harbour & Pine sample site on harbour.test. */
function serveHarbour() {
  serve('harbour.test', '/', sample('harbour.html'), 'text/html; charset=utf-8')
  serve('harbour.test', '/assets/site.css?v=42', sample('harbour.css'), 'text/css')
  serve(
    'harbour.test',
    '/icon.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>',
    'image/svg+xml',
  )
}

/** Asks `on` (the app above unless given) as `headers` (the Owner's unless given) to fill the kit from `body.url`. */
async function fromWebsite(
  brandId: string,
  body: Record<string, unknown>,
  { headers = authorization('a'), on = app }: { headers?: Record<string, string>; on?: typeof app } = {},
) {
  const response = await on.request(`/workspaces/${workspace.id}/brands/${brandId}/kit/from-website`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}

// Recording the logo makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('brandFromWebsite, through POST /brands/:brandId/kit/from-website', { timeout: 30_000 }, () => {
  it('fills an empty kit with the logo in the site’s header, its colours and its Google Fonts', async () => {
    serveHarbour()
    const brandId = await newBrand()
    const answered = await fromWebsite(brandId, { url: 'https://harbour.test/' })
    expect(answered.status).toBe(200)
    const answer = BrandFromWebsiteAnswer.parse(answered.json)
    expect(answer.colors).toEqual({
      primary: '#1F4D3AFF',
      secondary: '#E8833AFF',
      background: '#FBF7F0FF',
      text: '#2B2B2BFF',
    })
    expect(answer.fonts).toEqual([
      { role: 'heading', site: 'Fraunces', family: 'Fraunces', match: 'same' },
      { role: 'body', site: 'Work Sans', family: 'Work Sans', match: 'same' },
    ])
    expect(answer.filled).toEqual(['logo', 'primary', 'secondary', 'background', 'text', 'heading', 'body'])
    expect(answer.kept).toEqual([])
    expect(answer.logo).toMatchObject({ contentType: 'image/svg+xml', width: 180, height: 48, tags: ['logo'] })
    // The site's SVG icon is offered too, to add by link.
    expect(answer.candidates).toEqual({
      logo: 'https://harbour.test/icon.svg',
      shareImage: 'https://harbour.test/share/summer-blend.jpg',
    })
    expect(answer.kit).toMatchObject({
      logoAssetId: answer.logo?.id,
      colors: [
        { token: 'primary', name: 'Primary', value: '#1F4D3AFF' },
        { token: 'secondary', name: 'Secondary', value: '#E8833AFF' },
        { token: 'background', name: 'Background', value: '#FBF7F0FF' },
        { token: 'text', name: 'Text', value: '#2B2B2BFF' },
      ],
      fonts: [
        { token: 'heading', name: 'Heading', family: 'Fraunces' },
        { token: 'body', name: 'Body', family: 'Work Sans' },
      ],
    })
    const kit = await app.request(`/workspaces/${workspace.id}/brands/${brandId}/kit`, { headers: authorization('a') })
    expect(await kit.json()).toEqual(answer.kit)
    // The logo is the header's own drawing, stored as an SVG file of the brand's.
    const link = await app.request(`/workspaces/${workspace.id}/brands/${brandId}/assets/${answer.logo?.id}`, {
      headers: authorization('a'),
    })
    const stored = await (await fetch(AssetLink.parse(await link.json()).url)).text()
    expect(stored).toContain('<circle cx="24" cy="24" r="22" fill="#1F4D3A"')
    expect(stored).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('keeps the roles a kit has set, and replaces them when asked', async () => {
    serveHarbour()
    const brandId = await newBrand()
    const { asset: mark } = await uploadImage('a', brandId, png(16, 16, `${run}-own-logo`))
    const own = {
      colors: [{ token: 'primary', name: 'Primary', value: '#E0262BFF' }],
      fonts: [{ token: 'heading', name: 'Heading', family: 'Lora' }],
      logoAssetId: mark.id,
      voice: 'Warm.',
    }
    expect((await kitCall(app, 'PUT', brandId, own)).status).toBe(200)
    const kept = BrandFromWebsiteAnswer.parse((await fromWebsite(brandId, { url: 'https://harbour.test/' })).json)
    expect(kept.filled).toEqual(['secondary', 'background', 'text', 'body'])
    expect(kept.kept).toEqual(['logo', 'primary', 'heading'])
    expect(kept.logo).toBeNull()
    expect(kept.kit).toMatchObject({
      logoAssetId: mark.id,
      voice: 'Warm.',
      colors: [
        { token: 'primary', value: '#E0262BFF' },
        { token: 'secondary', value: '#E8833AFF' },
        { token: 'background', value: '#FBF7F0FF' },
        { token: 'text', value: '#2B2B2BFF' },
      ],
      fonts: [
        { token: 'heading', family: 'Lora' },
        { token: 'body', family: 'Work Sans' },
      ],
    })
    const replaced = BrandFromWebsiteAnswer.parse(
      (await fromWebsite(brandId, { url: 'https://harbour.test/', replace: true })).json,
    )
    expect(replaced.filled).toEqual(['logo', 'primary', 'heading'])
    expect(replaced.kit).toMatchObject({
      logoAssetId: replaced.logo?.id,
      voice: 'Warm.',
      colors: [
        { token: 'primary', value: '#1F4D3AFF' },
        { token: 'secondary' },
        { token: 'background' },
        { token: 'text' },
      ],
      fonts: [
        { token: 'heading', family: 'Fraunces' },
        { token: 'body', family: 'Work Sans' },
      ],
    })
    expect(replaced.logo?.id).not.toBe(mark.id)
  })

  it('reads nothing when every role is set and replace isn’t asked', async () => {
    const brandId = await newBrand()
    const { asset: mark } = await uploadImage('a', brandId, png(16, 16, `${run}-full-logo`))
    const colors = ['primary', 'secondary', 'accent', 'background', 'text'].map((token) => ({
      token,
      name: token,
      value: '#123456FF',
    }))
    const fonts = ['heading', 'body'].map((token) => ({ token, name: token, family: 'Lora' }))
    await kitCall(app, 'PUT', brandId, { colors, fonts, logoAssetId: mark.id, voice: '' })
    const visits = sites.visits.length
    const answer = BrandFromWebsiteAnswer.parse((await fromWebsite(brandId, { url: 'https://harbour.test/' })).json)
    expect(answer).toMatchObject({
      filled: [],
      notes: ['Every role a website fills is set in this kit already; ask again with replace to replace them'],
    })
    expect(sites.visits.length).toBe(visits)
  })

  it('matches a paid font to the closest Google family, naming both, and takes a logo picture in the header', async () => {
    serve('northwind.test', '/', sample('northwind.html'), 'text/html')
    serve('cdn.northwind.test', '/css/app.4f9a1c.css', sample('northwind.css'), 'text/css; charset=utf-8')
    serve('northwind.test', '/img/northwind-logo.png', png(160, 40, `${run}-northwind`), 'image/png')
    const brandId = await newBrand()
    const answer = BrandFromWebsiteAnswer.parse((await fromWebsite(brandId, { url: 'northwind.test' })).json)
    expect(answer.site).toBe('https://northwind.test/')
    expect(answer.colors).toEqual({
      primary: '#4338CAFF',
      secondary: '#F59E0BFF',
      background: '#FFFFFFFF',
      text: '#111827FF',
    })
    // The catalog may hold more families than the tests add; the closest is a Grotesk, and a Display serif.
    expect(answer.fonts).toEqual([
      { role: 'heading', site: 'Meridian Display', family: expect.stringMatching(/Display/), match: 'closest' },
      { role: 'body', site: 'Aperture Grotesk', family: expect.stringMatching(/Grotesk/), match: 'closest' },
    ])
    expect(answer.logo).toMatchObject({ name: 'Northwind Studio logo', contentType: 'image/png', width: 160 })
    expect(sites.visits.some(({ path }) => path.startsWith('/fonts/'))).toBe(false)
  })

  it('takes the largest icon of the web manifest when the page links no logo, and offers the share picture', async () => {
    serve('meadow.test', '/', sample('meadow.html'), 'text/html')
    serve('meadow.test', '/site.webmanifest', sample('meadow.webmanifest'), 'application/manifest+json')
    serve('meadow.test', '/icons/icon-512.png', png(64, 64, `${run}-meadow-512`), 'image/png')
    serve('meadow.test', '/icons/icon-192.png', png(48, 48, `${run}-meadow-192`), 'image/png')
    const brandId = await newBrand()
    const answer = BrandFromWebsiteAnswer.parse((await fromWebsite(brandId, { url: 'https://meadow.test' })).json)
    expect(answer.logo).toMatchObject({ width: 64, tags: ['logo'] })
    expect(answer.candidates).toEqual({
      logo: 'https://meadow.test/icons/icon-192.png',
      shareImage: 'https://meadow.test/share/studio.jpg',
    })
    expect(answer.colors).toMatchObject({ primary: '#7C3AEDFF', background: '#FFFFFFFF', text: '#1C1917FF' })
    expect(answer.fonts).toEqual([
      { role: 'heading', site: 'Inter', family: 'Inter', match: 'same' },
      { role: 'body', site: 'Inter', family: 'Inter', match: 'same' },
    ])
    expect(sites.visits.some(({ path }) => path === '/icons/maskable-512.png')).toBe(false)
  })

  it('says a site that turns Dazbee away or shows a check for robots blocks the read, changing nothing', async () => {
    const brandId = await newBrand()
    sites.resolveTo('walled.test', [PUBLIC_ADDRESS])
    sites.serve('walled.test', '/', (_request, response) => response.writeHead(403).end(sample('challenge.html')))
    expect(await fromWebsite(brandId, { url: 'https://walled.test/' })).toEqual({
      status: 400,
      json: {
        error:
          'walled.test turned Dazbee away (403): it lets only people in a browser read it, so Dazbee can’t; ask the person for their logo, brand colours and fonts instead',
      },
    })
    sites.resolveTo('busy-wall.test', [PUBLIC_ADDRESS])
    sites.serve('busy-wall.test', '/', (_request, response) => response.writeHead(503).end(sample('challenge.html')))
    expect((await fromWebsite(brandId, { url: 'https://busy-wall.test/' })).json).toEqual({
      error:
        'busy-wall.test answered 503: it is down, or checking for robots; try once more, and if it answers the same, ask the person for their logo, brand colours and fonts instead',
    })
    serve('checking.test', '/', sample('challenge.html'), 'text/html')
    expect(await fromWebsite(brandId, { url: 'https://checking.test/' })).toEqual({
      status: 400,
      json: {
        error:
          'checking.test showed Dazbee a check for robots instead of its page, so Dazbee can’t read it; ask the person for their logo, brand colours and fonts instead',
      },
    })
    serve('picture.test', '/', png(2, 2, `${run}-not-page`), 'image/png')
    expect((await fromWebsite(brandId, { url: 'https://picture.test/' })).json).toEqual({
      error: 'That link is not a web page (it is image/png); give the address of the brand’s website',
    })
    sites.resolveTo('inside.test', ['10.0.0.5'])
    expect((await fromWebsite(brandId, { url: 'https://inside.test/' })).json).toEqual({
      error: 'Dazbee found no public website at inside.test; check the link, or ask the person for another',
    })
    expect((await kitCall(app, 'GET', brandId)).json).toMatchObject({ colors: [], fonts: [], logoAssetId: null })
  })

  it('names the logo by the site’s title without the characters a name can’t hold', async () => {
    serve(
      'odd-title.test',
      '/',
      '<title>\u0000Acme‮ Tools | Home</title><header><a href="/"><img src="/acme-logo.png"></a></header>',
      'text/html',
    )
    serve('odd-title.test', '/acme-logo.png', png(20, 10, `${run}-odd-title`), 'image/png')
    const answered = await fromWebsite(await newBrand(), { url: 'https://odd-title.test/' })
    expect(answered.status).toBe(200)
    expect(BrandFromWebsiteAnswer.parse(answered.json).logo?.name).toBe('Acme Tools logo')
  })

  it('leaves adding pictures by link free while it fetches a site’s logo', async () => {
    serve('slow-logo.test', '/', '<header><a href="/"><img src="/logo.png"></a></header>', 'text/html')
    let answer = () => {}
    sites.serve('slow-logo.test', '/logo.png', (_request, response) => {
      answer = () => response.writeHead(200, { 'content-type': 'image/png' }).end(png(8, 8, `${run}-slow-logo`))
    })
    serve('slow-logo.test', '/photo.png', png(3, 3, `${run}-photo-meanwhile`), 'image/png')
    const brandId = await newBrand()
    const reading = fromWebsite(brandId, { url: 'https://slow-logo.test/' })
    await vi.waitFor(() => expect(sites.visits.some(({ path }) => path === '/logo.png')).toBe(true))
    const added = await app.request(`/workspaces/${workspace.id}/brands/${brandId}/assets/from-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorization('editor') },
      body: JSON.stringify({ url: 'https://slow-logo.test/photo.png' }),
    })
    expect(added.status).toBe(201)
    answer()
    expect((await reading).status).toBe(200)
  })

  it('counts no read against a member Dazbee was too busy to serve', async () => {
    const limited = createApp({
      db,
      storage,
      sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
      syncSecret,
      build: 'test-build',
      outsideFetch: sites.settings,
      websitesPerHour: 1,
    })
    const brandId = await newBrand()
    sites.resolveTo('held.test', [PUBLIC_ADDRESS])
    const waiting: (() => void)[] = []
    sites.serve('held.test', '/', (_request, response) => {
      waiting.push(() => response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Held</title>'))
    })
    const holders = await Promise.all([0, 1, 2, 3].map(() => addPerson([[workspace.id, 'editor']])))
    const held = holders.map((person) =>
      fromWebsite(brandId, { url: 'https://held.test/' }, { headers: authorization(person.as), on: limited }),
    )
    await vi.waitFor(() => expect(waiting).toHaveLength(4))
    const late = await addPerson([[workspace.id, 'editor']])
    const as = { headers: authorization(late.as), on: limited }
    expect(await fromWebsite(brandId, { url: 'https://held.test/' }, as)).toEqual({
      status: 503,
      json: { error: 'Dazbee is reading other websites; try again in a moment' },
    })
    for (const release of waiting.splice(0)) release()
    await Promise.all(held)
    sites.serve('held.test', '/', (_request, response) =>
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Free</title>'),
    )
    expect((await fromWebsite(brandId, { url: 'https://held.test/' }, as)).status).toBe(200)
  })

  it('refuses a Reviewer and an access that only views before fetching, and fills the kit for one that edits', async () => {
    serveHarbour()
    const brandId = await newBrand()
    const visits = sites.visits.length
    expect((await fromWebsite(brandId, { url: 'https://harbour.test/' }, { headers: authorization('r') })).status).toBe(
      403,
    )
    const viewing = await accessToken(false)
    expect(await fromWebsite(brandId, { url: 'https://harbour.test/' }, { headers: viewing })).toEqual({
      status: 403,
      json: { error: 'Only an Owner, Admin or Editor can do this' },
    })
    expect(sites.visits.length).toBe(visits)
    const editing = await accessToken(true)
    const filled = await fromWebsite(brandId, { url: 'https://harbour.test/' }, { headers: editing })
    expect(filled.status).toBe(200)
    expect(BrandFromWebsiteAnswer.parse(filled.json).filled).toContain('primary')
  })

  it('reads one website at a time for a member, and refuses one past their websites in an hour', async () => {
    const limited = createApp({
      db,
      storage,
      sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
      syncSecret,
      build: 'test-build',
      outsideFetch: sites.settings,
      websitesPerHour: 2,
    })
    const brandId = await newBrand()
    sites.resolveTo('slow-site.test', [PUBLIC_ADDRESS])
    let answer = () => {}
    sites.serve('slow-site.test', '/', (_request, response) => {
      answer = () => response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Slow</title>')
    })
    const as = { headers: authorization('editor'), on: limited }
    const first = fromWebsite(brandId, { url: 'https://slow-site.test/' }, as)
    await vi.waitFor(() => expect(sites.visits.some(({ host }) => host === 'slow-site.test')).toBe(true))
    expect(await fromWebsite(brandId, { url: 'https://slow-site.test/' }, as)).toEqual({
      status: 429,
      json: { error: 'This member is already reading a website into a kit; wait for it to finish' },
    })
    answer()
    expect((await first).status).toBe(200)
    sites.serve('slow-site.test', '/', (_request, response) =>
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Quick</title>'),
    )
    expect((await fromWebsite(brandId, { url: 'https://slow-site.test/' }, as)).status).toBe(200)
    expect(await fromWebsite(brandId, { url: 'https://slow-site.test/' }, as)).toEqual({
      status: 429,
      json: { error: 'This member has read as many websites as they may in an hour (2); try again later' },
    })
    expect((await fromWebsite(brandId, { url: 'https://slow-site.test/' }, { on: limited })).status).toBe(200)
  })
})
