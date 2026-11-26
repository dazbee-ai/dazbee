// The admin page's AI section, rendered in Node with the request's headers and the API's answers stubbed: the
// host and the person it is not found for, each section an admin sees, and the days and workspace the address
// names.
import { notFound, redirect } from 'next/navigation'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiAllowanceView } from '@dazbee/schema'

import { type AiPage, findAiPage, findAiWorkspaces, findAllowance } from '@/lib/server/admin-ai.ts'
import { findMe } from '@/lib/server/api.ts'

import PilotAiPage from './page.tsx'

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
vi.mock('@/lib/server/admin-ai.ts', () => ({ findAiPage: vi.fn(), findAiWorkspaces: vi.fn(), findAllowance: vi.fn() }))
vi.mock('./actions.ts', () => ({}))

const { headers } = await import('next/headers')

const AT = '2026-11-20T10:00:00.000Z'

/**
 * The AI section as the API gives it: a spending stop in force, a red day, an unknown call, a seller out of money,
 * and the round plan with Precise picked over to its light preset.
 */
const PAGE: AiPage = {
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
  rates: [
    { currency: 'INR', rate: 1, updatedAt: AT },
    { currency: 'USD', rate: 96.17, updatedAt: AT },
  ],
  prices: [
    {
      seller: 'openai',
      model: 'gpt-6-luna',
      unit: 'input-token',
      currency: 'USD',
      pricePerMillion: 0.1,
      fee: 0.18,
      updatedAt: AT,
    },
  ],
  modelSellers: [
    {
      model: 'seedream-5.5',
      sellers: [
        { seller: 'openrouter', sellerModel: 'bytedance-seed/seedream-5-5' },
        { seller: 'pixazo', sellerModel: null },
      ],
    },
  ],
  functions: [
    {
      function: 'round-plan',
      kind: 'text',
      presets: [
        {
          name: 'light-luna',
          model: 'gpt-6-luna',
          settings: { effort: 'low', tier: 'fast' },
          ownPrompt: true,
          measured: { done: 0, cost: 0.54, seconds: 10, cutOffs: 0, failures: 0, firstGuess: true },
        },
        {
          name: 'full-terra',
          model: 'gpt-6.1-terra',
          settings: { effort: 'low', tier: 'standard' },
          ownPrompt: true,
          measured: { done: 12, cost: 1.9, seconds: 31, cutOffs: 1, failures: 2, firstGuess: false },
        },
      ],
      modes: [
        { mode: 'fast', preset: 'light-luna', source: 'code', lacking: null, pickedAt: null },
        { mode: 'precise', preset: 'light-luna', source: 'pick', lacking: null, pickedAt: AT },
      ],
    },
  ],
  picks: { 'round-plan': [{ id: 1, mode: 'precise', preset: 'light-luna', setBy: 'ada@example.com', setAt: AT }] },
  costs: [
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
  ],
  unknownCalls: [{ seller: 'pixazo', day: '2026-11-19', calls: 2 }],
  outOfMoney: [{ seller: 'zenmux', at: AT }],
  lastChecked: [
    { seller: 'meta', day: '2026-11-19', uploadedAt: AT },
    { seller: 'pixazo', day: null, uploadedAt: null },
  ],
}

const ALLOWANCE: AiAllowanceView = {
  workspace: { id: 'ws-1', name: 'Harbour Coffee', emails: ['bo@example.com'] },
  left: 400,
  grants: [
    {
      id: 'grant-1',
      source: 'gift',
      amount: 500,
      usageRate: 1,
      left: 400,
      expiresAt: '2026-12-31T18:30:00.000Z',
      live: true,
      note: 'Early tester',
      layerSize: 1024,
      givenBy: 'ada@example.com',
      createdAt: AT,
    },
  ],
  ledger: [{ id: 7, grantId: 'grant-1', jobId: 'job-1', callId: null, kind: 'hold', amount: -100, createdAt: AT }],
}

/** The Host header the page is asked with. */
let host: string

/** The rendered input named `name` in `page`. */
const inputNamed = (page: string, name: string) => new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(page)?.[0]

/** The page as the address `query` asks for it. */
const pageAt = (query: Record<string, string> = {}) => PilotAiPage({ searchParams: Promise.resolve(query) })

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
  vi.mocked(findAiPage).mockReset().mockResolvedValue(PAGE)
  vi.mocked(findAiWorkspaces).mockReset().mockResolvedValue([ALLOWANCE.workspace])
  vi.mocked(findAllowance).mockReset().mockResolvedValue(ALLOWANCE)
  vi.mocked(notFound).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('PilotAiPage', () => {
  it('shows an admin each section on the pilot host', async () => {
    const page = renderToStaticMarkup(await pageAt())
    for (const section of [
      'ai-settings',
      'ai-range',
      'ai-costs',
      'ai-daily-check',
      'ai-upload',
      'ai-grants',
      'ai-functions',
      'ai-price-list',
      'ai-seller-order',
    ]) {
      expect(page).toContain(`data-testid="${section}"`)
    }
    expect(page).toContain('The spending stop is in force')
    expect(page).toContain('data-check="meta/2026-11-19" data-state="red"')
    expect(page).toContain('data-testid="ai-out-of-money"')
    expect(page).toContain('data-split-day="2026-11-20"')
    expect(page).toContain('data-price="openai-gpt-6-luna-input-token"')
    expect(page).toContain('data-feature="layering"')
    expect(page).toContain('Make editable')
    expect(page).toContain('Layer split')
    expect(page).toContain('data-model="seedream-5.5"')
    // The costs name each row's preset, and the AI feature in a column of its own: on the feature's total, and on
    // each row of the days.
    expect(page).toMatch(/<tr data-cost="layering\/layer-split\/ming\/[^"]*">.*?<td[^>]*>ming<\/td>/s)
    expect(page.match(/<th[^>]*>AI feature<\/th><th[^>]*>AI function<\/th>/g)).toHaveLength(2)
    expect(page).toMatch(/<tr data-feature="layering"[^>]*><td[^>]*>Make editable<\/td><td[^>]*colSpan="4"/)
    expect(page).toMatch(
      /<tr data-day-cost="2026-11-20\/layering\/layer-split\/ming"><td[^>]*>2026-11-20<\/td><td[^>]*>Make editable<\/td><td[^>]*>Layer split<\/td>/,
    )
    // The round plan's presets, the mode a pick moved, the button that moves it back, and the pick.
    expect(page).toContain('data-function="round-plan"')
    expect(page).toContain('data-uses="precise" data-source="pick"')
    expect(page).toContain('aria-label="Use full-terra for Round plan, Precise"')
    expect(page).toContain('data-pick="1"')
    expect(findAiWorkspaces).not.toHaveBeenCalled()
    expect(findAllowance).not.toHaveBeenCalled()
  })

  it('shows the workspaces a search found, and the open one’s grants, ledger and gift', async () => {
    const page = renderToStaticMarkup(await pageAt({ q: ' harbour ', workspace: 'ws-1' }))
    expect(findAiWorkspaces).toHaveBeenCalledWith('harbour')
    expect(findAllowance).toHaveBeenCalledWith('ws-1')
    expect(page).toContain('data-workspace="ws-1"')
    expect(page).toContain('data-allowance="ws-1"')
    expect(page).toContain('data-grant="grant-1"')
    expect(page).toContain('data-testid="ai-gift"')
    // The grant's layering size shows, and a new gift's starts at 512 px.
    expect(page).toMatch(/data-grant="grant-1"[^]*?>1024 px<\/td>/)
    expect(page).toMatch(/<option value="512" selected="">512 px<\/option>/)
    // The gift ends at midnight IST after its last day, which the table shows.
    expect(page).toMatch(/<time dateTime="2026-12-31T18:30:00.000Z">Dec 31, 2026<\/time>/)
  })

  it('asks for more than nothing in the fields the API refuses at zero', async () => {
    const page = renderToStaticMarkup(await pageAt())
    expect(inputNamed(page, 'usageRate')).toContain('min="0.000001"')
    expect(inputNamed(page, 'rate-USD')).toContain('min="0.000001"')
    expect(inputNamed(page, 'new-currency-rate')).toContain('min="0.000001"')
  })

  it('asks for the days the address names, and the last 14 days when they can’t be read', async () => {
    await pageAt({ from: '2026-11-01', to: '2026-11-07' })
    expect(findAiPage).toHaveBeenLastCalledWith('2026-11-01', '2026-11-07')
    vi.useFakeTimers({ now: new Date('2026-11-25T12:00:00Z'), toFake: ['Date'] })
    for (const days of [
      { from: '2026-11-07', to: '2026-11-01' },
      { from: 'yesterday' },
      { from: '2026-01-01', to: '2026-11-07' },
    ]) {
      const page = renderToStaticMarkup(await pageAt(days))
      expect(findAiPage).toHaveBeenLastCalledWith('2026-11-12', '2026-11-25')
      expect(page).toContain('Those days can’t be shown')
    }
    expect(renderToStaticMarkup(await pageAt())).not.toContain('Those days can’t be shown')
  })

  it('is not found on any other host, before asking the API anything', async () => {
    host = 'app.example.com'
    await expect(pageAt()).rejects.toThrow('not found')
    vi.unstubAllEnvs()
    host = 'pilot.example.com'
    await expect(pageAt()).rejects.toThrow('not found')
    expect(findAiPage).not.toHaveBeenCalled()
  })

  it('sends a person who is not signed in to sign in', async () => {
    vi.mocked(findMe).mockResolvedValue(null)
    await expect(pageAt()).rejects.toThrow('redirect /login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('is not found for a person the API does not take for an admin', async () => {
    vi.mocked(findAiPage).mockResolvedValue(null)
    await expect(pageAt({ q: 'harbour', workspace: 'ws-1' })).rejects.toThrow('not found')
    expect(findAllowance).not.toHaveBeenCalled()
  })
})
