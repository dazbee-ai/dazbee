// The Connect an agent page, rendered in Node with the API's answers stubbed and the form it draws stubbed: whom it
// sends to sign in, when it shows the link expired, and the workspaces and brands it offers, the one used last first.
import { redirect } from 'next/navigation'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectAgent } from '@/components/settings/connect-agent.tsx'

import ConnectAgentPage, { generateMetadata } from './page.tsx'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
// Next's redirect ends the render by throwing; this one throws where it would send the person.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`)
  }),
}))
vi.mock('@/components/settings/connect-agent.tsx', () => ({ ConnectAgent: vi.fn(() => null) }))

/** The person, in two workspaces, having used the second last. */
const ME = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  workspaces: [
    { id: 'ws-a', name: 'Agency', role: 'owner', limited: false },
    { id: 'ws-b', name: 'Bakery', role: 'reviewer', limited: true },
  ],
  open: 'ws-b',
}

/** The request as the API shows it. */
const REQUEST = { clientName: 'Claude Code', redirectHost: '127.0.0.1:33418', workspaces: ME.workspaces }

/** What the API answers each path with; any other path answers 404. */
let answers: Record<string, { status: number; body: unknown }>
/** The paths the page asked the API. */
let asked: string[]

beforeEach(() => {
  asked = []
  answers = {
    '/me': { status: 200, body: ME },
    '/agent/authorizations/req-1': { status: 200, body: REQUEST },
    '/workspaces/ws-a/brands': { status: 200, body: [{ id: 'b-1', name: 'Harbour Coffee' }] },
    '/workspaces/ws-b/brands': { status: 200, body: [{ id: 'b-2', name: 'Northline Cycles' }] },
  }
  vi.mocked(ConnectAgent).mockClear()
  vi.mocked(redirect).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      asked.push(path)
      const { status, body } = answers[path] ?? { status: 404, body: { error: 'Not found' } }
      return new Response(JSON.stringify(body), { status })
    }),
  )
})

/** The page's markup for the query. */
async function render(query: Record<string, string>) {
  return renderToStaticMarkup(await ConnectAgentPage({ searchParams: Promise.resolve(query) }))
}

describe('generateMetadata', () => {
  it('sends no referrer from the page, however its address is written', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Connect an agent', referrer: 'no-referrer' })
  })
})

describe('ConnectAgentPage', () => {
  it('sends a person who is signed out to sign in, coming back to the request', async () => {
    answers['/me'] = { status: 401, body: { error: 'Sign in' } }

    await expect(render({ request: 'req-1' })).rejects.toThrow(
      `redirect /login?next=${encodeURIComponent('/agents/connect?request=req-1')}`,
    )
  })

  it('offers the workspaces, the one used last first, each with the brands the person sees in it', async () => {
    await render({ request: 'req-1' })

    expect(vi.mocked(ConnectAgent).mock.calls[0]?.[0]).toEqual({
      request: 'req-1',
      clientName: 'Claude Code',
      redirectHost: '127.0.0.1:33418',
      workspaces: [
        { id: 'ws-b', name: 'Bakery', role: 'reviewer', brands: [{ id: 'b-2', name: 'Northline Cycles' }] },
        { id: 'ws-a', name: 'Agency', role: 'owner', brands: [{ id: 'b-1', name: 'Harbour Coffee' }] },
      ],
    })
  })

  it('says the link has expired for a request the API no longer has, or none in the address', async () => {
    answers['/agent/authorizations/req-1'] = { status: 404, body: { error: 'This sign-in has expired' } }

    for (const query of [{ request: 'req-1' }, {}]) {
      const page = await render(query)

      expect(page).toContain('This link has expired')
      expect(page).toContain('Connect the agent again from where you started.')
    }
    expect(ConnectAgent).not.toHaveBeenCalled()
  })

  it('says so to a person in no workspace', async () => {
    answers['/agent/authorizations/req-1'] = { status: 200, body: { ...REQUEST, workspaces: [] } }

    expect(await render({ request: 'req-1' })).toContain('No workspace to connect')
    expect(ConnectAgent).not.toHaveBeenCalled()
  })
})
