// Early access's admin page, rendered in Node with the request's headers and the API's answers stubbed: the
// host and the person it is not found for.
import { notFound, redirect } from 'next/navigation'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findAdminPage } from '@/lib/server/admin.ts'
import { findMe } from '@/lib/server/api.ts'

import PilotAccessPage from './page.tsx'

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
vi.mock('./actions.ts', () => ({}))

const { headers } = await import('next/headers')

/** The Host header the page is asked with. */
let host: string

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
  vi.mocked(findAdminPage).mockResolvedValue({
    invites: { pending: [], joined: [], removed: [] },
    requests: [
      {
        id: 'request-1',
        email: 'bo@example.com',
        name: 'Bo',
        company: 'Harbour Coffee',
        note: 'Spring ads',
        requestedAt: '2026-11-19T10:00:00.000Z',
      },
    ],
  })
  vi.mocked(notFound).mockClear()
  vi.mocked(findAdminPage).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PilotAccessPage', () => {
  it('shows an admin the invite form and the waiting list on the pilot host', async () => {
    const page = renderToStaticMarkup(await PilotAccessPage())
    expect(page).toContain('data-testid="pilot-invite-form"')
    expect(page).toContain('data-request="bo@example.com"')
    expect(page).toContain('data-page="access" aria-current="page"')
  })

  it('is not found on any other host, before asking the API anything', async () => {
    host = 'app.example.com'
    await expect(PilotAccessPage()).rejects.toThrow('not found')
    vi.unstubAllEnvs()
    host = 'pilot.example.com'
    await expect(PilotAccessPage()).rejects.toThrow('not found')
    expect(findAdminPage).not.toHaveBeenCalled()
  })

  it('sends a person who is not signed in to sign in', async () => {
    vi.mocked(findMe).mockResolvedValue(null)
    await expect(PilotAccessPage()).rejects.toThrow('redirect /login')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('is not found for a person the API does not take for an admin', async () => {
    vi.mocked(findAdminPage).mockResolvedValue(null)
    await expect(PilotAccessPage()).rejects.toThrow('not found')
  })
})
