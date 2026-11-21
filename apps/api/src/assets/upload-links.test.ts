// An agent's upload links, through the routes: asking for one under a brand, then sending one file to it with no
// session, against Postgres and storage from Docker Compose.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dazbeeInvites, newId } from '@dazbee/db'
import { AssetLink, AssetSummary, MAX_SVG_BYTES, MAX_UPLOAD_BYTES, UPLOAD_LINK_MS, UploadLink } from '@dazbee/schema'

import { endAccess, issueTokens, makeAccess } from '../agents/agent-accesses.ts'
import { createApp } from '../app.ts'
import { sessionOfRequest } from '../sign-in/session.ts'
import {
  addPerson,
  authorization,
  brand,
  db,
  otherBrand,
  personA,
  run,
  sessionSecret,
  sibling,
  storage,
  syncSecret,
  workspace,
} from '../test-api.ts'
import { png, sha256, slowPathsSvg } from '../test-files.ts'
import { addingFromOutside } from './from-url.ts'
import { readSvgAsset } from './svg-assets.ts'
import { MAX_RECEIVING_AT_ONCE, RECEIVE_TIMEOUT_MS, UPLOADS_PER_ADDRESS_PER_HOUR } from './upload-links.ts'

const app = createApp({
  db,
  storage,
  sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
  syncSecret,
  build: 'test-build',
})

afterEach(() => {
  vi.useRealTimers()
})

/** A small SVG logo whose colour comes from `seed`. */
const svg = (seed: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#${sha256(new TextEncoder().encode(seed)).slice(0, 6)}"/></svg>`,
  )

/** An agent access token of Ann, the Owner of the workspace, with `options`: every brand and editing unless given. */
async function agentToken(options: { brandIds?: string[] | null; writes?: boolean } = {}) {
  const access = await makeAccess(db, {
    userId: personA.id,
    workspaceId: workspace.id,
    brandIds: options.brandIds ?? null,
    writes: options.writes ?? true,
    clientId: null,
    clientName: 'Claude Code',
  })
  const { accessToken } = await issueTokens(db, access, new Date())
  return { access, headers: { authorization: `Bearer ${accessToken}` } }
}

/** Asks for an upload link of the brand (`brand` unless given) with `body`, as the bearer `headers`. */
async function askLink(body: Record<string, unknown>, headers: Record<string, string>, { brandId = brand.id } = {}) {
  const response = await app.request(`/workspaces/${workspace.id}/brands/${brandId}/assets/upload-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}

/** A new link for `body`, asked by an agent that edits every brand. */
async function newLink(body: Record<string, unknown>) {
  const { headers } = await agentToken()
  const asked = await askLink(body, headers)
  expect(asked.status).toBe(201)
  return UploadLink.parse(asked.json)
}

/** Sends `bytes` to the link's path with no session, as `curl -T` does, with any `headers` given. */
async function send(path: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  const response = await app.request(path, { method: 'PUT', body: bytes, headers })
  return { status: response.status, json: (await response.json()) as unknown }
}

// Recording a picture makes its thumbnail with CanvasKit, which takes seconds to load on a busy CI runner.
describe(
  'upload links, through POST /brands/:brandId/assets/upload-links and PUT /uploads/:token',
  { timeout: 30_000 },
  () => {
    it('gives a link under /uploads/ for ten minutes, with the most bytes its type may have', async () => {
      const before = Date.now()
      const link = await newLink({ contentType: 'image/png', name: 'Shoe' })
      expect(link.path).toMatch(/^\/uploads\/[\w-]{43}$/)
      expect(link.maxBytes).toBe(MAX_UPLOAD_BYTES)
      const expires = Date.parse(link.expiresAt)
      expect(expires).toBeGreaterThanOrEqual(before + UPLOAD_LINK_MS - 1000)
      expect(expires).toBeLessThanOrEqual(Date.now() + UPLOAD_LINK_MS)
      expect((await newLink({ contentType: 'image/svg+xml', name: 'Logo' })).maxBytes).toBe(MAX_SVG_BYTES)
    })

    it.each([
      ['PNG', 'image/png', () => png(5, 3, `${run}-upload`), 5, 3],
      ['SVG', 'image/svg+xml', () => svg(`${run}-upload-svg`), 120, 40],
    ] as const)(
      'records a %s sent to the link as an asset of the brand, named and tagged',
      async (_, type, make, w, h) => {
        const bytes = make()
        const link = await newLink({ contentType: type, name: 'Studio shot', tags: ['Product'] })
        const sent = await send(link.path, bytes)
        expect(sent.status).toBe(201)
        const asset = AssetSummary.parse(sent.json)
        expect(asset).toMatchObject({
          brandId: brand.id,
          sha256: sha256(bytes),
          contentType: type,
          byteSize: bytes.length,
          width: w,
          height: h,
          name: 'Studio shot',
          tags: ['product'],
        })
        const read = await app.request(`/workspaces/${workspace.id}/brands/${brand.id}/assets/${asset.id}`, {
          headers: authorization('a'),
        })
        const stored = await fetch(AssetLink.parse(await read.json()).url)
        expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes)
      },
    )

    it('refuses a second file sent to a link, recording nothing more', async () => {
      const link = await newLink({ contentType: 'image/png', name: 'Once' })
      expect((await send(link.path, png(2, 2, `${run}-once`))).status).toBe(201)
      const again = await send(link.path, png(2, 3, `${run}-twice`))
      expect(again).toEqual({
        status: 410,
        json: { error: 'This upload link has been used; ask upload_image for a new one' },
      })
    })

    it('refuses a link past its ten minutes', async () => {
      const link = await newLink({ contentType: 'image/png', name: 'Late' })
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + UPLOAD_LINK_MS + 1000 })
      expect(await send(link.path, png(2, 2, `${run}-late`))).toEqual({
        status: 410,
        json: { error: 'This upload link has expired: a link works for 10 minutes; ask upload_image for a new one' },
      })
    })

    it.each([
      ['a token no link has', `/uploads/${'A'.repeat(43)}`],
      ['a token of the wrong shape', '/uploads/short'],
      ['a path that climbs out', '/uploads/..%2F..%2Fworkspaces'],
    ])('refuses %s', async (_, path) => {
      expect(await send(path, png(1, 1, `${run}-unknown`))).toEqual({
        status: 404,
        json: { error: 'This is not an upload link Dazbee gave; ask upload_image for one' },
      })
    })

    it('refuses a file of another type than the link’s, saying both', async () => {
      const link = await newLink({ contentType: 'image/jpeg', name: 'Wrong' })
      expect(await send(link.path, png(2, 2, `${run}-wrong`))).toEqual({
        status: 400,
        json: {
          error: 'The file is a PNG, but this link is for a JPEG; ask upload_image for a link of the file’s type',
        },
      })
    })

    it('refuses a file that is not a picture', async () => {
      const link = await newLink({ contentType: 'image/png', name: 'Text' })
      expect(await send(link.path, new TextEncoder().encode('not a picture'))).toEqual({
        status: 400,
        json: { error: 'The file is not a PNG, JPEG, WebP or SVG picture; ask upload_image for a new link' },
      })
    })

    it('refuses a file over the link’s limit, whether it says its length or not', async () => {
      const said = await newLink({ contentType: 'image/svg+xml', name: 'Big' })
      const tooBig = {
        status: 413,
        json: {
          error:
            'The file is over 5 MB, the most an SVG file may have; send a smaller one with a new link from upload_image',
        },
      }
      expect(await send(said.path, svg(`${run}-said`), { 'content-length': String(MAX_SVG_BYTES + 1) })).toEqual(tooBig)
      const streamed = await newLink({ contentType: 'image/svg+xml', name: 'Big' })
      const big = new Uint8Array(MAX_SVG_BYTES + 1).fill(0x20)
      expect(await send(streamed.path, big)).toEqual(tooBig)
    })

    it('grants no reading: the link answers nothing but a PUT, and opens no other route', async () => {
      const link = await newLink({ contentType: 'image/png', name: 'Closed' })
      for (const method of ['GET', 'POST', 'DELETE'])
        expect((await app.request(link.path, { method })).status).toBe(404)
      const token = link.path.slice('/uploads/'.length)
      const asBearer = await app.request(`/workspaces/${workspace.id}/brands/${brand.id}/assets`, {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(asBearer.status).toBe(401)
      expect((await send(link.path, png(2, 2, `${run}-closed`))).status).toBe(201)
    })

    it('adds only to the brand the link was asked for', async () => {
      const link = await newLink({ contentType: 'image/png', name: 'Own brand' })
      const asset = AssetSummary.parse((await send(link.path, png(3, 3, `${run}-own`))).json)
      expect(asset.brandId).toBe(brand.id)
      const sibling_ = await app.request(`/workspaces/${workspace.id}/brands/${sibling.id}/assets`, {
        headers: authorization('a'),
      })
      expect(
        AssetSummary.array()
          .parse(await sibling_.json())
          .some((a) => a.id === asset.id),
      ).toBe(false)
    })

    it('takes a file sent with an agent’s token as well, the token doing nothing', async () => {
      const { headers } = await agentToken({ brandIds: [sibling.id] })
      const link = await newLink({ contentType: 'image/png', name: 'With token' })
      const sent = await send(link.path, png(4, 1, `${run}-with-token`), headers)
      expect(sent.status).toBe(201)
      expect(AssetSummary.parse(sent.json).brandId).toBe(brand.id)
    })

    it('refuses a link to an access that only views, a Reviewer, and a brand outside the access', async () => {
      const viewing = await agentToken({ writes: false })
      expect((await askLink({ contentType: 'image/png', name: 'x' }, viewing.headers)).status).toBe(403)
      expect((await askLink({ contentType: 'image/png', name: 'x' }, authorization('r'))).status).toBe(403)
      const limited = await agentToken({ brandIds: [sibling.id] })
      expect(await askLink({ contentType: 'image/png', name: 'x' }, limited.headers)).toEqual({
        status: 404,
        json: { error: 'No such brand' },
      })
      expect(
        (await askLink({ contentType: 'image/png', name: 'x' }, authorization('a'), { brandId: otherBrand.id })).status,
      ).toBe(404)
    })

    it('refuses a body without a name or with a type Dazbee doesn’t take', async () => {
      const { headers } = await agentToken()
      expect((await askLink({ contentType: 'image/png' }, headers)).status).toBe(400)
      expect((await askLink({ contentType: 'image/gif', name: 'Gif' }, headers)).status).toBe(400)
    })

    it('refuses a file sent once the access that asked for the link has ended', async () => {
      const { access, headers } = await agentToken()
      const link = UploadLink.parse((await askLink({ contentType: 'image/png', name: 'Ended' }, headers)).json)
      await endAccess(db, { workspaceId: workspace.id, userId: personA.id }, access)
      expect(await send(link.path, png(2, 2, `${run}-ended`))).toEqual({
        status: 403,
        json: { error: 'The access that asked for this upload link may no longer add images to this brand' },
      })
    })

    it('keeps the link for another try when Dazbee is busy with another picture', async () => {
      const link = await newLink({ contentType: 'image/png', name: 'Busy' })
      let release = () => {}
      const holding = addingFromOutside(() => new Promise<void>((resolve) => (release = resolve)))
      const busy = await send(link.path, png(2, 2, `${run}-busy`))
      expect(busy.status).toBe(503)
      release()
      await holding
      expect((await send(link.path, png(2, 2, `${run}-busy`))).status).toBe(201)
    })

    it('refuses a member past the upload links they may ask for in an hour, across their agents', async () => {
      const limited = createApp({
        db,
        storage,
        sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
        syncSecret,
        build: 'test-build',
        fromUrlPerHour: 1,
      })
      const ask = async (headers: Record<string, string>) =>
        limited.request(`/workspaces/${workspace.id}/brands/${brand.id}/assets/upload-links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ contentType: 'image/png', name: 'Limit' }),
        })
      expect((await ask(authorization('a'))).status).toBe(201)
      const past = await ask((await agentToken()).headers)
      expect(past.status).toBe(429)
      expect(await past.json()).toEqual({
        error: 'This member has asked for as many upload links as they may in an hour (1); try again later',
      })
    })
  },
)

/** A body that sends `first`, then waits until `breakOff` ends it with an error. */
function stalled(first: Uint8Array) {
  let breakOff = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first)
      breakOff = () => controller.error(new Error('the sender went away'))
    },
  })
  return { body, breakOff: () => breakOff() }
}

/** Sends `body`, a stream, to the link's path with no session. */
async function sendStream(path: string, body: ReadableStream<Uint8Array>) {
  const response = await app.request(path, { method: 'PUT', body, duplex: 'half' } as RequestInit)
  return { status: response.status, json: (await response.json()) as unknown }
}

/** Lets a request that has just been sent reach its first wait. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300))

const brokeOff = {
  status: 400,
  json: { error: 'The file broke off before it all arrived; ask upload_image for a new one' },
}
const busy = {
  status: 503,
  json: { error: 'Dazbee is busy adding other pictures; send the file to the same link again in a minute' },
}

describe('upload links, against a sender who misuses them', { timeout: 60_000 }, () => {
  it('holds up no picture from a link while a file arrives slowly, and spends the link when it breaks off', async () => {
    const link = await newLink({ contentType: 'image/png', name: 'Slow' })
    const sender = stalled(png(2, 2, `${run}-slow`).subarray(0, 10))
    const sent = sendStream(link.path, sender.body)
    await settle()
    await expect(addingFromOutside(() => Promise.resolve('free'))).resolves.toBe('free')
    sender.breakOff()
    expect(await sent).toEqual(brokeOff)
    expect((await send(link.path, png(2, 2, `${run}-slow`))).status).toBe(410)
  })

  it('spends a link whose file takes longer than the time a file may take to arrive', async () => {
    const link = await newLink({ contentType: 'image/png', name: 'Late' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const sender = stalled(png(2, 2, `${run}-late-file`).subarray(0, 10))
    const sent = sendStream(link.path, sender.body)
    await settle()
    await vi.advanceTimersByTimeAsync(RECEIVE_TIMEOUT_MS)
    expect(await sent).toEqual({
      status: 408,
      json: { error: 'The file took longer than 60 seconds to arrive; ask upload_image for a new one' },
    })
    expect((await send(link.path, png(2, 2, `${run}-late-file`))).status).toBe(410)
  })

  it('takes only so many files arriving at once, keeping the link of one it turns away', async () => {
    const senders = await Promise.all(
      Array.from({ length: MAX_RECEIVING_AT_ONCE }, async (_, i) => {
        const link = await newLink({ contentType: 'image/png', name: `Arriving ${i}` })
        const sender = stalled(png(2, 2, `${run}-arriving`).subarray(0, 10))
        return { sender, sent: sendStream(link.path, sender.body) }
      }),
    )
    await settle()
    const turnedAway = await newLink({ contentType: 'image/png', name: 'Turned away' })
    expect(await send(turnedAway.path, png(3, 2, `${run}-turned-away`))).toEqual(busy)
    for (const { sender, sent } of senders) {
      sender.breakOff()
      expect(await sent).toEqual(brokeOff)
    }
    expect((await send(turnedAway.path, png(3, 2, `${run}-turned-away`))).status).toBe(201)
  })

  it('keeps the link when the SVG reader is busy with other files', async () => {
    const link = await newLink({ contentType: 'image/svg+xml', name: 'Busy reader' })
    const slow = new TextEncoder().encode(slowPathsSvg())
    const reading = Array.from({ length: 4 }, () => readSvgAsset(slow, 320, 300).catch(() => null))
    expect(await send(link.path, svg(`${run}-busy-reader`))).toEqual(busy)
    await Promise.all(reading)
    expect((await send(link.path, svg(`${run}-busy-reader`))).status).toBe(201)
  })

  it('refuses a picture of more pixels than a picture from outside may have, before it is decoded', async () => {
    const link = await newLink({ contentType: 'image/png', name: 'Huge' })
    const huge = png(2, 2, `${run}-huge`)
    const view = new DataView(huge.buffer, huge.byteOffset)
    view.setUint32(16, 6000)
    view.setUint32(20, 5000)
    expect(await send(link.path, huge)).toEqual({
      status: 400,
      json: {
        error:
          'The picture is over 25 megapixels, the most an agent may add; send a smaller one with a new link from upload_image',
      },
    })
  })

  it('refuses an address past the files it may send in an hour, whatever their links', async () => {
    const fresh = createApp({
      db,
      storage,
      sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: false }),
      syncSecret,
      build: 'test-build',
    })
    const put = (address: string) =>
      fresh.request('/uploads/short', { method: 'PUT', body: 'x', headers: { 'cf-connecting-ip': address } })
    for (let i = 0; i < UPLOADS_PER_ADDRESS_PER_HOUR; i++) expect((await put('203.0.113.9')).status).toBe(404)
    const past = await put('203.0.113.9')
    expect(past.status).toBe(429)
    expect(await past.json()).toEqual({
      error: `This address has sent as many files as it may in an hour (${UPLOADS_PER_ADDRESS_PER_HOUR}); try again later`,
    })
    expect((await put('203.0.113.10')).status).toBe(404)
  })

  it('refuses a file once an admin has removed the access of the person who asked for the link', async () => {
    const person = await addPerson([[workspace.id, 'editor']])
    const asked = await askLink({ contentType: 'image/png', name: 'Removed' }, authorization(person.as))
    const link = UploadLink.parse(asked.json)
    const now = new Date()
    await db.insert(dazbeeInvites).values({
      id: newId(),
      email: person.email,
      expiresAt: now,
      acceptedAt: now,
      removedAt: now,
    })
    expect(await send(link.path, png(2, 2, `${run}-removed`))).toEqual({
      status: 403,
      json: { error: 'The access that asked for this upload link may no longer add images to this brand' },
    })
  })
})
