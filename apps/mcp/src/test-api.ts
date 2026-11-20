// A stand-in for the API's agents' routes, for tests: one workspace with two brands, their designs and
// assets, and agent accesses whose tokens the tests hand out and refuse.
import { Hono } from 'hono'

import { type AgentMe, type AssetSummary, type BrandSummary, CreateDesign, type DesignSummary } from '@dazbee/schema'

/** An agent access as the tests give it. */
export interface TestAccessOptions {
  /** The brands it may open; left out, all the workspace's. */
  brandIds?: string[]
  /** Whether it edits; left out, it does. */
  writes?: boolean
}

/** One access of the fake API, which hands out its tokens. */
export interface TestAccess {
  id: string
  /** A new live access token of the access, as a refresh gives. */
  token(): string
}

/** The fake API: its `fetch`, and how the tests shape what it answers. */
export interface TestApi {
  fetch(request: Request): Promise<Response>
  grant(options?: TestAccessOptions): TestAccess
  /** Refuses `token` everywhere from now on, as the API refuses an expired token. */
  refuse(token: string): void
  /** Takes `token` on `GET /agent/me` but refuses it on every other route, as when it expires between the two. */
  refuseAfterMe(token: string): void
  /** The brand's designs as the fake API holds them. */
  designsOf(brandId: string): DesignSummary[]
}

export const TEST_WORKSPACE = 'ws-test'

export const TEST_BRANDS: BrandSummary[] = [
  { id: 'brand-summer', name: 'Summer sale' },
  { id: 'brand-winter', name: 'Winter' },
]

export const TEST_DESIGNS: DesignSummary[] = [
  {
    id: 'design-launch',
    brandId: 'brand-summer',
    name: 'Launch',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-20T10:30:00.000Z',
  },
  {
    id: 'design-snow',
    brandId: 'brand-winter',
    name: 'Snow',
    createdAt: '2026-11-02T09:00:00.000Z',
    updatedAt: '2026-11-03T09:00:00.000Z',
  },
]

export const TEST_ASSETS: AssetSummary[] = [
  {
    id: 'asset-logo',
    brandId: 'brand-summer',
    sha256: 'a'.repeat(64),
    contentType: 'image/svg+xml',
    byteSize: 1200,
    width: 400,
    height: 120,
    name: 'Logo',
    tags: ['logo'],
    createdAt: '2026-11-01T09:00:00.000Z',
  },
  {
    id: 'asset-bottle',
    brandId: 'brand-summer',
    sha256: 'b'.repeat(64),
    contentType: 'image/png',
    byteSize: 50_000,
    width: 1600,
    height: 2400,
    name: 'Bottle',
    tags: ['product', 'summer'],
    createdAt: '2026-11-01T09:00:00.000Z',
  },
]

/** A fake API holding the test workspace's brands, designs and assets. */
export function testApi(): TestApi {
  // The live tokens, each to its access; those in `afterMe` are refused past `GET /agent/me`.
  const tokens = new Map<string, AgentMe>()
  const afterMe = new Set<string>()
  // The designs, which `POST …/designs` adds to.
  const designs = TEST_DESIGNS.map((design) => ({ ...design }))
  let made = 0

  const app = new Hono<{ Variables: { agent: AgentMe } }>()

  app.use('*', async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? ''
    const agent = tokens.get(token)
    if (!agent || (afterMe.has(token) && c.req.path !== '/agent/me')) return c.json({ error: 'Sign in first' }, 401)
    c.set('agent', agent)
    await next()
  })

  app.get('/agent/me', (c) => c.json(c.var.agent))

  app.use('/workspaces/:workspaceId/*', async (c, next) => {
    if (c.req.param('workspaceId') !== c.var.agent.workspaceId) return c.json({ error: 'No such workspace' }, 404)
    await next()
  })

  app.use('/workspaces/:workspaceId/brands/:brandId/*', async (c, next) => {
    if (!visible(c.var.agent).some((brand) => brand.id === c.req.param('brandId')))
      return c.json({ error: 'No such brand' }, 404)
    await next()
  })

  app.get('/workspaces/:workspaceId/brands', (c) => c.json(visible(c.var.agent)))

  app.get('/workspaces/:workspaceId/brands/:brandId/designs', (c) =>
    c.json(designs.filter((design) => design.brandId === c.req.param('brandId'))),
  )

  app.post('/workspaces/:workspaceId/brands/:brandId/designs', async (c) => {
    if (!c.var.agent.writes) return c.json({ error: 'Only an Owner, Admin or Editor can do this' }, 403)
    const input = CreateDesign.safeParse(await c.req.json())
    if (!input.success) return c.json({ error: 'name: give 1 to 120 characters' }, 400)
    const at = new Date(Date.UTC(2026, 10, 21, 12, 0, made)).toISOString()
    const design = {
      id: `design-new-${++made}`,
      brandId: c.req.param('brandId'),
      name: input.data.name,
      createdAt: at,
      updatedAt: at,
    }
    designs.push(design)
    return c.json(design, 201)
  })

  app.get('/workspaces/:workspaceId/brands/:brandId/assets', (c) => {
    const query = (c.req.query('q') ?? '').toLowerCase()
    return c.json(
      TEST_ASSETS.filter(
        (asset) =>
          asset.brandId === c.req.param('brandId') &&
          (asset.name.toLowerCase().includes(query) || asset.tags.some((tag) => tag.includes(query))),
      ),
    )
  })

  return {
    fetch: async (request) => app.fetch(request),
    grant,
    refuse: (token) => void tokens.delete(token),
    refuseAfterMe: (token) => void afterMe.add(token),
    designsOf: (brandId) => designs.filter((design) => design.brandId === brandId),
  }

  function grant({ brandIds, writes = true }: TestAccessOptions = {}): TestAccess {
    const agent: AgentMe = {
      id: `access-${tokens.size + 1}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: TEST_WORKSPACE,
      brandIds: brandIds ?? null,
      writes,
      clientName: 'Test client',
    }
    return {
      id: agent.id,
      token: () => {
        const token = `dazbee_at_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
        tokens.set(token, agent)
        return token
      },
    }
  }
}

/** The brands an access sees. */
function visible(agent: AgentMe): BrandSummary[] {
  return TEST_BRANDS.filter((brand) => agent.brandIds === null || agent.brandIds.includes(brand.id))
}
