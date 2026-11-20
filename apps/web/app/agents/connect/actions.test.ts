// The Connect an agent page's Allow and Deny, run in Node with the API's answers stubbed and the language cookie
// held in a variable: what each asks the API, where it sends the person, and what they read when the API refuses.
import { redirect } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { allow, deny } from './actions.ts'

/** The language the person picked, if any; held where the hoisted cookie stub reads it. */
const picked = vi.hoisted(() => ({ locale: undefined as string | undefined }))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'locale' && picked.locale ? { value: picked.locale } : undefined),
  })),
}))
// Next's redirect ends the action by throwing; this one throws where it would send the person.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`)
  }),
}))

/** Where the agent's client hears back, with the code or the refusal. */
const BACK = 'http://127.0.0.1:33418/callback'

/** The requests the actions sent the API: method, path and body. */
let asked: { method: string; path: string; body: unknown }[]
/** What the API answers each request with. */
let answer: { status: number; body: unknown }

/** A form with each field, and a field given a list once for each of its values. */
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) for (const each of [value].flat()) data.append(name, each)
  return data
}

beforeEach(() => {
  asked = []
  picked.locale = undefined
  answer = { status: 201, body: { redirect: `${BACK}?code=a-code&state=s` } }
  vi.mocked(redirect).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({
        method: init?.method ?? 'GET',
        path: new URL(url).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response(JSON.stringify(answer.body), { status: answer.status })
    }),
  )
})

describe('allow', () => {
  it('sends the workspace, the brands ticked and View only, and goes where the API answers', async () => {
    await expect(
      allow(
        null,
        form({ request: 'req-1', workspace: 'ws-1', brands: 'chosen', brand: ['b-1', 'b-2'], access: 'view' }),
      ),
    ).rejects.toThrow(`redirect ${BACK}?code=a-code&state=s`)

    expect(asked).toEqual([
      {
        method: 'POST',
        path: '/workspaces/ws-1/agent-accesses',
        body: { request: 'req-1', brandIds: ['b-1', 'b-2'], writes: false },
      },
    ])
  })

  it('sends null for All brands, whatever was ticked before, and writes for Edit', async () => {
    await expect(
      allow(null, form({ request: 'req-1', workspace: 'ws-1', brands: 'all', brand: 'b-1', access: 'edit' })),
    ).rejects.toThrow('redirect')

    expect(asked[0]?.body).toEqual({ request: 'req-1', brandIds: null, writes: true })
  })

  it('refuses Chosen brands with none ticked here, sending nothing', async () => {
    expect(await allow(null, form({ request: 'req-1', workspace: 'ws-1', brands: 'chosen', access: 'edit' }))).toEqual({
      error: 'Tick at least one brand, or pick All brands.',
    })
    expect(asked).toEqual([])
  })

  it('shows why the API refused, in the person’s language, and stays on the page', async () => {
    const fields = { request: 'req-1', workspace: 'ws-1', brands: 'all', access: 'edit' }
    answer = { status: 403, body: { error: 'A Reviewer’s agent can only view' } }
    expect(await allow(null, form(fields))).toEqual({
      error: 'Your role in this workspace lets an agent only view. Pick View only.',
    })
    answer = { status: 404, body: { error: 'No such brand' } }
    expect(await allow(null, form(fields))).toEqual({
      error:
        'This sign-in has expired, or a brand you picked can’t be given now. Connect the agent again from where you started.',
    })
    picked.locale = 'ar'
    expect(await allow(null, form(fields))).toEqual({
      error:
        'انتهت صلاحية تسجيل الدخول هذا، أو لم يعد بالإمكان منح إحدى العلامات التي اخترتها. صِل الوكيل من جديد من حيث بدأت.',
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('shows any other refusal’s own message', async () => {
    answer = { status: 400, body: { error: 'brandIds: Too big' } }
    expect(await allow(null, form({ request: 'req-1', workspace: 'ws-1', brands: 'all', access: 'edit' }))).toEqual({
      error: 'brandIds: Too big',
    })
  })
})

describe('deny', () => {
  it('tells the API and goes back to the agent with its refusal', async () => {
    answer = { status: 200, body: { redirect: `${BACK}?error=access_denied&state=s` } }

    await expect(deny(null, form({ request: 'req-1' }))).rejects.toThrow(`redirect ${BACK}?error=access_denied&state=s`)

    expect(asked).toEqual([{ method: 'POST', path: '/agent/authorizations/req-1/deny', body: {} }])
  })

  it('says the sign-in expired when the API no longer has it', async () => {
    answer = {
      status: 404,
      body: { error: 'This sign-in has expired or was answered already; connect the agent again' },
    }

    expect(await deny(null, form({ request: 'req-1' }))).toEqual({
      error: 'This link has expired. Connect the agent again from where you started.',
    })
  })

  it('sends a person whose session ended to sign in, coming back to this request', async () => {
    answer = { status: 401, body: { error: 'Sign in' } }

    await expect(deny(null, form({ request: 'req-1' }))).rejects.toThrow(
      `redirect /login?next=${encodeURIComponent('/agents/connect?request=req-1')}`,
    )
  })
})
