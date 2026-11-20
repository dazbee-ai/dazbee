// The sign-in page, rendered in Node with the locale cookie stubbed: the notice it shows for each answer.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LoginPage, { generateMetadata } from './page.tsx'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./actions.ts', () => ({ start: vi.fn(), requestToJoin: vi.fn() }))

const { cookies } = await import('next/headers')

/** The locale the page is asked in. */
let locale: string

beforeEach(() => {
  locale = 'en'
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'locale' ? { name, value: locale } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The page's markup for the query. */
async function render(query: Record<string, string>) {
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(query) }))
}

/** The notice's text as a person reads it, or null when the page shows none. */
async function noticeOf(query: Record<string, string>) {
  const notice = /data-testid="sign-in-notice"[^>]*>([\s\S]*?)<\/p>/.exec(await render(query))
  return notice ? (notice[1] ?? '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '') : null
}

describe('generateMetadata', () => {
  it('sends no referrer, since the address can carry the Connect an agent page with its request', async () => {
    expect(await generateMetadata()).toMatchObject({ title: 'Sign in to Dazbee', referrer: 'no-referrer' })
  })
})

describe('LoginPage', () => {
  it('tells a person early access refused whom to write to, in each language', async () => {
    vi.stubEnv('SUPPORT_EMAIL', 'hello@example.com')

    expect(await noticeOf({ error: 'early-access' })).toBe(
      'Dazbee is in early access. Write to hello@example.com to join.',
    )
    expect(await render({ error: 'early-access' })).toContain('href="mailto:hello@example.com"')
    locale = 'ar'
    expect(await noticeOf({ error: 'early-access' })).toBe(
      'Dazbee في مرحلة الوصول المبكر. راسلنا على hello@example.com للانضمام.',
    )
  })

  it('ends the early access notice at "early access." when there is no address to write to', async () => {
    for (const email of [undefined, '', ' ']) {
      locale = 'en'
      vi.stubEnv('SUPPORT_EMAIL', email)

      expect(await noticeOf({ error: 'early-access' })).toBe('Dazbee is in early access.')
      expect(await render({ error: 'early-access' })).not.toContain('mailto:')
      locale = 'ar'
      expect(await noticeOf({ error: 'early-access' })).toBe('Dazbee في مرحلة الوصول المبكر.')
    }
  })

  it('tells a person with a pending invite to open it, in each language, with or without an address', async () => {
    for (const email of ['hello@example.com', undefined]) {
      vi.stubEnv('SUPPORT_EMAIL', email)
      locale = 'en'

      expect(await noticeOf({ error: 'open-invite' })).toBe('Open the invite in your email to join.')
      locale = 'ar'
      expect(await noticeOf({ error: 'open-invite' })).toBe('افتح الدعوة في بريدك الإلكتروني للانضمام.')
    }
  })

  it('says any other sign-in failed, and shows no notice without one', async () => {
    expect(await noticeOf({ error: '1' })).toBe('That sign-in did not work. Try again.')
    expect(await noticeOf({})).toBeNull()
  })

  it('offers Request access under the early-access notice only', async () => {
    expect(await render({ error: 'early-access' })).toContain('data-testid="request-access"')
    expect(await render({ error: 'open-invite' })).not.toContain('data-testid="request-access"')
    expect(await render({})).not.toContain('data-testid="request-access"')
  })

  it('sends the Connect an agent page to come back to with Sign in, and no other page', async () => {
    expect(await render({ next: '/agents/connect?request=x' })).toContain(
      '<input type="hidden" name="next" value="/agents/connect?request=x"/>',
    )
    expect(await render({ next: 'https://elsewhere.example' })).not.toContain('name="next"')
    expect(await render({})).not.toContain('name="next"')
  })

  it('says the account is deleted right after it is, in each language, as news rather than a refusal', async () => {
    expect(await render({ deleted: '1' })).toContain('Your account is deleted.')
    expect(await noticeOf({ deleted: '1' })).toBeNull()
    locale = 'ar'
    expect(await render({ deleted: '1' })).toContain('حُذف حسابك.')
    expect(await render({})).not.toContain('data-testid="sign-in-news"')
  })
})
