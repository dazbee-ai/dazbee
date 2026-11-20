// The WorkOS callback's route handler, run in Node with the request's cookies held in a map and the
// API's sign-in and sign-in link stubbed; a refusal keeps no session in that map or on its response, and
// each refused or restarted sign-in is logged without its code or token.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiFailure, completeSignIn, SESSION_COOKIE, signInLink } from '@/lib/server/api.ts'
import { AGAIN_STATE, INVITATION_COOKIE, NEXT_COOKIE, STATE_COOKIE } from '@/lib/server/sign-in.ts'

import { GET } from './route.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/server/api.ts', async (original) => {
  const api = await original<typeof import('@/lib/server/api.ts')>()
  return {
    SESSION_COOKIE: api.SESSION_COOKIE,
    ApiFailure: api.ApiFailure,
    completeSignIn: vi.fn(),
    signInLink: vi.fn(),
  }
})

const { cookies } = await import('next/headers')

/** WorkOS's sign-in page, as the API's sign-in link names it. */
const SIGN_IN_PAGE = 'https://auth.example.com/authorize'

/** The browser's cookies as the route sees them, by name. */
let jar: Map<string, string>
/** The lines the route logged. */
let logged: string[]

beforeEach(() => {
  jar = new Map()
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  logged = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line))
  vi.mocked(signInLink).mockReset()
  vi.mocked(signInLink).mockResolvedValue(SIGN_IN_PAGE)
  vi.mocked(completeSignIn).mockReset()
  vi.mocked(completeSignIn).mockResolvedValue({
    token: 'a-session-token',
    expiresAt: Date.UTC(2099, 0, 1),
    open: 'workspace-1',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /callback', () => {
  it('keeps the session and opens the workspace the sign-in answer names', async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect([response.status, response.headers.get('location')]).toEqual([303, '/w/workspace-1'])
    expect(jar.get(SESSION_COOKIE)).toBe('a-session-token')
    expect(jar.has(STATE_COOKIE)).toBe(false)
    expect(completeSignIn).toHaveBeenCalledWith('good')
  })

  it('comes back to the Connect an agent page the sign-in started from, with its request', async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')
    jar.set(NEXT_COOKIE, '/agents/connect?request=x')

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect([response.status, response.headers.get('location')]).toEqual([303, '/agents/connect?request=x'])
    expect(jar.get(SESSION_COOKIE)).toBe('a-session-token')
    expect(jar.has(NEXT_COOKIE)).toBe(false)
  })

  it('opens the workspace, as sign-in does, for any other page or an address off this site', async () => {
    for (const next of ['https://elsewhere.example', '//elsewhere.example', '/w/1', '/agents/connect/../../w/1']) {
      jar.set(STATE_COOKIE, 'the-one-we-started')
      jar.set(NEXT_COOKIE, next)

      const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

      expect([response.status, response.headers.get('location')], next).toEqual([303, '/w/workspace-1'])
      expect(jar.has(NEXT_COOKIE)).toBe(false)
    }
  })

  it('sends a sign-in that fails back to sign in with the page to come back to, so trying again still comes back', async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')
    jar.set(NEXT_COOKIE, '/agents/connect?request=x')
    vi.mocked(completeSignIn).mockRejectedValueOnce(new Error('The API refused the code'))

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect(response.headers.get('location')).toBe(
      `/login?error=1&next=${encodeURIComponent('/agents/connect?request=x')}`,
    )
    expect(jar.has(NEXT_COOKIE)).toBe(false)
  })

  it('keeps the page to come back to when it starts sign-in again', async () => {
    jar.set(NEXT_COOKIE, '/agents/connect?request=x')

    const response = await GET(new NextRequest('https://app.example.com/callback?code=from-the-invite'))

    expect(response.headers.get('location')).toBe(SIGN_IN_PAGE)
    expect(jar.get(NEXT_COOKIE)).toBe('/agents/connect?request=x')
  })

  it("forgets the invite's token the sign-in started from once it signs in", async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')
    jar.set(INVITATION_COOKIE, 'invite_Token-1')

    await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect(jar.has(INVITATION_COOKIE)).toBe(false)
  })

  it("sends a sign-in the API refused back to sign in with the invite's token, so trying again still accepts the invite", async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')
    jar.set(INVITATION_COOKIE, 'invite_Token-1')
    vi.mocked(completeSignIn).mockRejectedValueOnce(new Error('The API refused the code'))

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect([response.status, response.headers.get('location')]).toEqual([
      303,
      '/login?error=1&invitation_token=invite_Token-1',
    ])
    expect(jar.has(INVITATION_COOKIE)).toBe(false)
    expect(jar.has(SESSION_COOKIE)).toBe(false)
  })

  it('sends a sign-in early access refused back to sign in with its reason, keeping no session', async () => {
    for (const reason of ['early-access', 'open-invite'] as const) {
      jar.set(STATE_COOKIE, 'the-one-we-started')
      vi.mocked(completeSignIn).mockResolvedValueOnce({ refused: reason })

      const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

      expect([response.status, response.headers.get('location')]).toEqual([303, `/login?error=${reason}`])
      expect(jar.has(SESSION_COOKIE)).toBe(false)
      expect(JSON.parse(logged.at(-1) ?? '')).toEqual({ event: 'sign-in', outcome: 'refused', reason })
    }
  })

  it('starts sign-in again, without its code, for a sign-up an invite email opened at WorkOS, which comes back with no state', async () => {
    const response = await GET(new NextRequest('https://app.example.com/callback?code=from-the-invite'))

    expect([response.status, response.headers.get('location')]).toEqual([303, SIGN_IN_PAGE])
    expect(completeSignIn).not.toHaveBeenCalled()
    const [state] = vi.mocked(signInLink).mock.calls[0] ?? []
    expect(state?.startsWith(AGAIN_STATE)).toBe(true)
    expect(jar.get(STATE_COOKIE)).toBe(state)
    expect(jar.has(SESSION_COOKIE)).toBe(false)
    expect(logged.map((line) => JSON.parse(line))).toEqual([
      { event: 'sign-in', outcome: 'started-again', reason: 'no-state' },
    ])
  })

  it("starts sign-in again, keeping the invite's token, for a state this browser did not start with", async () => {
    for (const [cookie, reason] of [
      ['the-one-we-started', 'other-state'],
      [null, 'not-started-here'],
    ] as const) {
      jar.clear()
      vi.mocked(signInLink).mockClear()
      if (cookie) jar.set(STATE_COOKIE, cookie)
      jar.set(INVITATION_COOKIE, 'invite_Token-1')

      const response = await GET(new NextRequest('http://localhost:3000/callback?code=made-up&state=not-the-one'))

      expect([response.status, response.headers.get('location')]).toEqual([303, SIGN_IN_PAGE])
      expect(vi.mocked(signInLink).mock.calls[0]?.[1]).toBe('invite_Token-1')
      expect(jar.get(INVITATION_COOKIE)).toBe('invite_Token-1')
      expect(JSON.parse(logged.at(-1) ?? '')).toMatchObject({ outcome: 'started-again', reason })
    }
    expect(completeSignIn).not.toHaveBeenCalled()
  })

  it('refuses a sign-in started again that still comes back without its state, so it never loops', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/callback?code=made-up&state=${AGAIN_STATE}0123456789abcdef`),
    )

    expect([response.status, response.headers.get('location')]).toEqual([303, '/login?error=1'])
    expect([...jar.keys()]).toEqual([])
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined()
    expect(completeSignIn).not.toHaveBeenCalled()
    expect(signInLink).not.toHaveBeenCalled()
  })

  it('refuses a callback with no state after a sign-in this browser started again, so it never loops', async () => {
    jar.set(STATE_COOKIE, `${AGAIN_STATE}0123456789abcdef`)

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=made-up'))

    expect([response.status, response.headers.get('location')]).toEqual([303, '/login?error=1'])
    expect(signInLink).not.toHaveBeenCalled()
    expect(JSON.parse(logged[0] ?? '')).toMatchObject({ outcome: 'refused', reason: 'no-state-after-starting-again' })
  })

  it('sends a sign-in it cannot start again back to sign in, logging why', async () => {
    for (const [link, reason] of [
      [Promise.reject(new Error('the API is down')), 'start-again-failed'],
      [Promise.resolve(null), 'sign-in-not-set-up'],
    ] as const) {
      logged.length = 0
      vi.mocked(signInLink).mockReturnValueOnce(link)

      const response = await GET(new NextRequest('http://localhost:3000/callback?code=from-the-invite'))

      expect([response.status, response.headers.get('location')]).toEqual([303, '/login?error=1'])
      expect(JSON.parse(logged[0] ?? '')).toMatchObject({ outcome: 'unfinished', reason })
    }
  })

  it("sends a callback with no code back to sign in, logging WorkOS's error", async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')

    const response = await GET(
      new NextRequest('http://localhost:3000/callback?error=access_denied&state=the-one-we-started'),
    )

    expect([response.status, response.headers.get('location')]).toEqual([303, '/login?error=1'])
    expect(JSON.parse(logged[0] ?? '')).toEqual({
      event: 'sign-in',
      outcome: 'refused',
      reason: 'no-code',
      workosError: 'access_denied',
    })

    await GET(new NextRequest('http://localhost:3000/callback?error=ada@example.com'))

    expect(JSON.parse(logged[1] ?? '')).toMatchObject({ reason: 'no-code', workosError: null })
  })

  it('logs each refused sign-in with its reason, never its code or token', async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')
    jar.set(INVITATION_COOKIE, 'invite_Token-1')
    vi.mocked(completeSignIn).mockRejectedValueOnce(new ApiFailure(503, "Sign-in couldn't finish; try again"))

    await GET(new NextRequest('http://localhost:3000/callback?code=secret-code&state=the-one-we-started'))

    expect(JSON.parse(logged[0] ?? '')).toEqual({
      event: 'sign-in',
      outcome: 'unfinished',
      reason: 'api-failed',
      status: 503,
      error: "Sign-in couldn't finish; try again",
    })
    expect(logged.join(' ')).not.toMatch(/secret-code|invite_Token-1|the-one-we-started/)
  })

  it("opens the early-access admin page, the pilot host's /, after a sign-in there", async () => {
    vi.stubEnv('PILOT_HOST', 'pilot.example.com')
    jar.set(STATE_COOKIE, 'the-one-we-started')

    const response = await GET(
      new NextRequest('https://pilot.example.com/callback?code=good&state=the-one-we-started', {
        headers: { host: 'pilot.example.com' },
      }),
    )

    expect([response.status, response.headers.get('location')]).toEqual([303, '/'])
    expect(jar.get(SESSION_COOKIE)).toBe('a-session-token')
  })

  it("starts sign-in again on the pilot host with WorkOS answering at that host's own /callback", async () => {
    vi.stubEnv('PILOT_HOST', 'pilot.example.com')

    await GET(
      new NextRequest('https://0.0.0.0:3000/callback?code=from-the-invite', { headers: { host: 'pilot.example.com' } }),
    )

    expect(vi.mocked(signInLink).mock.calls[0]?.[2]).toBe('https://pilot.example.com/callback')
  })
})
