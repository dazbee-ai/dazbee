import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { readSitePage } from './site-page.ts'

/** The Harbour & Pine sample page, as harbour.test serves it. */
const HARBOUR = readFileSync(join(import.meta.dirname, 'test-websites', 'harbour.html'), 'utf8')
/** The size of a hostile page: the most Dazbee reads. */
const PAGE = 2 * 1024 * 1024
/** The most `growth` may give: about 10 for a read in step with its length, about 100 for one that grows with its square. */
const MAX_GROWTH = 30
/** How many times as long as a page of the sample site of the same length a hostile page may take to read. */
const MAX_SLOWER = 10
/** How much processor time `growth` spends sampling before it stops: a read that grows with its square fails after one sample. */
const SAMPLING_MS = 1_500
/** How long each half of a sample runs, in ms: many steps of a processor clock that steps by 15.6 ms on Windows. */
const HALF_SAMPLE_MS = 200

/** Reads `html` as a page of a hostile site. */
const read = (html: string) => readSitePage(html, new URL('https://hostile.test/'))

/** The processor time this process has used so far, in ms: a busy machine that keeps it waiting adds nothing. */
function cpuMs(): number {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}

/** How many times `html` reads in `HALF_SAMPLE_MS` of processor time, at least once. */
function readsInHalfSample(html: string): number {
  let runs = 0
  const started = cpuMs()
  do {
    read(html)
    runs++
  } while (cpuMs() - started < HALF_SAMPLE_MS)
  return runs
}

/** How long one read of `html` takes, in processor time, from as many reads as fit in `HALF_SAMPLE_MS`. */
function timeOfRead(html: string): number {
  const started = cpuMs()
  const runs = readsInHalfSample(html)
  return (cpuMs() - started) / runs
}

/**
 * How many times longer reading a page of `length` characters made by `page` takes than reading one a tenth
 * as long, in processor time. Each sample reads the short page, then the long page, each as often as it reads
 * in `HALF_SAMPLE_MS`, so both halves take about as long and are slowed alike; each half's time over up to 3
 * samples counts, since Windows charges processor time by the 15.6 ms tick a thread runs in.
 */
function growth(page: (length: number) => string, length: number): number {
  const short = page(length / 10)
  const long = page(length)
  const shortRuns = readsInHalfSample(short)
  const longRuns = readsInHalfSample(long)
  let shortTook = 0
  let longTook = 0
  const sampling = cpuMs()
  for (let sample = 0; sample < 3 && cpuMs() - sampling < SAMPLING_MS; sample++) {
    const before = cpuMs()
    for (let run = 0; run < shortRuns; run++) read(short)
    const between = cpuMs()
    for (let run = 0; run < longRuns; run++) read(long)
    shortTook += between - before
    longTook += cpuMs() - between
  }
  return longTook / longRuns / (shortTook / shortRuns)
}

/** How long a page of the sample site repeated to `PAGE` characters takes to read, in processor time. */
let sitePageMs = 0

beforeAll(() => {
  const page = HARBOUR.repeat(Math.ceil(PAGE / HARBOUR.length)).slice(0, PAGE)
  read(page)
  sitePageMs = timeOfRead(page)
})

/**
 * Checks that a hostile page made by `page` reads in step with its length, from pages a hundredth of `PAGE`
 * to pages a tenth of it, where a read that grows with its square fails in seconds rather than minutes, and
 * that a page of `PAGE` characters takes at most `MAX_SLOWER` times as long as the sample site's.
 */
function expectInStep(page: (length: number) => string) {
  expect(growth(page, PAGE / 10)).toBeLessThan(MAX_GROWTH)
  expect(timeOfRead(page(PAGE))).toBeLessThan(MAX_SLOWER * sitePageMs)
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
    const page = (length: number) => link.repeat(Math.floor(length / link.length))
    expectInStep(page)
    expect(read(page(PAGE)).googleFonts).toHaveLength(20)
  })

  it.each<[string, (length: number) => string]>([
    ['a lone “<” everywhere', (length) => '<'.repeat(length)],
    ['a tag that never ends', (length) => `<a ${'b '.repeat(length / 2)}`],
    ['a quote that never ends', (length) => `<a href="${'x'.repeat(length)}`],
    ['drawings nested without end', (length) => '<header><a class="logo" href="/"><svg>'.padEnd(length, '<svg>')],
    ['a script that never closes, full of “</”', (length) => `<script>${'</'.repeat(length / 2)}`],
    ['a class list of a million names', (length) => `<div class="${'c '.repeat(length / 2)}">`],
    ['many different classes', (length) => Array.from({ length: length / 20 }, (_, i) => `<i class="c${i}">`).join('')],
    ['comments that never end', (length) => `<!--${'-'.repeat(length)}`],
  ])('reads a page of %s in step with its length', (_name, page) => {
    expectInStep(page)
  })
})
