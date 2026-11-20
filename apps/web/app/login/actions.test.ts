// Sign-in's start action, run in Node with the browser's cookies held in a map and the API's answers
// stubbed: the sign-in link it asks for, and the cookies it keeps for WorkOS's answer.
import { redirect } from 'next/navigation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INVITATION_COOKIE, NEXT_COOKIE, STATE_COOKIE } from '@/lib/server/sign-in.ts'

import { requestToJoin, start } from './actions.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => ({ get: () => 'http://localhost:3000' })),
}))
// Next's redirect ends the action by throwing; this one throws where it would send the person.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`)
  }),
}))

const { cookies, headers } = await import('next/headers')

/** The browser's cookies as the action leaves them, by name, with the options each was set with. */
let jar: Map<string, { value: string; options: unknown }>
/** The queries the action asked the API's sign-in link with. */
let asked: string[]

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  jar = new Map()
  asked = []
  vi.mocked(redirect).mockClear()
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: unknown) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(new URL(url).search)
      return new Response(JSON.stringify({ url: 'https://auth.example.com/authorize' }), { status: 200 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Asks next/headers' headers once, with these values by name. */
function askedWith(values: Record<string, string>) {
  vi.mocked(headers).mockResolvedValueOnce({
    get: (name: string) => values[name] ?? null,
  } as unknown as Awaited<ReturnType<typeof headers>>)
}

describe('start', () => {
  it("passes the form's invitation token on to the sign-in link, and keeps it for a sign-in that fails", async () => {
    await expect(start(form({ invitation_token: 'invite_Token-1' }))).rejects.toThrow(
      'redirect https://auth.example.com/authorize',
    )

    expect(new URLSearchParams(asked[0]).get('invitationToken')).toBe('invite_Token-1')
    expect(jar.get(INVITATION_COOKIE)).toEqual({
      value: 'invite_Token-1',
      options: expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    })
    expect(jar.has(STATE_COOKIE)).toBe(true)
  })

  it('keeps no token when the form brings none, forgetting one an earlier sign-in kept', async () => {
    jar.set(INVITATION_COOKIE, { value: 'an-older-token', options: {} })

    await expect(start(form({}))).rejects.toThrow('redirect https://auth.example.com/authorize')

    expect(new URLSearchParams(asked[0]).has('invitationToken')).toBe(false)
    expect(jar.has(INVITATION_COOKIE)).toBe(false)
  })

  it('keeps no token that no invite could have', async () => {
    await expect(start(form({ invitation_token: 'not a token' }))).rejects.toThrow('redirect')

    expect(jar.has(INVITATION_COOKIE)).toBe(false)
  })

  it('keeps the Connect an agent page, with its request, for after sign-in', async () => {
    await expect(start(form({ next: '/agents/connect?request=x' }))).rejects.toThrow(
      'redirect https://auth.example.com/authorize',
    )

    expect(jar.get(NEXT_COOKIE)).toEqual({
      value: '/agents/connect?request=x',
      options: expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    })
  })

  it('keeps no other page, nor any address off this site, forgetting one an earlier sign-in kept', async () => {
    for (const next of [
      'https://elsewhere.example',
      '//elsewhere.example',
      '/w/1',
      '/agents/connected',
      '/\\elsewhere.example/agents/connect',
      '/agents/connect/../../w/1',
      'https://elsewhere.example/agents/connect',
    ]) {
      jar.set(NEXT_COOKIE, { value: '/agents/connect?request=older', options: {} })

      await expect(start(form({ next }))).rejects.toThrow('redirect https://auth.example.com/authorize')

      expect(jar.has(NEXT_COOKIE), next).toBe(false)
    }
  })
})

describe('start on the pilot host', () => {
  it("asks WorkOS to answer at the pilot host's own /callback", async () => {
    vi.stubEnv('PILOT_HOST', 'pilot.example.com')
    askedWith({ origin: 'https://pilot.example.com', host: 'pilot.example.com' })

    await expect(start(form({}))).rejects.toThrow('redirect https://auth.example.com/authorize')

    expect(new URLSearchParams(asked[0]).get('redirectUri')).toBe('https://pilot.example.com/callback')
  })

  it('names no callback of its own on any other host', async () => {
    vi.stubEnv('PILOT_HOST', 'pilot.example.com')
    askedWith({ origin: 'https://app.example.com', host: 'app.example.com' })

    await expect(start(form({}))).rejects.toThrow('redirect')

    expect(new URLSearchParams(asked[0]).has('redirectUri')).toBe(false)
  })
})

describe('requestToJoin', () => {
  /** What the API was sent: the request's headers and body. */
  let sent: { headers: Headers; body: unknown }[]
  /** The status the API answers with. */
  let status: number

  beforeEach(() => {
    sent = []
    status = 204
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) })
        return new Response(status === 204 ? null : JSON.stringify({ error: 'refused' }), { status })
      }),
    )
  })

  const request = {
    email: ' Bo@Example.com ',
    name: 'Bo',
    company: 'Harbour Coffee',
    note: '',
    turnstile_token: 'a-token',
  }

  it("sends the request with the person's address and the Turnstile token, and thanks them", async () => {
    askedWith({ 'cf-connecting-ip': '203.0.113.9' })

    expect(await requestToJoin(null, form(request))).toEqual({ sent: true })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers.get('cf-connecting-ip')).toBe('203.0.113.9')
    expect(sent[0]?.body).toEqual({
      email: 'bo@example.com',
      name: 'Bo',
      company: 'Harbour Coffee',
      note: '',
      turnstileToken: 'a-token',
    })
  })

  it('says why the API refused: too many from here, or a failed check', async () => {
    status = 429
    expect(await requestToJoin(null, form(request))).toEqual({
      error: 'Too many requests from here. Try again in an hour.',
    })
    status = 400
    expect(await requestToJoin(null, form(request))).toEqual({ error: 'We couldn’t check you’re a person. Try again.' })
  })

  it('refuses a form with no email or no name here, sending nothing', async () => {
    expect(await requestToJoin(null, form({ ...request, email: 'not an email' }))).toEqual({
      error: 'Enter an email address, such as ada@example.com.',
    })
    expect(await requestToJoin(null, form({ ...request, name: ' ' }))).toEqual({
      error: 'Enter your name and company.',
    })
    expect(sent).toEqual([])
  })
})
