// A brand's website read for its brand kit, through the safe fetch: its page, up to four of its style sheets, and
// its web manifest when the page links no logo; its colours by role, its fonts as the catalog's families, and its
// logos best first, each fetched only when asked for. Every fetch of one read comes out of one budget of fetches and
// time, and every file is capped in size. It changes nothing, so the editor can show what a site gives before a
// person keeps it.
import { type FontFamily, WEBSITE_READ_TIMEOUT_MS, type WebsiteFont } from '@dazbee/schema'

import { type FetchedFile, FetchRefused, safeFetch, type SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { matchFont } from './font-match.ts'
import { type ColorRoles, colorRoles, parseColor } from './site-colors.ts'
import { readSitePage, type SiteIcon, type SitePage } from './site-page.ts'
import { readSiteStyles, type SiteStyles } from './site-styles.ts'

/** A logo the site offers: an SVG drawing in its page, or a picture at a link. */
export type LogoSource = { kind: 'svg'; markup: string } | { kind: 'link'; url: string }

/** The fetches a read may still make, and when its time is up, on `Date.now`'s clock. */
export interface FetchBudget {
  left: number
  until: number
}

/** What a website gives a brand kit. */
export interface Website {
  /** The page read, after its redirects. */
  site: string
  /** The site's name, from its title, else its host. */
  name: string
  colors: ColorRoles
  fonts: WebsiteFont[]
  /** Its logos, best first: the logo in its header, its SVG icon, then its largest icons. */
  logos: LogoSource[]
  /** Its share picture (`og:image`), never taken for the logo. */
  shareImage: string | null
  /** What the read couldn't do, each in a sentence. */
  notes: string[]
  /** What is left of the read's fetches and time, for fetching its logos. */
  budget: FetchBudget
}

/** The most fetches one read makes: its page, four style sheets, its manifest and two logos. */
export const MAX_SITE_FETCHES = 8
/** The largest page read, the largest style sheet, all the CSS read together, the largest manifest and logo. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024
export const MAX_STYLESHEET_BYTES = 1024 * 1024
export const MAX_CSS_CHARACTERS = 2 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 64 * 1024
export const MAX_LOGO_BYTES = 5_000_000

/** How many of the page's style sheets are read. */
const MAX_STYLESHEETS = 4
/** The longest one fetch of each kind may take, within what is left of the read's time. */
const PAGE_MS = 12_000
const FILE_MS = 8_000
/** The least side, in pixels, of an icon taken for the logo. */
const MIN_ICON_SIZE = 128
/** The statuses a site turns readers away with. */
const TURNED_AWAY = new Set([401, 403, 429, 451])
/** The types a web page is sent as; a site that names none may still send one. */
const PAGE_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)$/

/**
 * The website at `link` as a brand kit takes it, its fonts matched to `catalog`; `logos` says whether its logos are
 * wanted, so that its manifest is fetched for them when the page offers none. It throws `FetchRefused` with a
 * sentence for a page that can't be read: one the safe fetch refuses, a site that turns Dazbee away or shows a check
 * for robots, or a file that isn't a web page.
 */
export async function readWebsite(
  link: string,
  outside: SafeFetchSettings,
  catalog: readonly FontFamily[],
  { logos: wantLogos }: { logos: boolean },
): Promise<Website> {
  const budget: FetchBudget = { left: MAX_SITE_FETCHES, until: Date.now() + WEBSITE_READ_TIMEOUT_MS }
  const pageFile = await fetchPage(link, budget, outside)
  const site = new URL(pageFile.url)
  const page = readSitePage(new TextDecoder().decode(pageFile.bytes), site)
  if (page.blocked)
    throw new FetchRefused(
      `${site.hostname} showed Dazbee a check for robots instead of its page, so Dazbee can’t read it; ask the person for their logo, brand colours and fonts instead`,
    )
  const notes: string[] = []
  const styles = readSiteStyles(await styleSheets(page, budget, outside, notes), page.classes)
  const logos = await logoSources(page, budget, outside, wantLogos)
  return {
    site: site.href,
    name: siteName(page.title, site),
    colors: colorRoles(styles.colors, page.themeColor ? parseColor(page.themeColor) : null),
    fonts: siteFonts(styles, page, catalog),
    logos,
    shareImage: page.shareImage,
    notes,
    budget,
  }
}

/** The file of a logo the site links, fetched out of the read's budget, at most `MAX_LOGO_BYTES`. */
export function fetchLogo(url: string, budget: FetchBudget, outside: SafeFetchSettings): Promise<FetchedFile> {
  return fetchWithin(url, budget, MAX_LOGO_BYTES, FILE_MS, outside)
}

/** `link` fetched out of `budget`, at most `maxBytes`, in at most `capMs` or what is left of the read's time. */
async function fetchWithin(
  link: string,
  budget: FetchBudget,
  maxBytes: number,
  capMs: number,
  outside: SafeFetchSettings,
): Promise<FetchedFile> {
  const timeoutMs = Math.min(capMs, budget.until - Date.now())
  if (budget.left <= 0 || timeoutMs < 1_000)
    throw new FetchRefused('Dazbee read as many of the site’s files as it reads at once')
  budget.left--
  return safeFetch(link, { maxBytes, timeoutMs }, outside)
}

/** The page at `link`, refused in a sentence when the site turns Dazbee away or sends something else. */
async function fetchPage(link: string, budget: FetchBudget, outside: SafeFetchSettings): Promise<FetchedFile> {
  let file: FetchedFile
  try {
    file = await fetchWithin(link, budget, MAX_PAGE_BYTES, PAGE_MS, outside)
  } catch (error) {
    if (error instanceof FetchRefused && error.status !== null && TURNED_AWAY.has(error.status))
      throw new FetchRefused(
        `${new URL(link).hostname} turned Dazbee away (${error.status}): it lets only people in a browser read it, so Dazbee can’t; ask the person for their logo, brand colours and fonts instead`,
        error.status,
      )
    throw error
  }
  const type = file.contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type && !PAGE_TYPES.test(type)) {
    const named = /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/.test(type) ? ` (it is ${type})` : ''
    throw new FetchRefused(`That link is not a web page${named}; give the address of the brand’s website`)
  }
  return file
}

/**
 * The CSS the page uses: up to `MAX_STYLESHEETS` of its style sheets, fetched at once, then its style blocks and
 * attributes, at most `MAX_CSS_CHARACTERS` together. A sheet that can't be read is left out and noted.
 */
async function styleSheets(page: SitePage, budget: FetchBudget, outside: SafeFetchSettings, notes: string[]) {
  const links = page.stylesheets.slice(0, MAX_STYLESHEETS)
  const fetched = await Promise.allSettled(
    links.map((url) => fetchWithin(url, budget, MAX_STYLESHEET_BYTES, FILE_MS, outside)),
  )
  const sheets: string[] = []
  let failed = 0
  for (const result of fetched) {
    const text = result.status === 'fulfilled' ? new TextDecoder().decode(result.value.bytes) : null
    if (text === null || text.trimStart().startsWith('<')) failed++
    else sheets.push(text)
  }
  if (failed > 0)
    notes.push(
      `Dazbee couldn’t read ${failed} of the site’s ${links.length} style sheets, so some of its colours and fonts may be missing`,
    )
  const kept: string[] = []
  let total = 0
  for (const sheet of [...sheets, ...page.styles]) {
    if (total + sheet.length > MAX_CSS_CHARACTERS) break
    total += sheet.length
    kept.push(sheet)
  }
  return kept
}

/**
 * The site's logos, best first: the logo in its header, its SVG icon, then its icons of at least `MIN_ICON_SIZE`
 * pixels, largest first. Its manifest is fetched for its icons when `manifest` says so and the page offers none of
 * these.
 */
async function logoSources(
  page: SitePage,
  budget: FetchBudget,
  outside: SafeFetchSettings,
  manifest: boolean,
): Promise<LogoSource[]> {
  const sources: LogoSource[] = []
  if (page.logo) sources.push(page.logo.kind === 'svg' ? page.logo : { kind: 'link', url: page.logo.url })
  const svgIcon = page.icons.find(isSvgIcon)
  if (svgIcon) sources.push({ kind: 'link', url: svgIcon.url })
  let icons = page.icons.filter((icon) => !isSvgIcon(icon) && icon.size >= MIN_ICON_SIZE && !isIco(icon))
  if (manifest && sources.length === 0 && icons.length === 0 && page.manifest)
    icons = (await manifestIcons(page.manifest, budget, outside)).filter(
      (icon) => icon.size >= MIN_ICON_SIZE && !isIco(icon),
    )
  for (const icon of icons.sort((a, b) => b.size - a.size)) sources.push({ kind: 'link', url: icon.url })
  return sources.filter(
    (source, i) => source.kind === 'svg' || sources.findIndex((s) => s.kind === 'link' && s.url === source.url) === i,
  )
}

/** Whether an icon is an SVG file: by its type, its size "any", or its link's ending. */
function isSvgIcon(icon: SiteIcon): boolean {
  return icon.type === 'image/svg+xml' || icon.size === Infinity || new URL(icon.url).pathname.endsWith('.svg')
}

/** Whether an icon is a Windows icon file, which Dazbee doesn't store. */
function isIco(icon: SiteIcon): boolean {
  return (
    icon.type === 'image/x-icon' ||
    icon.type === 'image/vnd.microsoft.icon' ||
    new URL(icon.url).pathname.endsWith('.ico')
  )
}

/** The icons a web manifest lists for any use (not only as a mask or in one colour); none when it can't be read. */
async function manifestIcons(link: string, budget: FetchBudget, outside: SafeFetchSettings): Promise<SiteIcon[]> {
  let manifest: unknown
  try {
    const file = await fetchWithin(link, budget, MAX_MANIFEST_BYTES, FILE_MS, outside)
    manifest = JSON.parse(new TextDecoder().decode(file.bytes))
  } catch {
    return []
  }
  const icons = (manifest as { icons?: unknown } | null)?.icons
  if (!Array.isArray(icons)) return []
  return icons.slice(0, 32).flatMap((icon: unknown): SiteIcon[] => {
    const { src, sizes, type, purpose } = (icon ?? {}) as Record<string, unknown>
    if (typeof src !== 'string') return []
    if (typeof purpose === 'string' && !purpose.split(/\s+/).includes('any')) return []
    const url = URL.parse(src, link)
    if (!url || url.protocol !== 'https:' || url.href.length > 2048) return []
    const size = Math.max(
      0,
      ...[...String(sizes ?? '').matchAll(/(\d{1,5})x(\d{1,5})/g)].map((m) => Math.max(Number(m[1]), Number(m[2]))),
    )
    return [{ url: url.href, size, type: typeof type === 'string' ? type.toLowerCase() : null, rel: 'icon' }]
  })
}

/**
 * The site's Heading and Body fonts as the catalog's families: the stacks its CSS gives headings and the page, each
 * drawing the weights its `@font-face` or Google Fonts link gives the family. A role the CSS names no family for
 * takes the site's Google Fonts: Heading the first, Body the last.
 */
function siteFonts(styles: SiteStyles, page: SitePage, catalog: readonly FontFamily[]): WebsiteFont[] {
  const google = [...page.googleFonts, ...styles.googleFonts]
  const stacks = {
    heading: styles.fonts.heading.length > 0 ? styles.fonts.heading : google.slice(0, 1).map((f) => f.family),
    body: styles.fonts.body.length > 0 ? styles.fonts.body : google.slice(-1).map((f) => f.family),
  }
  const weightsOf = (family: string) =>
    styles.faces.get(family.toLowerCase()) ??
    google.find((f) => f.family.toLowerCase() === family.toLowerCase())?.weights ??
    []
  return (['heading', 'body'] as const).flatMap((role) => {
    const stack = stacks[role]
    const matched = matchFont(stack, weightsOf(stack[0] ?? ''), catalog)
    return matched ? [{ role, ...matched }] : []
  })
}

/** A site's name: its title's first part, before a separator such as "|" or "·", else its host. */
function siteName(title: string, site: URL): string {
  const first = title.split(/\s[|·•—–:-]\s/)[0]?.trim() ?? ''
  return (first || site.hostname.replace(/^www\./, '')).slice(0, 80)
}
