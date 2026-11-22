// Searching Pixabay for stock photos and saving one into a brand's asset library, through the routes, against
// Postgres and storage from Docker Compose, a stand-in Pixabay, and stand-in sites for the photos' downloads.
import { afterAll, describe, expect, it } from 'vitest'

import { AssetSummary, StockResults } from '@dazbee/schema'

import { createApp } from '../app.ts'
import { PUBLIC_ADDRESS, testSites } from '../fetch/test-sites.ts'
import { sessionOfRequest } from '../sign-in/session.ts'
import { authorization, brand, db, run, sessionSecret, storage, syncSecret, workspace } from '../test-api.ts'
import { png, sha256 } from '../test-files.ts'
import { pixabay, pixabayFromEnv } from './pixabay.ts'
import { STOCK_SEARCHES_PER_MINUTE } from './routes.ts'
import { TEST_PIXABAY_URL, testPixabay } from './test-pixabay.ts'

const KEY = 'test-pixabay-key-0123456789'
/** Tags as Pixabay gives a photo many, some of them again. */
const LONG_TAGS =
  'skateboard, skater, teen, style, sports, young, active, skateboarding, entertainment, urban, board, youth, skateboard, skateboard, teen'
const sites = await testSites()
sites.resolveTo('pixabay.com', [PUBLIC_ADDRESS])

afterAll(async () => {
  await sites.close()
})

/** An app whose Pixabay is a new stand-in on a clock the test moves, allowed `perMinute` requests a minute. */
function stockApp({ perMinute = 100, stock = true } = {}) {
  const library = testPixabay()
  const clock = { now: Date.UTC(2026, 10, 22) }
  const app = createApp({
    db,
    storage,
    sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
    syncSecret,
    build: 'test-build',
    outsideFetch: sites.settings,
    stock: stock
      ? pixabay({ key: KEY, fetch: library.fetch, now: () => clock.now, perMinute, url: TEST_PIXABAY_URL })
      : null,
  })
  /** Searches as `as` (the Owner unless given) with the query `params`. */
  const search = async (params: Record<string, string>, as = 'a') => {
    const response = await app.request(`/workspaces/${workspace.id}/stock/photos?${new URLSearchParams(params)}`, {
      headers: authorization(as),
    })
    return { status: response.status, json: (await response.json()) as unknown }
  }
  /** Saves the photo of `id` into the brand's library as `as` (the Owner unless given). */
  const add = async (id: unknown, as = 'a') => {
    const response = await app.request(`/workspaces/${workspace.id}/brands/${brand.id}/assets/from-stock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorization(as) },
      body: JSON.stringify({ id }),
    })
    return { status: response.status, json: (await response.json()) as unknown }
  }
  return { library, clock, search, add }
}

/** Serves `bytes` as a PNG at `link` on the stand-in sites. */
function serveDownload(link: string, bytes: Uint8Array) {
  const url = new URL(link)
  sites.serve(url.hostname, url.pathname, (_request, response) =>
    response.writeHead(200, { 'content-type': 'image/png' }).end(bytes),
  )
}

describe('GET /workspaces/:workspaceId/stock/photos', () => {
  it('answers the photos Pixabay finds, naming Pixabay, each with its preview, saved size and photographer', async () => {
    const { library, search } = stockApp()
    library.add({ id: 101, tags: 'red shoe, sneaker, fashion', user: 'Anna_K', imageWidth: 6000, imageHeight: 4000 })
    library.add({ id: 102, tags: 'tall shoe', imageWidth: 800, imageHeight: 1200 })
    library.add({ id: 103, tags: 'mountain lake' })
    const found = await search({ q: 'shoe', orientation: 'landscape', colour: 'red' })
    expect(found.status).toBe(200)
    expect(StockResults.parse(found.json)).toEqual({
      source: 'Pixabay',
      photos: [
        {
          id: 101,
          preview: 'https://cdn.pixabay.com/photo/101_150.jpg',
          width: 1280,
          height: 853,
          photographer: 'Anna_K',
          tags: ['red shoe', 'sneaker', 'fashion'],
          page: 'https://pixabay.com/photos/photo-101/',
        },
        {
          id: 102,
          preview: 'https://cdn.pixabay.com/photo/102_150.jpg',
          width: 800,
          height: 1200,
          photographer: 'Photographer',
          tags: ['tall shoe'],
          page: 'https://pixabay.com/photos/photo-102/',
        },
      ],
    })
    const [sent] = library.requests
    expect(Object.fromEntries(sent?.searchParams ?? [])).toEqual({
      key: KEY,
      q: 'shoe',
      image_type: 'photo',
      safesearch: 'true',
      per_page: '20',
      orientation: 'horizontal',
      colors: 'red',
    })
  })

  it('tells each photo’s tags once each, at most 10, as Pixabay repeats them', async () => {
    const { library, search } = stockApp()
    library.add({ id: 104, tags: LONG_TAGS })
    const [photo] = StockResults.parse((await search({ q: 'skateboard' })).json).photos
    expect(photo?.tags).toEqual([
      'skateboard',
      'skater',
      'teen',
      'style',
      'sports',
      'young',
      'active',
      'skateboarding',
      'entertainment',
      'urban',
    ])
  })

  it('answers no photos when Pixabay finds none', async () => {
    const { search } = stockApp()
    expect((await search({ q: 'nothing here' })).json).toEqual({ source: 'Pixabay', photos: [] })
  })

  it('answers the same search again from its cache for 24 hours, then asks Pixabay again', async () => {
    const { library, clock, search } = stockApp()
    library.add({ id: 201, tags: 'coffee cup' })
    const first = await search({ q: 'Coffee  cup' })
    clock.now += 24 * 60 * 60 * 1000 - 1
    expect(await search({ q: 'coffee cup' })).toEqual(first)
    expect(library.requests).toHaveLength(1)
    clock.now += 1
    expect(await search({ q: 'coffee cup' })).toEqual(first)
    expect(library.requests).toHaveLength(2)
  })

  it('sends the same search asked at once to Pixabay once', async () => {
    const { library, search } = stockApp()
    library.add({ id: 202, tags: 'tea' })
    const answers = await Promise.all([search({ q: 'tea' }), search({ q: 'tea' }), search({ q: 'TEA' })])
    expect(answers.map(({ status }) => status)).toEqual([200, 200, 200])
    expect(library.requests).toHaveLength(1)
  })

  it('keeps to its requests a minute, also when they come at once, and takes more once the minute has passed', async () => {
    const { library, clock, search } = stockApp({ perMinute: 2 })
    const answers = await Promise.all([search({ q: 'one' }), search({ q: 'two' }), search({ q: 'three' })])
    expect(answers.map(({ status }) => status).sort()).toEqual([200, 200, 429])
    expect(answers.find(({ status }) => status === 429)?.json).toEqual({
      error:
        'Dazbee has searched Pixabay as often as it may for now (2 times a minute, as Pixabay asks); try again in a minute',
    })
    expect(library.requests).toHaveLength(2)
    clock.now += 60_000
    expect((await search({ q: 'four' })).status).toBe(200)
    expect(library.requests).toHaveLength(3)
  })

  it('stops asking Pixabay until the time it names once it turns a search away (429)', async () => {
    const { library, clock, search } = stockApp()
    library.answerNext(() => new Response('Too many requests', { status: 429, headers: { 'x-ratelimit-reset': '30' } }))
    expect((await search({ q: 'busy' })).status).toBe(429)
    clock.now += 29_000
    expect((await search({ q: 'busy' })).status).toBe(429)
    expect(library.requests).toHaveLength(1)
    clock.now += 1_000
    expect((await search({ q: 'busy' })).status).toBe(200)
    expect(library.requests).toHaveLength(2)
  })

  it.each([
    ['fails', () => new Response('oops', { status: 500 })],
    ['refuses its key', () => new Response('[ERROR 400] "key" is invalid.', { status: 400 })],
    ['answers what is not its JSON', () => new Response('<html>', { status: 200 })],
    [
      'can’t be reached',
      () => {
        throw new TypeError('fetch failed')
      },
    ],
  ])('answers 502 when Pixabay %s, caching nothing', async (_case, answer) => {
    const { library, search } = stockApp()
    library.answerNext(answer)
    const failed = await search({ q: 'shoe' })
    expect(failed.status).toBe(502)
    expect((failed.json as { error: string }).error).toMatch(/^Pixabay/)
    expect(JSON.stringify(failed.json)).not.toContain(KEY)
    expect((await search({ q: 'shoe' })).status).toBe(200)
    expect(library.requests).toHaveLength(2)
  })

  it('refuses a search with no words, or one past 100 characters, or a colour Pixabay doesn’t know', async () => {
    const { library, search } = stockApp()
    expect((await search({ q: ' ' })).status).toBe(400)
    expect((await search({ q: 'x'.repeat(101) })).status).toBe(400)
    expect((await search({ q: 'shoe', colour: 'mauve' })).status).toBe(400)
    expect(library.requests).toHaveLength(0)
  })

  it('says stock search is off when the server has no Pixabay key', async () => {
    const { search, add } = stockApp({ stock: false })
    const off = {
      error:
        'Stock photo search is off on this Dazbee server (it has no Pixabay key), so trying again won’t help; use pictures from links or the brand’s own images instead',
    }
    expect(await search({ q: 'shoe' })).toEqual({ status: 503, json: off })
    expect(await add(101)).toEqual({ status: 503, json: off })
  })

  it('refuses a Reviewer, asking Pixabay nothing', async () => {
    const { library, search } = stockApp()
    expect((await search({ q: 'shoe' }, 'r')).status).toBe(403)
    expect(library.requests).toHaveLength(0)
  })

  it('keeps each member to their searches a minute, so no one uses up Pixabay’s for every workspace', async () => {
    const { search } = stockApp()
    for (let i = 0; i < STOCK_SEARCHES_PER_MINUTE; i++) expect((await search({ q: 'shoe' })).status).toBe(200)
    expect(await search({ q: 'shoe' })).toEqual({
      status: 429,
      json: {
        error: `This member has searched stock photos as often as they may for now (${STOCK_SEARCHES_PER_MINUTE} times a minute); try again in a minute`,
      },
    })
    expect((await search({ q: 'shoe' }, 'editor')).status).toBe(200)
  })
})

// Recording a picture makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe('POST /brands/:brandId/assets/from-stock', { timeout: 30_000 }, () => {
  it('saves a photo a search found into the library, named from its tags and tagged with Pixabay and its photographer', async () => {
    const { library, search, add } = stockApp()
    const photo = library.add({ id: 301, tags: 'yellow flowers, spring, garden', user: 'Hans-Peter' })
    const bytes = png(12, 8, `${run}-stock-301`)
    serveDownload(photo.largeImageURL, bytes)
    await search({ q: 'flowers' })
    const added = await add(301)
    expect(added.status).toBe(201)
    expect(AssetSummary.parse(added.json)).toMatchObject({
      brandId: brand.id,
      sha256: sha256(bytes),
      width: 12,
      height: 8,
      name: 'Yellow flowers, spring, garden',
      tags: ['stock', 'pixabay', 'hans-peter'],
    })
    expect(library.requests).toHaveLength(1)
    expect(sites.visits.at(-1)).toMatchObject({ host: 'pixabay.com', path: '/get/g301_1280.png' })
  })

  it('names a photo from its first tags, whole and once each, when Pixabay gives many', async () => {
    const { library, add } = stockApp()
    const photo = library.add({ id: 306, tags: LONG_TAGS })
    serveDownload(photo.largeImageURL, png(7, 5, `${run}-stock-306`))
    expect(AssetSummary.parse((await add(306)).json).name).toBe('Skateboard, skater, teen, style, sports, young')
  })

  it('looks a photo up by its id when no search found it', async () => {
    const { library, add } = stockApp()
    const photo = library.add({ id: 302, tags: 'desk' })
    serveDownload(photo.largeImageURL, png(5, 5, `${run}-stock-302`))
    expect((await add(302)).status).toBe(201)
    expect(library.requests.map((url) => url.searchParams.get('id'))).toEqual(['302'])
  })

  it('says so when Pixabay has no photo of the id', async () => {
    const { add } = stockApp()
    expect(await add(999_999)).toEqual({
      status: 400,
      json: { error: 'Pixabay has no photo with the id 999999; search again and use an id it answers' },
    })
  })

  it('tells a failed download as a sentence, after looking the photo up again in case its link had lapsed', async () => {
    const { library, search, add } = stockApp()
    library.add({ id: 303, tags: 'broken link', largeImageURL: 'https://pixabay.com/get/missing_1280.png' })
    await search({ q: 'broken' })
    const failed = await add(303)
    expect(failed).toEqual({
      status: 502,
      json: { error: 'Dazbee couldn’t download Pixabay’s photo 303; try again in a moment, or pick another photo' },
    })
    expect(library.requests.map((url) => url.searchParams.get('id'))).toEqual([null, '303'])
  })

  it('downloads a fresh link when the cached one has lapsed', async () => {
    const { library, search, add } = stockApp()
    library.add({ id: 304, tags: 'lapsed', largeImageURL: 'https://pixabay.com/get/old_1280.png' })
    await search({ q: 'lapsed' })
    const fresh = library.add({ id: 304, tags: 'lapsed', largeImageURL: 'https://pixabay.com/get/new304_1280.png' })
    serveDownload(fresh.largeImageURL, png(6, 6, `${run}-stock-304`))
    expect((await add(304)).status).toBe(201)
  })

  it('refuses a Reviewer, and an id that is not a whole number, asking Pixabay nothing', async () => {
    const { library, add } = stockApp()
    expect((await add(305, 'r')).status).toBe(403)
    expect((await add('305')).status).toBe(400)
    expect(library.requests).toHaveLength(0)
  })
})

describe('pixabayFromEnv', () => {
  it('turns stock search on only when PIXABAY_API_KEY is set', () => {
    expect(pixabayFromEnv({})).toBeNull()
    expect(pixabayFromEnv({ PIXABAY_API_KEY: '  ' })).toBeNull()
    expect(pixabayFromEnv({ PIXABAY_API_KEY: KEY })).not.toBeNull()
  })
})
