// Settings' invite, member and agent access actions, run in Node with the API's answers stubbed and the language
// cookie held in a variable: what each asks the API, and the answer the person reads beside what they did, in their
// language.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  changeBrands,
  changeRole,
  deleteMyAccount,
  endAgentAccess,
  handOver,
  invite,
  leave,
  remove,
  resend,
  revoke,
} from './actions.ts'

/** The language the person picked, if any, and the cookies deleted; held where the hoisted cookie stub reads them. */
const picked = vi.hoisted(() => ({ locale: undefined as string | undefined, deleted: [] as string[] }))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === 'locale' && picked.locale ? { value: picked.locale } : undefined),
    has: (name: string) => name === 'dazbee_session',
    delete: (name: string) => picked.deleted.push(name),
  })),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** A pending invite as the API answers with it. */
const INVITE = {
  id: 'invite-1',
  email: 'ada@example.com',
  role: 'editor',
  brandIds: null,
  expiresAt: '2099-01-08T00:00:00.000Z',
  link: 'http://localhost:3000/dev/accept?invite=provider-1',
}

/** The requests the actions sent the API: method, path and body. */
let asked: { method: string; path: string; body: unknown }[]
/** What the API answers every request with, unless `answers` has an answer for its path. */
let answer: { status: number; body: unknown }
let answers: Record<string, { status: number; body: unknown }>

/** A member as the API answers with them. */
const MEMBER = { id: 'user-2', name: 'Ada', email: 'ada@example.com', role: 'reviewer', brandIds: null }

/** A form with each field, and a field given a list once for each of its values. */
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) for (const each of [value].flat()) data.append(name, each)
  return data
}

beforeEach(() => {
  asked = []
  picked.locale = undefined
  picked.deleted = []
  answer = { status: 201, body: INVITE }
  answers = {}
  vi.mocked(revalidatePath).mockReset()
  vi.mocked(redirect).mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({
        method: init?.method ?? 'GET',
        path: new URL(url).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      const { status, body } = answers[new URL(url).pathname] ?? answer
      return status === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(body), { status })
    }),
  )
})

describe('invite', () => {
  it('invites the email, kept lower-cased, with the role, says to whom it was sent, and shows the new invite', async () => {
    const answered = await invite('WORKSPACE-1', null, form({ email: ' Ada@Example.com ', role: 'editor' }))

    expect(asked).toEqual([
      {
        method: 'POST',
        path: '/workspaces/workspace-1/invites',
        body: { email: 'ada@example.com', role: 'editor', brandIds: null },
      },
    ])
    expect(answered).toEqual({ sent: 'ada@example.com' })
    expect(revalidatePath).toHaveBeenCalledWith('/w/WORKSPACE-1/settings')
  })

  it('invites an Editor or Reviewer with the brands ticked under Chosen brands, and an Admin with every brand', async () => {
    const chosen = { email: 'ada@example.com', brands: 'chosen', brand: ['brand-1', 'brand-2'] }
    await invite('workspace-1', null, form({ ...chosen, role: 'reviewer' }))
    await invite('workspace-1', null, form({ ...chosen, role: 'admin' }))
    await invite('workspace-1', null, form({ ...chosen, brands: 'all', role: 'editor' }))
    expect(asked.map((request) => request.body)).toEqual([
      { email: 'ada@example.com', role: 'reviewer', brandIds: ['brand-1', 'brand-2'] },
      { email: 'ada@example.com', role: 'admin', brandIds: null },
      { email: 'ada@example.com', role: 'editor', brandIds: null },
    ])
  })

  it('asks nothing of the API for Chosen brands with none ticked, and says so in the person’s words', async () => {
    picked.locale = 'ar'
    const answered = await invite(
      'workspace-1',
      null,
      form({ email: 'ada@example.com', role: 'editor', brands: 'chosen' }),
    )
    expect(answered).toEqual({
      error: 'اختر علامة تجارية واحدة على الأقل، أو اختر كل العلامات التجارية.',
      field: 'brands',
    })
    expect(asked).toEqual([])
  })

  it("says why the API refused, in the person's words: an email that is a member, a person no longer an Owner or Admin, an invite being sent", async () => {
    for (const [status, error, words] of [
      [400, 'ada@example.com is already a member', 'ada@example.com is already a member.'],
      [403, 'Only an Owner or Admin can do this', 'Only an Owner or Admin can do this. Reload to see what you can do.'],
      [
        409,
        'An invite to ada@example.com is being sent; try again in a moment',
        'This invite is being sent or just changed. Try again in a moment.',
      ],
    ] as const) {
      answer = { status, body: { error } }

      expect(await invite('workspace-1', null, form({ email: 'ada@example.com', role: 'admin' }))).toEqual({
        error: words,
      })
    }
  })

  it('says it in Arabic to a person who picked Arabic', async () => {
    picked.locale = 'ar'
    answer = { status: 400, body: { error: 'ada@example.com is already a member' } }

    expect(await invite('workspace-1', null, form({ email: 'ada@example.com', role: 'admin' }))).toEqual({
      error: 'ada@example.com عضو بالفعل.',
    })
  })

  it("gives the API's own words for a refusal it has no words of its own for", async () => {
    answer = { status: 404, body: { error: 'Invites are not set up for this workspace' } }

    expect(await invite('workspace-1', null, form({ email: 'ada@example.com', role: 'admin' }))).toEqual({
      error: 'Invites are not set up for this workspace',
    })
  })

  it('says an email is not one without asking the API', async () => {
    const answered = await invite('workspace-1', null, form({ email: 'not an email', role: 'editor' }))

    expect(answered).toEqual({ error: 'Enter an email address, such as ada@example.com.' })
    expect(asked).toEqual([])
  })

  it('never asks the API to invite an Owner', async () => {
    const answered = await invite('workspace-1', null, form({ email: 'ada@example.com', role: 'owner' }))

    expect(answered).toHaveProperty('error')
    expect(asked).toEqual([])
  })
})

describe('resend', () => {
  it('sends the invite again and shows its new expiry', async () => {
    answer = { status: 200, body: INVITE }

    expect(await resend('workspace-1', 'invite-1')).toBeNull()
    expect(asked).toEqual([{ method: 'POST', path: '/workspaces/workspace-1/invites/invite-1/resend', body: null }])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it('says an invite is no longer pending when the API has no such invite', async () => {
    answer = { status: 404, body: { error: 'No such invite' } }

    expect(await resend('workspace-1', 'invite-1')).toBe('This invite was accepted, revoked or has expired.')
  })

  it('says a person is no longer an Owner or Admin, rather than showing an error page', async () => {
    answer = { status: 403, body: { error: 'Only an Owner or Admin can do this' } }

    expect(await resend('workspace-1', 'invite-1')).toBe(
      'Only an Owner or Admin can do this. Reload to see what you can do.',
    )
  })

  it('says to try again when the invite changed meanwhile', async () => {
    answer = { status: 409, body: { error: 'This invite changed; try again' } }

    expect(await resend('workspace-1', 'invite-1')).toBe(
      'This invite is being sent or just changed. Try again in a moment.',
    )
  })
})

describe('revoke', () => {
  it('revokes the invite and takes it off the list', async () => {
    answer = { status: 204, body: null }

    expect(await revoke('workspace-1', 'invite-1')).toBeNull()
    expect(asked).toEqual([{ method: 'DELETE', path: '/workspaces/workspace-1/invites/invite-1', body: null }])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it('says an invite the person already accepted was accepted', async () => {
    answer = { status: 409, body: { error: 'This invite was already accepted' } }

    expect(await revoke('workspace-1', 'invite-1')).toBe('This invite was already accepted.')
  })

  it('says an invite is no longer pending when the API has no such invite', async () => {
    answer = { status: 404, body: { error: 'No such invite' } }

    expect(await revoke('workspace-1', 'invite-1')).toBe('This invite was accepted, revoked or has expired.')
  })

  it('lets any other failure through, for the error page', async () => {
    answer = { status: 500, body: { error: 'Something went wrong on our side' } }

    await expect(revoke('workspace-1', 'invite-1')).rejects.toThrow('Something went wrong on our side')
  })
})

describe('changeRole', () => {
  it('asks the API for the member’s new role, and shows the members as they now are', async () => {
    answer = { status: 200, body: MEMBER }

    expect(await changeRole('workspace-1', 'user-2', 'reviewer')).toBeNull()
    expect(asked).toEqual([
      { method: 'PATCH', path: '/workspaces/workspace-1/members/user-2', body: { role: 'reviewer' } },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it("says why the API refused, in the person's words: no longer allowed, or no longer a member", async () => {
    for (const [status, error, words] of [
      [403, 'Only an Owner or Admin can do this', 'You can’t change this member now. Reload to see what you can do.'],
      [
        403,
        'The Owner’s role is changed only by handing over Owner',
        'You can’t change this member now. Reload to see what you can do.',
      ],
      [404, 'No such member', 'This person is no longer a member.'],
    ] as const) {
      answer = { status, body: { error } }
      expect(await changeRole('workspace-1', 'user-2', 'admin')).toBe(words)
    }
  })
})

describe('changeBrands', () => {
  it('asks the API for the member’s brands, a list or every brand, and shows the members as they now are', async () => {
    answer = { status: 200, body: MEMBER }

    expect(await changeBrands('workspace-1', 'user-2', ['brand-1'])).toBeNull()
    expect(await changeBrands('workspace-1', 'user-2', null)).toBeNull()
    expect(asked).toEqual([
      { method: 'PATCH', path: '/workspaces/workspace-1/members/user-2', body: { brandIds: ['brand-1'] } },
      { method: 'PATCH', path: '/workspaces/workspace-1/members/user-2', body: { brandIds: null } },
    ])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it("says why the API refused, in the person's words: brands that can't be given, no longer allowed, or no longer a member", async () => {
    for (const [status, error, words] of [
      [
        400,
        'Only an Editor or Reviewer can be limited to some brands',
        'These brands can’t be given now. Reload to see this member’s role and the brands.',
      ],
      [403, 'Only an Owner or Admin can do this', 'You can’t change this member now. Reload to see what you can do.'],
      [404, 'No such member', 'This person is no longer a member.'],
    ] as const) {
      answer = { status, body: { error } }
      expect(await changeBrands('workspace-1', 'user-2', ['brand-1'])).toBe(words)
    }
  })
})

describe('remove', () => {
  it('asks the API to remove the member, and shows the members as they now are', async () => {
    answer = { status: 204, body: null }

    expect(await remove('workspace-1', 'user-2')).toBeNull()
    expect(asked).toEqual([{ method: 'DELETE', path: '/workspaces/workspace-1/members/user-2', body: null }])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it("says it in the person's words when the member is gone, in Arabic too", async () => {
    answer = { status: 404, body: { error: 'No such member' } }
    expect(await remove('workspace-1', 'user-2')).toBe('This person is no longer a member.')
    picked.locale = 'ar'
    expect(await remove('workspace-1', 'user-2')).toBe('لم يعد هذا الشخص عضوًا.')
  })
})

describe('handOver', () => {
  it('asks the API to make the Admin the Owner, and shows the members as they now are', async () => {
    answer = { status: 204, body: null }

    expect(await handOver('workspace-1', 'user-2')).toBeNull()
    expect(asked).toEqual([{ method: 'POST', path: '/workspaces/workspace-1/members/user-2/owner', body: null }])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it("says why the API refused, in the person's words: no longer the Owner, or the member no longer an Admin", async () => {
    for (const [status, error, words] of [
      [403, 'Only the Owner can hand over Owner', 'Only the Owner can hand over Owner. Reload to see what you can do.'],
      [400, 'Only an Admin can be made Owner', 'Only an Admin can be made Owner. Reload to see their role now.'],
      [404, 'No such member', 'This person is no longer a member.'],
    ] as const) {
      answer = { status, body: { error } }
      expect(await handOver('workspace-1', 'user-2')).toBe(words)
    }
  })
})

describe('leave', () => {
  /** The person's summary after leaving, with the workspace to open, if any. */
  const meOpening = (open: string | null) => ({
    status: 200,
    body: { id: 'user-1', name: 'Ada', email: 'ada@example.com', workspaces: [], open },
  })

  it('asks the API to take the person out of the workspace, then opens the workspace to open', async () => {
    answer = { status: 204, body: null }
    answers = { '/me': meOpening('workspace-2') }

    await leave('workspace-1')
    expect(asked.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /workspaces/workspace-1/leave',
      'GET /me',
    ])
    expect(redirect).toHaveBeenCalledWith('/w/workspace-2')
    expect(picked.deleted).toEqual([])
  })

  it('signs the person out of the app and WorkOS when they left their last workspace', async () => {
    answer = { status: 204, body: null }
    answers = {
      '/me': meOpening(null),
      '/auth/sign-out': { status: 200, body: { logoutUrl: 'https://auth.example.test/logout?session_id=s1' } },
    }

    await leave('workspace-1')
    expect(picked.deleted).toEqual(['dazbee_session'])
    expect(redirect).toHaveBeenCalledWith('https://auth.example.test/logout?session_id=s1')
  })

  it('opens the workspace to open when the person was no longer a member', async () => {
    answer = { status: 404, body: { error: 'No such workspace' } }
    answers = { '/me': meOpening('workspace-2') }

    await leave('workspace-1')
    expect(redirect).toHaveBeenCalledWith('/w/workspace-2')
  })

  it("says the Owner hands over Owner first, in the person's words, and stays", async () => {
    answer = { status: 400, body: { error: 'Hand over Owner first' } }

    expect(await leave('workspace-1')).toBe('Hand over Owner to an Admin before you leave.')
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('deleteMyAccount', () => {
  it('deletes the account with the email typed, forgets the session alone and opens sign-in saying so', async () => {
    answer = { status: 204, body: null }

    expect(await deleteMyAccount('workspace-1', { email: 'Ada@Example.com', deletes: ['w-1'] })).toBeUndefined()
    expect(asked).toEqual([{ method: 'DELETE', path: '/me', body: { email: 'Ada@Example.com', deletes: ['w-1'] } }])
    expect(picked.deleted).toEqual(['dazbee_session'])
    expect(redirect).toHaveBeenCalledWith('/login?deleted=1')
  })

  it("says why the API refused, in the person's words, and draws Settings again", async () => {
    picked.locale = 'ar'
    answer = { status: 400, body: { error: 'Type your account’s email to delete it', handOver: [] } }
    expect(await deleteMyAccount('workspace-1', { email: 'someone@example.com', deletes: [] })).toBe(
      'هذا ليس البريد الإلكتروني لحسابك. اكتبه كما يظهر.',
    )
    picked.locale = undefined
    answer = { status: 409, body: { error: 'Hand over Owner first', handOver: [{ id: 'w-2', name: 'Team' }] } }
    expect(await deleteMyAccount('workspace-1', { email: 'ada@example.com', deletes: [] })).toBe(
      'What deleting your account deletes has changed. Read it again below.',
    )
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
    expect(redirect).not.toHaveBeenCalled()
    expect(picked.deleted).toEqual([])
  })

  it('opens sign-in saying so when the account was already deleted, as by a second press', async () => {
    answer = { status: 404, body: { error: 'There is no such account', handOver: [] } }

    expect(await deleteMyAccount('workspace-1', { email: 'ada@example.com', deletes: [] })).toBeUndefined()
    expect(picked.deleted).toEqual(['dazbee_session'])
    expect(redirect).toHaveBeenCalledWith('/login?deleted=1')
  })
})

describe('endAgentAccess', () => {
  it('asks the API to end the access by its id, and shows the accesses as they now are', async () => {
    answer = { status: 204, body: null }

    expect(await endAgentAccess('workspace-1', 'access-1')).toBeNull()
    expect(asked).toEqual([{ method: 'DELETE', path: '/workspaces/workspace-1/agent-accesses/access-1', body: null }])
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it("says an access that has ended has ended, in the person's words, in Arabic too, and shows the accesses as they now are", async () => {
    answer = { status: 404, body: { error: 'No such agent access' } }
    expect(await endAgentAccess('workspace-1', 'access-1')).toBe('This agent’s access has already ended.')
    picked.locale = 'ar'
    expect(await endAgentAccess('workspace-1', 'access-1')).toBe('انتهى وصول هذا الوكيل من قبل.')
    expect(revalidatePath).toHaveBeenCalledWith('/w/workspace-1/settings')
  })

  it("gives the API's own words for any other refusal", async () => {
    answer = { status: 403, body: { error: 'Agents may not do this' } }

    expect(await endAgentAccess('workspace-1', 'access-1')).toBe('Agents may not do this')
  })
})
