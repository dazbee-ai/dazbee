// The third-party notices page, rendered in Node with the locale cookie stubbed: each bundled set and its licence.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoticesPage, { generateMetadata } from './page.tsx'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))

const { cookies } = await import('next/headers')

/** The locale the page is asked in. */
let locale: string

beforeEach(() => {
  locale = 'en'
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'locale' ? { name, value: locale } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
})

/** Each set's notice as a person reads it: its text with the markup taken out and its parts spaced. */
async function noticesRead() {
  const markup = renderToStaticMarkup(await NoticesPage())
  return [...markup.matchAll(/data-testid="notice"[^>]*>([\s\S]*?)<\/section>/g)].map(([, inner = '']) =>
    inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

describe('generateMetadata', () => {
  it('names the page in the person’s language', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Third-party notices' })
  })
})

describe('NoticesPage', () => {
  it('lists each bundled set with its version, its licence’s name and the licence in full', async () => {
    const [tabler, phosphor, ...rest] = await noticesRead()
    expect(rest).toEqual([])
    expect(tabler).toMatch(
      /^Tabler Icons Version 3\.52\.0 · MIT licence MIT License Copyright \(c\) 2020-2026 Paweł Kuna /,
    )
    expect(phosphor).toMatch(
      /^Phosphor Icons Version 2\.1\.1 · MIT licence MIT License Copyright \(c\) 2023 Phosphor Icons /,
    )
    for (const notice of [tabler, phosphor]) {
      expect(notice).toContain('The above copyright notice and this permission notice shall be included in all copies')
      expect(notice).toMatch(/OTHER DEALINGS IN THE SOFTWARE\.$/)
    }
  })

  it('links each set’s name to its site, in a new tab', async () => {
    const markup = renderToStaticMarkup(await NoticesPage())
    expect(markup).toMatch(/<a href="https:\/\/tabler\.io\/icons" target="_blank" rel="noreferrer"/)
    expect(markup).toMatch(/<a href="https:\/\/phosphoricons\.com" target="_blank" rel="noreferrer"/)
  })

  it('speaks Arabic around the licences, which stay in English', async () => {
    locale = 'ar'
    const [tabler] = await noticesRead()
    expect(tabler).toMatch(/^Tabler Icons الإصدار 3\.52\.0 · ترخيص MIT MIT License /)
  })
})
