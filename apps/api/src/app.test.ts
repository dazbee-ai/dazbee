// What holds on every route of the app, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`): a Reviewer changes nothing, a workspace is hidden from anyone
// who is not its member, a brand from a member limited to others, and the one error mapping. A design or
// template the API stored is valid, so `createDesign` is made to refuse one here to reach the routes that
// copy stored content into a new design.
import { describe, expect, it, vi } from 'vitest'

import { ApiError, BrandSummary, DesignSummary, TemplateSummary } from '@dazbee/schema'

import { addPerson, app, brand, call, request, sibling, workspace } from './test-api.ts'
import { createDesign, InvalidContent } from './workspace/designs.ts'

vi.mock('./workspace/designs.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workspace/designs.ts')>()
  return { ...actual, createDesign: vi.fn(actual.createDesign) }
})

/** The routes that change nothing, though they are not GET: a Reviewer opens designs view-only. */
const READ_ONLY = ['POST /workspaces/:workspaceId/brands/:brandId/designs/:designId/sync-token']

/**
 * The routes any member calls on their own membership, which change nothing else: leaving, and giving or ending
 * an agent access of their own (a Reviewer's views only).
 */
const OWN_MEMBERSHIP = [
  'POST /workspaces/:workspaceId/leave',
  'POST /workspaces/:workspaceId/agent-accesses',
  'DELETE /workspaces/:workspaceId/agent-accesses/:accessId',
]

/** The routes only an Owner or Admin may call. */
const MANAGER_ONLY = [
  'PATCH /workspaces/:workspaceId',
  'PATCH /workspaces/:workspaceId/members/:userId',
  'DELETE /workspaces/:workspaceId/members/:userId',
  'POST /workspaces/:workspaceId/invites',
  'POST /workspaces/:workspaceId/invites/:inviteId/resend',
  'DELETE /workspaces/:workspaceId/invites/:inviteId',
]

/** The routes only the Owner may call: handing over Owner. */
const OWNER_ONLY = ['POST /workspaces/:workspaceId/members/:userId/owner']

/**
 * The paths outside a workspace: the gate that keeps agents' tokens to their routes, the health check,
 * sign-in's, the development invites' accept, the person's own, an agent's own, an agent's sign-in and the
 * request to join. Early access's admin routes, under /admin, are checked in `admin/routes.test.ts`.
 */
const OUTSIDE_A_WORKSPACE = [
  '/*',
  '/agent/*',
  '/agent/me',
  '/agent/clients',
  '/agent/authorizations',
  '/agent/authorizations/:request',
  '/agent/authorizations/:request/deny',
  '/agent/tokens',
  '/agent/tokens/revoke',
  '/health',
  '/auth/sign-in-url',
  '/auth/callback',
  '/auth/sign-out',
  '/auth/dev/accept',
  '/me',
  '/me/*',
  '/me/deletion',
  '/access-requests',
  '/uploads/:token',
  '/fonts/google/faces/:name',
  '/fonts/google/lists/:name',
  '/fonts/google/*',
]

const WRITER_REFUSAL = 'Only an Owner, Admin or Editor can do this'
const MANAGER_REFUSAL = 'Only an Owner or Admin can do this'
const OWNER_REFUSAL = 'Only the Owner can hand over Owner'

/**
 * The paths of the app's `use` middleware, once for each handler, which Hono lists with the method ALL,
 * as it would an `all` route.
 */
const MIDDLEWARE_PATHS = [
  '/*',
  '/admin/*',
  '/fonts/google/*',
  '/me',
  '/me/*',
  '/agent/*',
  '/workspaces/:workspaceId/*',
  '/workspaces/:workspaceId/*',
  '/workspaces/:workspaceId/brands/:brandId/*',
]

/** Whether `path` is a workspace's own path or below it. */
const inAWorkspace = (path: string) =>
  path === '/workspaces/:workspaceId' || path.startsWith('/workspaces/:workspaceId/')

/**
 * Every route of a workspace that changes something, as `METHOD /path`, read from the app so a route added
 * later is in it.
 */
const CHANGES = [
  ...new Set(
    app.routes
      .filter((r) => !['ALL', 'GET', 'HEAD'].includes(r.method) && inAWorkspace(r.path))
      .map((r) => `${r.method} ${r.path}`),
  ),
].filter((route) => !READ_ONLY.includes(route) && !OWN_MEMBERSHIP.includes(route))

/** Every route of a workspace, whatever its method, as `METHOD /path`, read from the app. */
const IN_A_WORKSPACE = [
  ...new Set(app.routes.filter((r) => r.method !== 'ALL' && inAWorkspace(r.path)).map((r) => `${r.method} ${r.path}`)),
]

/** One page holding one empty, white frame. */
const blank = {
  meta: { designId: 'any', name: 'Plain' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Square',
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {},
}

/** Calls `route` as `as`, in workspace A on its brand, with made-up ids and an empty body. */
function callRoute(as: string, route: string) {
  const [method = '', path = ''] = route.split(' ')
  const filled = path.replace(':workspaceId', workspace.id).replace(':brandId', brand.id).replace(/:\w+/g, 'any')
  return request(as, method, filled, method === 'GET' || method === 'HEAD' ? undefined : {})
}

describe('health', () => {
  it('answers that the API is up, and which build it runs', async () => {
    const answer = await app.request('/health')
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true, build: 'test-build' })
  })
})

describe('roles', () => {
  it('has no handler for every method, only the agents’ gate, the session and brand checks and what the Google addresses keep, so the sweeps reach every handler', () => {
    expect(app.routes.filter((r) => r.method === 'ALL').map((r) => r.path)).toEqual(MIDDLEWARE_PATHS)
  })

  it('refuses a Reviewer every route that changes something, with 403, whatever route is added later', async () => {
    const routes = app.routes.map((r) => `${r.method} ${r.path}`)
    expect(routes).toEqual(
      expect.arrayContaining([
        ...READ_ONLY,
        ...OWN_MEMBERSHIP,
        ...MANAGER_ONLY,
        ...OWNER_ONLY,
        'PUT /workspaces/:workspaceId/brands/:brandId/kit',
      ]),
    )
    const answered = []
    for (const route of CHANGES) {
      const { status, json } = await callRoute('r', route)
      const expected = OWNER_ONLY.includes(route)
        ? OWNER_REFUSAL
        : MANAGER_ONLY.includes(route)
          ? MANAGER_REFUSAL
          : WRITER_REFUSAL
      if (status !== 403 || ApiError.parse(json).error !== expected) answered.push(`${route}: ${status}`)
    }
    expect(answered).toEqual([])
  })

  it('lets an Editor through every route that changes something but the workspace’s own and its members’', async () => {
    const refused = []
    for (const route of CHANGES.filter((r) => !MANAGER_ONLY.includes(r) && !OWNER_ONLY.includes(r))) {
      if ((await callRoute('editor', route)).status === 403) refused.push(route)
    }
    expect(refused).toEqual([])
  })
})

describe('workspaces', () => {
  it('has no route outside a workspace but the health check, /me, sign-in, the development accept, the request to join, upload links, the Google font files and /admin, whatever route is added later', () => {
    const outside = app.routes
      .map((r) => r.path)
      .filter((path) => !inAWorkspace(path) && !OUTSIDE_A_WORKSPACE.includes(path) && !path.startsWith('/admin/'))
    expect([...new Set(outside)]).toEqual([])
  })

  it('answers a person who is not a member "No such workspace" on every route of the workspace, whatever route is added later', async () => {
    expect(IN_A_WORKSPACE).toEqual(
      expect.arrayContaining(['GET /workspaces/:workspaceId', 'GET /workspaces/:workspaceId/brands/:brandId/kit']),
    )
    const answered = []
    for (const route of IN_A_WORKSPACE) {
      const { status, json } = await callRoute('b', route)
      if (status !== 404 || ApiError.parse(json).error !== 'No such workspace') answered.push(`${route}: ${status}`)
    }
    expect(answered).toEqual([])
  })
})

describe('brand limits', () => {
  it('answers an Editor limited to another brand "No such brand" on every route of a brand, whatever route is added later', async () => {
    const limited = await addPerson([[workspace.id, 'editor', [sibling.id]]])
    const brandRoutes = IN_A_WORKSPACE.filter((route) => route.includes('/brands/:brandId'))
    expect(brandRoutes).toEqual(
      expect.arrayContaining([
        'GET /workspaces/:workspaceId/brands/:brandId/kit',
        'POST /workspaces/:workspaceId/brands/:brandId/designs/:designId/sync-token',
      ]),
    )
    const answered = []
    for (const route of brandRoutes) {
      const { status, json } = await callRoute(limited.as, route)
      if (status !== 404 || ApiError.parse(json).error !== 'No such brand') answered.push(`${route}: ${status}`)
    }
    expect(answered).toEqual([])
  })

  it('lists a limited Editor only their brands, and refuses them a new brand with 403', async () => {
    const limited = await addPerson([[workspace.id, 'editor', [sibling.id]]])
    expect(BrandSummary.array().parse((await call(limited.as, 'GET', '/brands')).json)).toEqual([
      { id: sibling.id, name: sibling.name },
    ])
    const refused = await call(limited.as, 'POST', '/brands', { name: 'Mine' })
    expect(refused).toEqual({ status: 403, json: { error: 'A member limited to some brands can’t add one' } })
    // Unlimited, the same Editor sees and adds brands.
    expect(BrandSummary.array().parse((await call('editor', 'GET', '/brands')).json).length).toBeGreaterThan(1)
  })
})

// Saving a template draws its thumbnail with CanvasKit, which takes seconds on a busy CI runner.
describe('errors', { timeout: 60_000 }, () => {
  it('answers a design that is not valid with 400 and why, on the duplicate and start-from-template routes too', async () => {
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Plain' })).json)
    vi.mocked(createDesign).mockRejectedValueOnce(new InvalidContent('nodes.x: broken'))
    expect(await call('a', 'POST', `/brands/${brand.id}/designs/${design.id}/duplicate`, {})).toEqual({
      status: 400,
      json: { error: 'The design is not valid: nodes.x: broken' },
    })

    const saved = await call('a', 'POST', `/brands/${brand.id}/templates`, {
      name: 'Plain',
      scope: 'brand',
      content: blank,
    })
    expect(saved.status).toBe(201)
    const template = TemplateSummary.parse(saved.json)
    vi.mocked(createDesign).mockRejectedValueOnce(new InvalidContent('nodes.y: broken'))
    expect(await call('a', 'POST', `/brands/${brand.id}/templates/${template.id}/designs`, {})).toEqual({
      status: 400,
      json: { error: 'The design is not valid: nodes.y: broken' },
    })
  })
})
