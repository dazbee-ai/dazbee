// What an agent's token reaches, on the app built as main.ts builds it, with the development session on,
// against Postgres from Docker Compose (`docker compose up -d --wait postgres`): one case per way an agent
// could reach more than its access and its member allow.
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { agentAccesses, brands, memberships, newId, users } from '@dazbee/db'
import { AgentMe, AssetSummary, BrandSummary, type MemberRole, SyncToken } from '@dazbee/schema'
import { verifySyncToken } from '@dazbee/sync-token'

import { createApp } from '../app.ts'
import { seedDevelopment, sessionOfRequest } from '../sign-in/session.ts'
import { bundledKey } from '../storage-keys.ts'
import { addPerson, addWorkspace, db, request, sessionSecret, storage, syncSecret, uploadImage } from '../test-api.ts'
import { png, sha256 } from '../test-files.ts'
import { issueTokens, makeAccess, refreshTokens } from './agent-accesses.ts'

const HOUR = 60 * 60 * 1000

/** The routes an agent may ask, written out here apart from the app's own list, so a change to either shows. */
const AGENTS_ROUTES = [
  'GET /agent/me',
  'GET /workspaces/:workspaceId/brands',
  'GET /workspaces/:workspaceId/brands/:brandId/designs',
  'POST /workspaces/:workspaceId/brands/:brandId/designs',
  'GET /workspaces/:workspaceId/brands/:brandId/assets',
  'GET /workspaces/:workspaceId/brands/:brandId/assets/:assetId',
  'POST /workspaces/:workspaceId/brands/:brandId/assets/from-url',
  'GET /workspaces/:workspaceId/stock/photos',
  'POST /workspaces/:workspaceId/brands/:brandId/assets/from-stock',
  'POST /workspaces/:workspaceId/brands/:brandId/assets/from-bundle',
  'GET /workspaces/:workspaceId/brands/:brandId/fonts',
  'GET /workspaces/:workspaceId/brands/:brandId/fonts/faces/:faceId',
  'GET /workspaces/:workspaceId/brands/:brandId/kit',
  'POST /workspaces/:workspaceId/brands/:brandId/kit/from-website',
  'POST /workspaces/:workspaceId/brands/:brandId/designs/:designId/sync-token',
]

const app = createApp({
  db,
  storage,
  sessionOf: sessionOfRequest({ db, secret: sessionSecret, dev: true }),
  syncSecret,
  build: 'test-build',
})

/** Asks the app with `token` as the bearer token, or with none. */
async function ask(token: string | null, method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as unknown) }
}

/**
 * A workspace with two brands and a member of it in `role`, limited to the first brand when `limited`, who
 * gave an agent an access to `brands` (indexes of the two; all the member sees when not given) that writes
 * unless `writes` is false; with the access's token pair.
 */
async function agent({
  role = 'editor',
  limited = false,
  brands: chosen,
  writes = true,
  issuedAt = new Date(),
}: { role?: MemberRole; limited?: boolean; brands?: number[]; writes?: boolean; issuedAt?: Date } = {}) {
  const workspace = await addWorkspace()
  const made = [
    { id: newId(), workspaceId: workspace.id, name: 'First' },
    { id: newId(), workspaceId: workspace.id, name: 'Second' },
  ]
  await db.insert(brands).values(made)
  const person = await addPerson([limited ? [workspace.id, role, [made[0]?.id ?? '']] : [workspace.id, role]])
  const brandIds = chosen ? chosen.map((i) => made[i]?.id ?? '') : null
  const access = { userId: person.id, workspaceId: workspace.id, brandIds, writes, clientId: null }
  const accessId = await makeAccess(db, { ...access, clientName: 'Claude Code' })
  const tokens = await issueTokens(db, accessId, issuedAt)
  const brand = (i: number) => `/workspaces/${workspace.id}/brands/${made[i]?.id}`
  return { workspace, brands: made, person, accessId, ...tokens, brand }
}

/** The status of an agent's ask for its access, which every live token may make. */
const me = async (token: string) => (await ask(token, 'GET', '/agent/me')).status

/** Makes a design in the agent's first brand as its member; its id. */
async function designOf(a: Awaited<ReturnType<typeof agent>>) {
  const made = await request(a.person.as, 'POST', `${a.brand(0)}/designs`, { name: 'Spring' })
  return (made.json as { id: string }).id
}

beforeAll(async () => {
  await seedDevelopment(db)
})

describe('an agent token on the app as main.ts builds it', () => {
  it('reaches its access, and every route an agent uses', async () => {
    const a = await agent({ role: 'owner' })
    const mine = await ask(a.accessToken, 'GET', '/agent/me')
    expect(mine.status).toBe(200)
    expect(AgentMe.parse(mine.json)).toEqual({
      id: a.accessId,
      workspaceId: a.workspace.id,
      brandIds: null,
      writes: true,
      clientName: 'Claude Code',
    })
    const listed = await ask(a.accessToken, 'GET', `/workspaces/${a.workspace.id}/brands`)
    expect(
      BrandSummary.array()
        .parse(listed.json)
        .map((b) => b.name),
    ).toEqual(['First', 'Second'])
    const made = await ask(a.accessToken, 'POST', `${a.brand(0)}/designs`, { name: 'Made by an agent' })
    expect(made.status).toBe(201)
    const { asset } = await uploadImage(a.person.as, a.brands[0]?.id ?? '', png(4, 4, `agent-${a.accessId}`))
    for (const path of ['/designs', '/assets', `/assets/${asset.id}`, '/fonts', '/kit'])
      expect([path, (await ask(a.accessToken, 'GET', `${a.brand(0)}${path}`)).status]).toEqual([path, 200])
    expect(await ask(a.accessToken, 'GET', `${a.brand(0)}/fonts/faces/missing`)).toEqual({
      status: 404,
      json: { error: 'No such font' },
    })
  })

  it.each([
    ['GET', '/me'],
    ['GET', '/workspaces/:w'],
    ['GET', '/workspaces/:w/members'],
    ['POST', '/workspaces/:w/leave'],
    ['GET', '/workspaces/:w/agent-accesses'],
    ['POST', '/workspaces/:w/brands'],
    ['PUT', '/workspaces/:w/brands/:b/kit'],
    ['GET', '/workspaces/:w/brands/:b/templates'],
    ['GET', '/workspaces/:w/brands/:b/designs/:d'],
    ['DELETE', '/workspaces/:w/brands/:b/designs/:d'],
    ['GET', '/workspaces/:w/brands/:b/designs/:d/versions'],
    ['GET', '/workspaces/:w/brands/:b/assets/:a/uses'],
    ['GET', '/workspaces/:w/brands/:b/designs/'],
    ['GET', '/admin/requests'],
    ['GET', '/agent/me/more'],
  ])('answers 403 to %s %s, outside the agents’ routes', async (method, pattern) => {
    const a = await agent({ role: 'owner' })
    const design = await designOf(a)
    const path = pattern
      .replace(':w', a.workspace.id)
      .replace(':b', a.brands[0]?.id ?? '')
      .replace(':d', design)
      .replace(':a', 'asset')
    expect(await ask(a.accessToken, method, path)).toEqual({ status: 403, json: { error: 'Agents may not do this' } })
  })

  it('answers 403 on every route of the app but the agents’, whatever route is added later', async () => {
    const a = await agent({ role: 'owner' })
    const routes = [
      ...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)),
    ].filter((route) => !AGENTS_ROUTES.includes(route))
    expect(routes.length).toBeGreaterThan(40)
    const answered = []
    for (const route of routes) {
      const [method = '', pattern = ''] = route.split(' ')
      const path = pattern.replace(':workspaceId', a.workspace.id).replace(/:\w+/g, 'any')
      const { status } = await ask(a.accessToken, method, path, method === 'GET' ? undefined : {})
      if (status !== 403) answered.push(`${route}: ${status}`)
    }
    expect(answered).toEqual([])
  })

  it('answers 401, never the development session, to an ended, expired, refresh or made-up token', async () => {
    const a = await agent()
    await db.update(agentAccesses).set({ endedAt: new Date() }).where(eq(agentAccesses.id, a.accessId))
    const expired = await agent({ issuedAt: new Date(Date.now() - 2 * HOUR) })
    const live = await agent()
    const dead = [
      a.accessToken,
      expired.accessToken,
      live.refreshToken,
      `dazbee_at_${'x'.repeat(43)}`,
      'dazbee_rt_x',
      live.accessToken.toUpperCase(),
    ]
    for (const token of dead) {
      for (const [method, path] of [
        ['GET', '/agent/me'],
        ['GET', '/me'],
        ['GET', `/workspaces/${a.workspace.id}/brands`],
      ] as const)
        expect([token, path, (await ask(token, method, path)).status]).toEqual([token, path, 401])
    }
    expect((await ask(null, 'GET', '/me')).status).toBe(200)
  })

  it('answers 401 once its member is removed, and still once they are invited back', async () => {
    const a = await agent()
    const owner = await addPerson([[a.workspace.id, 'owner']])
    expect(await me(a.accessToken)).toBe(200)
    expect((await request(owner.as, 'DELETE', `/workspaces/${a.workspace.id}/members/${a.person.id}`)).status).toBe(204)
    expect(await me(a.accessToken)).toBe(401)
    await db.insert(memberships).values({ workspaceId: a.workspace.id, userId: a.person.id, role: 'editor' })
    expect(await me(a.accessToken)).toBe(401)
  })

  it('answers 401 once its member leaves the workspace', async () => {
    const a = await agent()
    expect((await request(a.person.as, 'POST', `/workspaces/${a.workspace.id}/leave`)).status).toBe(204)
    await db.insert(memberships).values({ workspaceId: a.workspace.id, userId: a.person.id, role: 'editor' })
    expect(await me(a.accessToken)).toBe(401)
  })

  it('answers 401 while its membership is gone, however it went', async () => {
    const a = await agent()
    await db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, a.workspace.id), eq(memberships.userId, a.person.id)))
    expect(await me(a.accessToken)).toBe(401)
  })

  it('answers 401 once its member’s account is deleted', async () => {
    const a = await agent()
    await db.delete(users).where(eq(users.id, a.person.id))
    expect(await me(a.accessToken)).toBe(401)
  })

  it('answers 404 in another workspace of its member', async () => {
    const a = await agent()
    const { id: second } = await addWorkspace()
    await db.insert(memberships).values({ workspaceId: second, userId: a.person.id, role: 'owner' })
    expect((await ask(a.accessToken, 'GET', `/workspaces/${second}/brands`)).status).toBe(404)
  })

  it('answers 404 for a brand outside its access, and lists only its own', async () => {
    const a = await agent({ brands: [0] })
    expect((await ask(a.accessToken, 'GET', `${a.brand(1)}/designs`)).status).toBe(404)
    expect((await ask(a.accessToken, 'GET', `${a.brand(0)}/designs`)).status).toBe(200)
    const listed = await ask(a.accessToken, 'GET', `/workspaces/${a.workspace.id}/brands`)
    expect(
      BrandSummary.array()
        .parse(listed.json)
        .map((b) => b.name),
    ).toEqual(['First'])
  })

  it('answers 404 for a brand its member is limited away from, though the access names every brand', async () => {
    const a = await agent({ limited: true })
    expect((await ask(a.accessToken, 'GET', `${a.brand(1)}/designs`)).status).toBe(404)
    expect((await ask(a.accessToken, 'GET', `${a.brand(0)}/designs`)).status).toBe(200)
  })

  it('answers 404 for a brand only the access names, which its member is limited away from', async () => {
    const a = await agent({ limited: true, brands: [1] })
    expect((await ask(a.accessToken, 'GET', `${a.brand(1)}/designs`)).status).toBe(404)
    expect((await ask(a.accessToken, 'GET', `${a.brand(0)}/designs`)).status).toBe(404)
  })

  it('answers 403 to a view access making a design, and signs its sync token as a Reviewer’s', async () => {
    const a = await agent({ role: 'owner', writes: false })
    expect((await ask(a.accessToken, 'POST', `${a.brand(0)}/designs`, { name: 'No' })).status).toBe(403)
    expect(
      (await ask(a.accessToken, 'POST', `${a.brand(0)}/assets/from-url`, { url: 'https://a.test/a.png' })).status,
    ).toBe(403)
    const design = await designOf(a)
    const asked = await ask(a.accessToken, 'POST', `${a.brand(0)}/designs/${design}/sync-token`)
    const signed = verifySyncToken(syncSecret, SyncToken.parse(asked.json).token, design)
    expect(signed).toMatchObject({ ok: true, payload: { role: 'reviewer', userId: a.person.id } })
  })

  it('adds a bundled file to its brand’s asset library, the same bytes once, and answers 403 to a view access', async () => {
    const a = await agent({ role: 'editor' })
    const bytes = png(4, 4, `sticker-${a.accessId}`)
    await storage.put(bundledKey(sha256(bytes)), bytes, 'image/png')
    const input = { sha256: sha256(bytes), name: 'Rocket · Fluent Emoji', tags: ['sticker'] }
    const added = await ask(a.accessToken, 'POST', `${a.brand(0)}/assets/from-bundle`, input)
    expect(added.status).toBe(201)
    const asset = AssetSummary.parse(added.json)
    expect(asset).toMatchObject({ name: input.name, tags: ['sticker'], contentType: 'image/png', width: 4, height: 4 })
    const again = await ask(a.accessToken, 'POST', `${a.brand(0)}/assets/from-bundle`, input)
    expect(AssetSummary.parse(again.json).id).toBe(asset.id)
    const unknown = { ...input, sha256: sha256(png(4, 4, `not-bundled-${a.accessId}`)) }
    expect((await ask(a.accessToken, 'POST', `${a.brand(0)}/assets/from-bundle`, unknown)).status).toBe(404)

    const viewer = await agent({ role: 'owner', writes: false })
    expect((await ask(viewer.accessToken, 'POST', `${viewer.brand(0)}/assets/from-bundle`, input)).status).toBe(403)
  })

  it('signs a writing access’s sync token as an Editor’s at most, with the agent’s name or "AI agent"', async () => {
    const a = await agent({ role: 'owner' })
    const design = await designOf(a)
    const path = `${a.brand(0)}/designs/${design}/sync-token`
    const named = SyncToken.parse((await ask(a.accessToken, 'POST', path, { agent: 'Claude Code (agent)' })).json)
    expect(verifySyncToken(syncSecret, named.token, design)).toMatchObject({
      ok: true,
      payload: { role: 'editor', agent: 'Claude Code (agent)', name: a.person.name },
    })
    const unnamed = SyncToken.parse((await ask(a.accessToken, 'POST', path)).json)
    expect(verifySyncToken(syncSecret, unnamed.token, design)).toMatchObject({
      ok: true,
      payload: { agent: 'AI agent' },
    })
    const blank = SyncToken.parse((await ask(a.accessToken, 'POST', path, { agent: ' \u0000\n' })).json)
    expect(verifySyncToken(syncSecret, blank.token, design)).toMatchObject({ ok: true, payload: { agent: 'AI agent' } })
    const marked = SyncToken.parse((await ask(a.accessToken, 'POST', path, { agent: 'Cla\u001bu‮de' })).json)
    expect(verifySyncToken(syncSecret, marked.token, design)).toMatchObject({ ok: true, payload: { agent: 'Claude' } })
    const long = SyncToken.parse((await ask(a.accessToken, 'POST', path, { agent: 'a'.repeat(1000) })).json)
    expect(verifySyncToken(syncSecret, long.token, design)).toMatchObject({
      ok: true,
      payload: { agent: 'a'.repeat(64) },
    })
  })

  it('goes on when a refresh token is used again within 30 seconds, and answers 401 once it is used later', async () => {
    const now = new Date()
    const a = await agent({ issuedAt: now })
    const refreshed = await refreshTokens(db, a.refreshToken, now)
    if (!refreshed.ok) throw new Error('the refresh was refused')
    expect(await refreshTokens(db, a.refreshToken, new Date(now.getTime() + 30_000))).toEqual({
      ok: false,
      error: 'invalid_grant',
    })
    expect(await me(refreshed.tokens.accessToken)).toBe(200)
    expect(await refreshTokens(db, a.refreshToken, new Date(now.getTime() + 31_000))).toEqual({
      ok: false,
      error: 'invalid_grant',
    })
    expect(await me(refreshed.tokens.accessToken)).toBe(401)
    expect(await me(a.accessToken)).toBe(401)
  })

  it('answers 403 to a person’s session asking for an agent’s access', async () => {
    const a = await agent()
    expect((await request(a.person.as, 'GET', '/agent/me')).status).toBe(403)
  })
})
