// The admin pages' overview, rendered in Node with the request's headers and the API's answers stubbed: the
// host and the person it is not found for, its tiles' figures, its charts and early access's counts.
import { notFound, redirect } from 'next/navigation'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findAdminPage } from '@/lib/server/admin.ts'
import { type AiOverviewData, findAiOverview } from '@/lib/server/admin-ai.ts'
import { findMe } from '@/lib/server/api.ts'

import PilotOverviewPage from './page.tsx'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn(async () => ({ get: () => undefined })) }))
// Next's notFound and redirect end the page by throwing; these throw what they would answer.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`)
  }),
}))
vi.mock('@/lib/server/api.ts', () => ({ findMe: vi.fn() }))
vi.mock('@/lib/server/admin.ts', () => ({ findAdminPage: vi.fn() }))
vi.mock('@/lib/server/admin-ai.ts', () => ({ findAiOverview: vi.fn() }))

const { headers } = await import('next/headers')

const AT = '2026-11-20T10:00:00.000Z'

/** AI as the API gives it: the spending stop in force, two sellers' costs, a layer split, a red day, unknown calls and a seller out of money. */
const AI: AiOverviewData = {
  settings: {
    usageRate: 1,
    spendingStop: 2000,
    jobLimit: 3,
    layerSplit512: 1.83,
    layerSplit1024: 1.83,
    spentToday: 2100,
    stopped: true,
    updatedAt: AT,
  },
  costs: [
    {
      day: '2026-11-20',
      feature: 'refine',
      function: 'refine-edit',
      preset: 'seedream',
      model: 'seedream-5.5',
      seller: 'pixazo',
      calls: 3,
      done: 2,
      realCost: 2.5,
      charged: 2,
    },
    {
      day: '2026-11-19',
      feature: 'layering',
      function: 'reading',
      preset: 'luna',
      model: 'gpt-6-luna',
      seller: 'openai',
      calls: 1,
      done: 1,
      realCost: 0.4,
      charged: 0.4,
    },
    {
      day: '2026-11-20',
      feature: 'layering',
      function: 'layer-split',
      preset: 'ming',
      model: 'ming-image-0.1-design-layer',
      seller: 'modal',
      calls: 2,
      done: 2,
      realCost: 3.1,
      charged: 3.66,
    },
  ],
  today: [
    {
      day: '2026-11-21',
      feature: 'refine',
      function: 'refine-edit',
      preset: 'seedream',
      model: 'seedream-5.5',
      seller: 'pixazo',
      calls: 5,
      done: 4,
      realCost: 4,
      charged: 3,
    },
    {
      day: '2026-11-21',
      feature: 'layering',
      function: 'reading',
      preset: 'luna',
      model: 'gpt-6-luna',
      seller: 'openai',
      calls: 2,
      done: 2,
      realCost: 1,
      charged: 1,
    },
  ],
  checks: [
    {
      seller: 'meta',
      day: '2026-11-19',
      currency: 'INR',
      ourCost: 0.93,
      sellerCost: 5,
      outsideCalls: null,
      state: 'red',
      source: 'upload',
      checkedAt: AT,
    },
    {
      seller: 'openai',
      day: '2026-11-19',
      currency: 'USD',
      ourCost: 0.004,
      sellerCost: 0.004,
      outsideCalls: null,
      state: 'ok',
      source: 'report',
      checkedAt: AT,
    },
  ],
  unknownCalls: [
    { seller: 'pixazo', day: '2026-11-19', calls: 2 },
    { seller: 'meta', day: '2026-11-20', calls: 1 },
  ],
  outOfMoney: [{ seller: 'zenmux', at: AT }],
}

/** The Host header the page is asked with. */
let host: string

/** The page as the address `query` asks for it. */
const pageAt = (query: Record<string, string> = { from: '2026-11-19', to: '2026-11-21' }) =>
  PilotOverviewPage({ searchParams: Promise.resolve(query) })

/** The text of the tile `id` in `page`, its tags taken out. */
const tile = (page: string, id: string) =>
  new RegExp(`data-testid="tile-${id}"[^>]*>(.*?)</(div|a)>`)
    .exec(page)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

beforeEach(() => {
  host = 'pilot.example.com'
  vi.stubEnv('PILOT_HOST', 'pilot.example.com')
  vi.mocked(headers).mockImplementation(
    async () => ({ get: (name: string) => (name === 'host' ? host : null) }) as Awaited<ReturnType<typeof headers>>,
  )
  vi.mocked(findMe).mockResolvedValue({
    id: 'user-1',
    name: 'Ada',
    email: 'ada@example.com',
    workspaces: [],
    open: null,
  } as unknown as Awaited<ReturnType<typeof findMe>>)
  vi.mocked(findAdminPage)
    .mockReset()
    .mockResolvedValue({
      invites: {
        pending: [{ id: 'invite-1', email: 'cy@example.com', expiresAt: AT, link: 'https://example.com/i' }],
        joined: [],
        removed: [],
      },
      requests: [
        {
          id: 'request-1',
          email: 'bo@example.com',
          name: 'Bo',
          company: 'Harbour Coffee',
          note: '',
          requestedAt: AT,
        },
      ],
    })
  vi.mocked(findAiOverview).mockReset().mockResolvedValue(AI)
  vi.mocked(notFound).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('PilotOverviewPage', () => {
  it('shows today’s real cost against the spending stop, today’s calls and the days’ unknown calls, red days and sellers out of money', async () => {
    const page = renderToStaticMarkup(await pageAt())
    expect(tile(page, 'spent')).toBe('Real AI cost today ₹2,100 The spending stop is in force until midnight IST')
    expect(page).toMatch(/data-testid="tile-spent" data-warn="true"/)
    expect(tile(page, 'calls')).toBe('AI calls today 7 6 done, UTC day')
    expect(tile(page, 'unknown')).toBe('Unknown calls 3 On these days; the seller may have billed them')
    expect(tile(page, 'red')).toBe('Red days 1 Of 2 seller days checked')
    expect(tile(page, 'out-of-money')).toBe('Sellers out of money 1 ZenMux')
  })

  it('draws the costs by day, the layer split and each seller’s daily check with its red day', async () => {
    const page = renderToStaticMarkup(await pageAt())
    for (const chart of ['ai-cost-chart', 'ai-split-chart', 'ai-check-chart']) {
      expect(page).toContain(`data-testid="${chart}"`)
    }
    expect(page).toContain('data-column="2026-11-21"')
    expect(page).toContain('data-series="openai"')
    expect(page).toContain('data-series="pixazo"')
    expect(page).toContain('data-line="gpu"')
    expect(page).toMatch(/data-panel="openai"[^>]*>.*data-panel="meta" data-red="2026-11-19"/s)
    expect(page).toContain('data-flag="2026-11-19"')
    expect(page).toContain('data-point="2026-11-20"')
  })

  it('asks for the days the address names and today’s costs, and counts early access’s people', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-21T12:00:00Z'), toFake: ['Date'] })
    const page = renderToStaticMarkup(await pageAt())
    expect(findAiOverview).toHaveBeenLastCalledWith('2026-11-19', '2026-11-21', '2026-11-21')
    expect(tile(page, 'waiting')).toBe('Waiting list 1')
    expect(tile(page, 'pending')).toBe('Pending invites 1')
    expect(tile(page, 'joined')).toBe('Joined 0')
    expect(page).toContain('data-page="overview" aria-current="page"')
  })

  it('says when nothing happened on the days', async () => {
    vi.mocked(findAiOverview).mockResolvedValue({ ...AI, costs: [], checks: [], unknownCalls: [], outOfMoney: [] })
    const page = renderToStaticMarkup(await pageAt())
    expect(page).toContain('No AI calls on these days.')
    expect(page).toContain('No layer splits on these days.')
    expect(page).toContain('No days checked on these days.')
    expect(tile(page, 'out-of-money')).toBe('Sellers out of money 0 None in the last day')
  })

  it('is not found on any other host, before asking the API anything', async () => {
    host = 'app.example.com'
    await expect(pageAt()).rejects.toThrow('not found')
    vi.unstubAllEnvs()
    host = 'pilot.example.com'
    await expect(pageAt()).rejects.toThrow('not found')
    expect(findAiOverview).not.toHaveBeenCalled()
    expect(findAdminPage).not.toHaveBeenCalled()
  })

  it('sends a person who is not signed in to sign in', async () => {
    vi.mocked(findMe).mockResolvedValue(null)
    await expect(pageAt()).rejects.toThrow('redirect /login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('is not found for a person the API does not take for an admin', async () => {
    vi.mocked(findAiOverview).mockResolvedValue(null)
    await expect(pageAt()).rejects.toThrow('not found')
    vi.mocked(findAiOverview).mockResolvedValue(AI)
    vi.mocked(findAdminPage).mockResolvedValue(null)
    await expect(pageAt()).rejects.toThrow('not found')
  })
})
