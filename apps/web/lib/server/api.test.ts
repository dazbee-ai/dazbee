// The server's API client, run in Node with the session cookie and the API's answers stubbed: the
// paths it asks the API for.
import { redirect } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  ApiFailure,
  call,
  completeSignIn,
  findMe,
  getAccess,
  getRole,
  getWorkspace,
  listDesigns,
  listFonts,
  signInLink,
} from './api.ts'

/** The person `/me` answers with: the Owner of one workspace and an Editor limited to some brands in another. */
const ME = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  workspaces: [
    { id: 'workspace-1', name: 'Harbour', role: 'owner', limited: false },
    { id: 'workspace-2', name: 'Agency', role: 'editor', limited: true },
  ],
  open: 'workspace-1',
}

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

/** The paths the client asked the API for, in order. */
let asked: string[]
/** The same paths with their queries. */
let askedWithQuery: string[]

beforeEach(() => {
  asked = []
  askedWithQuery = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { pathname: path, search } = new URL(url)
      asked.push(path)
      askedWithQuery.push(path + search)
      const body =
        path === '/me'
          ? ME
          : path === '/auth/sign-in-url'
            ? { url: 'https://auth.example.com/authorize' }
            : path.endsWith('/designs') || path.endsWith('/fonts')
              ? []
              : { id: 'workspace-1', name: 'Harbour' }
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
})

describe('signInLink', () => {
  it('asks for the sign-in link with the state alone when no invite brought the person', async () => {
    expect(await signInLink('a-state-of-sixteen-or-more')).toBe('https://auth.example.com/authorize')

    expect(askedWithQuery).toEqual(['/auth/sign-in-url?state=a-state-of-sixteen-or-more'])
  })

  it("passes on the token of the invite the person came from, so WorkOS's sign-in accepts it", async () => {
    await signInLink('a-state-of-sixteen-or-more', 'invite_Token-1')

    expect(askedWithQuery).toEqual([
      '/auth/sign-in-url?state=a-state-of-sixteen-or-more&invitationToken=invite_Token-1',
    ])
  })

  it('leaves out a token that no invite could have, so a mangled link still signs in', async () => {
    await signInLink('a-state-of-sixteen-or-more', 'not a token&x=1')

    expect(askedWithQuery).toEqual(['/auth/sign-in-url?state=a-state-of-sixteen-or-more'])
  })
})

describe('completeSignIn', () => {
  /** The API's next answer to the sign-in callback. */
  const answer = (status: number, body: unknown) =>
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))

  it('gives the session the API made', async () => {
    answer(200, { token: 'a-session-token', expiresAt: 1, open: 'workspace-1' })

    expect(await completeSignIn('a-code')).toEqual({ token: 'a-session-token', expiresAt: 1, open: 'workspace-1' })
  })

  it("keeps early access's reason for refusing the person", async () => {
    for (const reason of ['early-access', 'open-invite']) {
      answer(403, { error: 'Dazbee is in early access', reason })

      expect(await completeSignIn('a-code')).toEqual({ refused: reason })
    }
  })

  it('throws any other refusal', async () => {
    answer(403, { error: 'Forbidden' })
    await expect(completeSignIn('a-code')).rejects.toBeInstanceOf(ApiFailure)
    answer(400, { error: 'That sign-in did not work; try again', reason: 'early-access' })
    await expect(completeSignIn('a-code')).rejects.toBeInstanceOf(ApiFailure)
  })
})

describe('getAccess', () => {
  it('gives the person’s role and whether they are limited to some brands in the workspace, typed in any case', async () => {
    expect(await getAccess('WORKSPACE-2')).toEqual({ role: 'editor', limited: true })
    expect(await getAccess('workspace-1')).toEqual({ role: 'owner', limited: false })
  })

  it('gives the fewest rights for a workspace that isn’t theirs: a Reviewer’s, limited', async () => {
    expect(await getAccess('workspace-3')).toEqual({ role: 'reviewer', limited: true })
  })
})

describe('getRole', () => {
  it("gives the person's role in the workspace, typed in any case", async () => {
    expect(await getRole('WORKSPACE-2')).toBe('editor')
    expect(await getRole('workspace-1')).toBe('owner')
  })

  it("gives a Reviewer's role for a workspace that isn't theirs", async () => {
    expect(await getRole('workspace-3')).toBe('reviewer')
  })
})

describe('getWorkspace', () => {
  it('asks for the workspace by its id, in lower case as ids are, so a link typed in upper case opens it', async () => {
    await getWorkspace('Workspace-1')

    expect(asked).toEqual(['/workspaces/workspace-1'])
  })
})

describe('listDesigns', () => {
  it("asks for the brand's designs under its workspace", async () => {
    await listDesigns('WORKSPACE-1', 'brand-1')

    expect(asked).toEqual(['/workspaces/workspace-1/brands/brand-1/designs'])
  })
})

describe('listFonts', () => {
  it('asks for the brand’s whole catalog, or only the families named', async () => {
    await listFonts('workspace-1', 'brand-1')
    await listFonts('workspace-1', 'brand-1', ['DM Sans', 'Playfair Display'])

    expect(askedWithQuery).toEqual([
      '/workspaces/workspace-1/brands/brand-1/fonts',
      '/workspaces/workspace-1/brands/brand-1/fonts?family=DM+Sans&family=Playfair+Display',
    ])
  })
})

describe('call', () => {
  /** Answers every request 401 with this body. */
  function answer401(body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 401 })),
    )
  }

  it('sends a person whose access early access took away to sign in with its notice', async () => {
    vi.mocked(redirect).mockClear()
    answer401({ error: 'Dazbee is in early access', reason: 'early-access' })
    await call(z.null(), '/me').catch(() => {})
    expect(redirect).toHaveBeenCalledWith('/login?error=early-access')
  })

  it('sends a person early access refused to sign in with its notice from findMe too, and gives null to anyone else', async () => {
    vi.mocked(redirect).mockClear()
    answer401({ error: 'Dazbee is in early access', reason: 'early-access' })
    await findMe()
    expect(redirect).toHaveBeenCalledWith('/login?error=early-access')
    vi.mocked(redirect).mockClear()
    answer401({ error: 'Sign in first' })
    expect(await findMe()).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('sends a person with no session to sign in', async () => {
    vi.mocked(redirect).mockClear()
    answer401({ error: 'Sign in first' })
    await call(z.null(), '/me').catch(() => {})
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
