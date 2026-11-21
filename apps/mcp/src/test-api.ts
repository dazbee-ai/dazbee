// A stand-in for the API's agents' routes, for tests: one workspace with two brands, their designs and
// assets, the brand kit and font catalog every brand has, sync tokens, the storage the signed links point at, and agent
// accesses whose tokens the tests hand out and refuse.
import { Hono } from 'hono'

import { loadFontFiles } from '@dazbee/fonts/node'
import {
  type AgentMe,
  type AssetSummary,
  type BrandKit,
  type BrandSummary,
  CreateDesign,
  type DesignSummary,
  type FontFamily,
  SyncTokenRequest,
} from '@dazbee/schema'

/** An agent access as the tests give it. */
export interface TestAccessOptions {
  /** The brands it may open; left out, all the workspace's. */
  brandIds?: string[]
  /** Whether it edits; left out, it does. */
  writes?: boolean
  /** How long each of its access tokens lasts by the fake API's clock; left out, until refused. */
  tokenMs?: number
}

/** One access of the fake API, which hands out its tokens. */
export interface TestAccess {
  id: string
  /** A new live access token of the access, as a refresh gives. */
  token(): string
  /** Limits the access to these brands from now on. */
  limitTo(brandIds: string[]): void
}

/** The fake API: its `fetch`, and how the tests shape what it answers. */
export interface TestApi {
  fetch(request: Request): Promise<Response>
  addAccess(options?: TestAccessOptions): TestAccess
  /** Refuses `token` everywhere from now on, as the API refuses an expired token. */
  refuse(token: string): void
  /** Takes `token` on `GET /agent/me` but refuses it on every other route, as when it expires between the two. */
  refuseAfterMe(token: string): void
  /** The brand's designs as the fake API holds them. */
  designsOf(brandId: string): DesignSummary[]
  /** Holds every answer past `GET /agent/me` until the function it gives is called. */
  hold(): () => void
  /** Answers every request 503 from now on, as an API that is down. */
  goDown(): void
  /** How many requests the fake API has been sent. */
  requests(): number
  /** What a sync token the fake API signed is for, or undefined for one it never signed. */
  syncTokenOf(token: string): TestSyncToken | undefined
}

/** What a sync token of the fake API is for. */
export interface TestSyncToken {
  designId: string
  writes: boolean
  /** The agent's name, as the design shows it. */
  agent: string
}

/** What a fake API is given: the clock its sync tokens expire by, `Date.now` unless given. */
export interface TestApiOptions {
  now?: () => number
}

/** How long a sync token of the fake API lasts. */
export const TEST_SYNC_TOKEN_MS = 10 * 60 * 1000

/** The brand kit every brand of the fake API has. */
export const TEST_BRAND_KIT: BrandKit = {
  colors: [{ token: 'primary', name: 'Primary', value: '#FF5A36FF' }],
  fonts: [{ token: 'heading', name: 'Heading', family: 'Brand Serif' }],
  logoAssetId: null,
  voice: '',
  textStyles: [
    {
      token: 'headline',
      name: 'Headline',
      font: { token: 'heading' },
      fontWeight: 700,
      fontStyle: 'normal',
      lineHeight: 1.1,
      letterSpacing: { unit: 'percent', value: -1 },
    },
  ],
}

/** The one family in every brand's font catalog, one face whose file is a shipped font's. */
export const TEST_FONTS: FontFamily[] = [
  {
    family: 'Brand Serif',
    source: 'upload',
    category: null,
    faces: [
      { id: 'face-brand-serif', family: 'Brand Serif', weight: 400, style: 'normal', source: 'upload', byteSize: 1 },
    ],
  },
]

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

/** The stored file of the bottle asset: a 4 × 4 PNG of orange and blue squares. */
export const TEST_BOTTLE_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAG0lEQVR4nGP4f4Lhv9yE//9hNAMyB0QzEFQBAMCHK5GQiq1KAAAAAElFTkSuQmCC',
    'base64',
  ),
)

/** Where the fake API's signed storage links point. */
const STORAGE = 'http://storage.test'

/** A fake API holding the test workspace's brands, designs and assets. */
export function testApi({ now = Date.now }: TestApiOptions = {}): TestApi {
  // The live tokens, each to its access; those in `afterMe` are refused past `GET /agent/me`.
  const tokens = new Map<string, AgentMe>()
  const afterMe = new Set<string>()
  // When each token that expires does, by the clock.
  const expiries = new Map<string, number>()
  // The designs, which `POST …/designs` adds to.
  const designs = TEST_DESIGNS.map((design) => ({ ...design }))
  let made = 0
  // What answers wait for while the tests hold them; whether the API is down; the requests it was sent.
  let held: Promise<void> | null = null
  let down = false
  let requests = 0
  // The sync tokens signed, each to what it is for.
  const syncTokens = new Map<string, TestSyncToken>()

  const app = new Hono<{ Variables: { agent: AgentMe } }>()

  app.use('*', async (c, next) => {
    requests++
    if (down) return c.json({ error: 'Unavailable' }, 503)
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? ''
    const agent = (expiries.get(token) ?? Infinity) > now() ? tokens.get(token) : undefined
    if (!agent || (afterMe.has(token) && c.req.path !== '/agent/me')) return c.json({ error: 'Sign in first' }, 401)
    c.set('agent', agent)
    await next()
  })

  app.get('/agent/me', (c) => c.json(c.var.agent))

  app.use('/workspaces/*', async (_c, next) => {
    await held
    await next()
  })

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

  app.get('/workspaces/:workspaceId/brands/:brandId/assets/:assetId', (c) => {
    const asset = TEST_ASSETS.find(
      ({ id, brandId }) => id === c.req.param('assetId') && brandId === c.req.param('brandId'),
    )
    if (!asset) return c.json({ error: 'No such asset' }, 404)
    return c.json({ asset, url: `${STORAGE}/assets/${asset.id}`, expiresAt: new Date(now() + 60_000).toISOString() })
  })

  app.post('/workspaces/:workspaceId/brands/:brandId/designs/:designId/sync-token', async (c) => {
    const designId = c.req.param('designId')
    if (!designs.some((design) => design.id === designId && design.brandId === c.req.param('brandId')))
      return c.json({ error: 'No such design' }, 404)
    const input = SyncTokenRequest.parse(await c.req.json())
    const token = `sync-${syncTokens.size + 1}`
    syncTokens.set(token, { designId, writes: c.var.agent.writes, agent: input.agent ?? '' })
    const member = { userId: 'user-test', workspaceId: TEST_WORKSPACE }
    return c.json({ token, expiresAt: new Date(now() + TEST_SYNC_TOKEN_MS).toISOString(), member })
  })

  app.get('/workspaces/:workspaceId/brands/:brandId/kit', (c) => c.json(TEST_BRAND_KIT))

  app.get('/workspaces/:workspaceId/brands/:brandId/fonts', (c) => c.json(TEST_FONTS))

  app.get('/workspaces/:workspaceId/brands/:brandId/fonts/faces/:faceId', (c) => {
    const face = TEST_FONTS.flatMap((family) => family.faces).find(({ id }) => id === c.req.param('faceId'))
    if (!face) return c.json({ error: 'No such font' }, 404)
    const expiresAt = new Date(now() + 60_000).toISOString()
    return c.json({ face, url: `${STORAGE}/fonts/${face.id}`, previewUrl: `${STORAGE}/previews/${face.id}`, expiresAt })
  })

  return {
    fetch: async (request) => (new URL(request.url).origin === STORAGE ? stored(request) : app.fetch(request)),
    syncTokenOf: (token) => syncTokens.get(token),
    addAccess,
    refuse: (token) => void tokens.delete(token),
    refuseAfterMe: (token) => void afterMe.add(token),
    designsOf: (brandId) => designs.filter((design) => design.brandId === brandId),
    hold,
    goDown: () => void (down = true),
    requests: () => requests,
  }

  function hold(): () => void {
    let release = () => {}
    held = new Promise((resolve) => (release = resolve))
    return () => {
      held = null
      release()
    }
  }

  function addAccess({ brandIds, writes = true, tokenMs }: TestAccessOptions = {}): TestAccess {
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
        if (tokenMs !== undefined) expiries.set(token, now() + tokenMs)
        return token
      },
      limitTo: (limited) => void (agent.brandIds = limited),
    }
  }
}

/** The brands an access sees. */
function visible(agent: AgentMe): BrandSummary[] {
  return TEST_BRANDS.filter((brand) => agent.brandIds === null || agent.brandIds.includes(brand.id))
}

/**
 * The fake storage behind the signed links: a font face's file is a shipped font's, and the bottle's is
 * `TEST_BOTTLE_PNG`. A request carrying a token is refused, as the agent's token must never reach storage.
 */
async function stored(request: Request): Promise<Response> {
  if (request.headers.has('authorization')) return new Response('A signed link takes no token', { status: 400 })
  const path = new URL(request.url).pathname
  if (path === '/assets/asset-bottle') return new Response(new Uint8Array(TEST_BOTTLE_PNG))
  const [shipped] = loadFontFiles()
  if (!path.startsWith('/fonts/') || !shipped) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(shipped.bytes))
}
