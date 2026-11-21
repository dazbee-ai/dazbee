import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readSitePage } from './site-page.ts'

/** The Harbour & Pine sample page, as harbour.test serves it. */
const HARBOUR = readFileSync(join(import.meta.dirname, 'test-websites', 'harbour.html'), 'utf8')
/** The size of a hostile page: the most Dazbee reads. */
const PAGE = 2 * 1024 * 1024
/** How long a read in step with its length may take at most: a read that grows with its square takes minutes. */
const IN_STEP_MS = 2_000

/** How long reading `html` takes, in milliseconds. */
function timeToRead(html: string): number {
  const started = performance.now()
  readSitePage(html, new URL('https://hostile.test/'))
  return performance.now() - started
}

describe('readSitePage', () => {
  it('reads a page’s style sheets for screens, theme colour for light pages, icons, share picture and header logo', () => {
    const page = readSitePage(HARBOUR, new URL('https://harbour.test/'))
    expect(page.title).toBe('Harbour & Pine Coffee · Small-batch roasters')
    expect(page.blocked).toBe(false)
    expect(page.stylesheets).toEqual(['https://harbour.test/assets/site.css?v=42'])
    expect(page.themeColor).toBe('#1f4d3a')
    expect(page.icons).toEqual([
      { url: 'https://harbour.test/favicon.ico', size: 48, type: null },
      { url: 'https://harbour.test/icon.svg', size: 0, type: 'image/svg+xml' },
      { url: 'https://harbour.test/apple-touch-icon.png', size: 180, type: null },
    ])
    expect(page.shareImage).toBe('https://harbour.test/share/summer-blend.jpg')
    expect(page.logo?.kind).toBe('svg')
    expect(page.logo?.kind === 'svg' && page.logo.markup).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 180 48"/,
    )
    expect(page.googleFonts).toEqual([
      { family: 'Fraunces', weights: [600, 800] },
      { family: 'Work Sans', weights: [400, 500, 700] },
    ])
    expect(page.classes.button).toEqual(new Set(['menu-toggle', 'btn', 'btn-primary', 'btn-secondary']))
    expect(page.styles).toContain('p.note { color: #6b6b6b }')
  })

  it('takes no drawing in a script, and no menu icon, for the logo', () => {
    const page = readSitePage(
      '<script>document.write("<header><svg class=logo><path d=M0/></svg></header>")</script><header><button><svg class="icon"><path d="M0 0h9"/></svg></button></header>',
      new URL('https://a.test/'),
    )
    expect(page.logo).toBeNull()
  })

  it('keeps at most 20 Google Fonts families, however many a page links', () => {
    const link = `<link rel="stylesheet" href="https://fonts.googleapis.com/css?${'family=A|B|C&'.repeat(150)}">`
    const html = link.repeat(Math.floor(PAGE / link.length))
    expect(timeToRead(html)).toBeLessThan(IN_STEP_MS)
    expect(readSitePage(html, new URL('https://hostile.test/')).googleFonts).toHaveLength(20)
  })

  it.each([
    ['a lone “<” everywhere', '<'.repeat(PAGE)],
    ['a tag that never ends', `<a ${'b '.repeat(PAGE / 2)}`],
    ['a quote that never ends', `<a href="${'x'.repeat(PAGE)}`],
    ['drawings nested without end', '<header><a class="logo" href="/"><svg>'.padEnd(PAGE, '<svg>')],
    ['a script that never closes, full of “</”', `<script>${'</'.repeat(PAGE / 2)}`],
    ['a class list of a million names', `<div class="${'c '.repeat(PAGE / 2)}">`],
    ['many different classes', Array.from({ length: 100_000 }, (_, i) => `<i class="c${i}">`).join('')],
    ['comments that never end', `<!--${'-'.repeat(PAGE)}`],
  ])('reads a page of %s in step with its length', (_name, html) => {
    expect(timeToRead(html)).toBeLessThan(IN_STEP_MS)
  })
})
