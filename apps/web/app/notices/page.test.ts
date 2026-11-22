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

/** Each set's notice as a person reads it: its text with the markup and direction marks taken out, its parts spaced. */
async function noticesRead() {
  const markup = renderToStaticMarkup(await NoticesPage())
  return [...markup.matchAll(/data-testid="notice"[^>]*>([\s\S]*?)<\/section>/g)].map(([, inner = '']) =>
    inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/[\u2066\u2069]/g, '')
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
    const stickers = rest.slice(0, 4)
    const illustrations = rest.slice(4, 7)
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
    const [fluent, ...cc0] = stickers
    expect(fluent).toMatch(
      /^Fluent Emoji Version 1ffb34c · MIT licence MIT License Copyright \(c\) Microsoft Corporation\. /,
    )
    expect(cc0.map((notice) => notice.split(' Version ')[0])).toEqual(['Open Peeps', 'Humaaans', 'Open Doodles'])
    for (const notice of cc0) {
      expect(notice).toMatch(/^[\w ]+ Version 2026-11-22 · CC0-1\.0 licence [\w ]+ by Pablo Stanley\. /)
      expect(notice).toContain('Creative Commons Legal Code CC0 1.0 Universal')
      expect(notice).toMatch(/this CC0 or use of the Work\.$/)
    }
    expect(illustrations.map((notice) => notice.split(' By ')[0])).toEqual([
      'unDraw',
      'ManyPixels Chromablue',
      'ManyPixels Birdview',
    ])
    expect(illustrations[0]).toMatch(
      /^unDraw By Katerina Limpitsouni Version 9c02f98 · unDraw licence unDraw, by Katerina Limpitsouni\. /,
    )
    for (const notice of illustrations.slice(1)) {
      expect(notice).toMatch(/^ManyPixels \w+ By ManyPixels Version 2026-11-22 · ManyPixels licence ManyPixels \w+, /)
      expect(notice).toContain(
        'Copyright 2020 MANYPIXELS PTE LTD All images, assets and vectors published on ManyPixels',
      )
    }
    expect(illustrations[0]).toContain('Copyright 2026 Katerina Limpitsouni All images, assets and vectors published')
    expect(illustrations[0]).toMatch(/must not be used otherwise\.$/)
    for (const notice of [tabler, phosphor, ...stickers]) expect(notice).not.toContain(' By ')
  })

  it('credits each artwork set’s creator by name, with its licence’s name and the licence in full', async () => {
    const artwork = (await noticesRead()).slice(9)
    expect(artwork.map((notice) => notice.split(' Version ')[0])).toEqual([
      'Streamline Kameleon By Streamline',
      'Streamline Plump By Streamline',
      'Streamline Freehand By Streamline',
      'Streamline Stickies By Streamline',
      '3dicons By Vijay Verma',
      'Coolshapes By Coolshapes',
      'dddoodle By fffuel',
      'Kenney Particle Pack By Kenney',
      'Kenney Smoke Particles By Kenney',
      'Pattern Monster By Pattern Monster',
    ])
    const streamline = artwork.slice(0, 4)
    for (const notice of [...streamline, artwork[6] ?? '']) {
      expect(notice).toMatch(/ · CC BY 4\.0 licence /)
      expect(notice).toContain('Used under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)')
      expect(notice).toContain('Creative Commons Attribution 4.0 International Public License')
    }
    for (const notice of artwork.slice(7, 9)) expect(notice).toContain('CC0 1.0 Universal')
    for (const notice of [artwork[5], artwork[9]]) expect(notice).toContain('Permission is hereby granted')
  })

  it('links each set’s name to its site, in a new tab', async () => {
    const markup = renderToStaticMarkup(await NoticesPage())
    expect(markup).toMatch(/<a href="https:\/\/tabler\.io\/icons" target="_blank" rel="noreferrer"/)
    expect(markup).toMatch(/<a href="https:\/\/phosphoricons\.com" target="_blank" rel="noreferrer"/)
    expect(markup).toMatch(
      /<a href="https:\/\/github\.com\/microsoft\/fluentui-emoji" target="_blank" rel="noreferrer"/,
    )
    expect(markup).toMatch(/<a href="https:\/\/www\.openpeeps\.com" target="_blank" rel="noreferrer"/)
    expect(markup).toMatch(/<a href="https:\/\/undraw\.co" target="_blank" rel="noreferrer"[^>]*>unDraw<\/a>/)
    expect(markup).toMatch(
      /<a href="https:\/\/undraw\.co" target="_blank" rel="noreferrer"[^>]*>Katerina Limpitsouni<\/a>/,
    )
    expect(markup).toMatch(
      /<a href="https:\/\/www\.manypixels\.co" target="_blank" rel="noreferrer"[^>]*>ManyPixels<\/a>/,
    )
    expect(markup).toMatch(
      /<a href="https:\/\/www\.streamlinehq\.com" target="_blank" rel="noreferrer"[^>]*>Streamline<\/a>/,
    )
    expect(markup).toMatch(/<a href="https:\/\/www\.fffuel\.co" target="_blank" rel="noreferrer"[^>]*>fffuel<\/a>/)
  })

  it('speaks Arabic around the licences, which stay in English', async () => {
    locale = 'ar'
    const [tabler] = await noticesRead()
    expect(tabler).toMatch(/^Tabler Icons الإصدار 3\.52\.0 · ترخيص MIT MIT License /)
  })

  it('keeps each version and licence name left to right inside Arabic, so a date reads 2026-11-22', async () => {
    locale = 'ar'
    const markup = renderToStaticMarkup(await NoticesPage())
    expect(markup).toContain('الإصدار \u20662026-11-22\u2069 · ترخيص \u2066CC0-1.0\u2069')
  })
})
