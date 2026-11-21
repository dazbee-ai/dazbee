// A website's page read for its brand: its style sheets and styles, the classes its elements use, its theme colour,
// icons, web manifest and share picture, the logo in its header, its Google Fonts and whether it is a check for
// robots rather than the page. One pass over the markup, finding each tag's end by searching forward only, so a
// page of any shape takes time in step with its length.
import { type GoogleFontFamily, googleFontsOf } from './google-font-links.ts'

/** How the page's elements use classes, which says what a class-only CSS rule styles. */
export interface PageClasses {
  /** How many elements carry each class. */
  uses: ReadonlyMap<string, number>
  /** The classes of the `html` and `body` elements: their rules style the page itself. */
  page: ReadonlySet<string>
  /** The classes of headings, `h1` to `h3`. */
  heading: ReadonlySet<string>
  /** The classes of buttons, and of elements whose class names a button. */
  button: ReadonlySet<string>
}

/** An icon the page links: its https link, its largest side in pixels (Infinity for any size, 0 unknown), its type. */
export interface SiteIcon {
  url: string
  size: number
  type: string | null
  rel: 'icon' | 'apple-touch-icon'
}

/** The page's logo: an SVG drawing in its markup, or a picture it links. */
export type SiteLogo = { kind: 'svg'; markup: string } | { kind: 'image'; url: string }

/** What the page says of its brand. */
export interface SitePage {
  /** The page's title, its entities read. */
  title: string
  /** Whether the page is a check for robots, such as Cloudflare's, rather than the site. */
  blocked: boolean
  /** The https links of the style sheets it loads for screens, in order, Google Fonts' left out. */
  stylesheets: string[]
  /** Its `<style>` blocks, and its elements' `style` attributes each as a rule of the tag and its classes. */
  styles: string[]
  classes: PageClasses
  /** Its theme colour as written, the one for light pages. */
  themeColor: string | null
  icons: SiteIcon[]
  /** The https link of its web manifest. */
  manifest: string | null
  /** The https link of its share picture (`og:image`). */
  shareImage: string | null
  logo: SiteLogo | null
  googleFonts: GoogleFontFamily[]
}

/** An element's attributes, by lower-case name. */
type Attributes = Map<string, string>

/** A link the logo may be in: whether it leads home, and whether its own words say logo. */
interface LinkHint {
  home: boolean
  logo: boolean
}

/** A logo found so far, with how sure the reading is of it. */
interface LogoCandidate {
  logo: SiteLogo
  score: number
}

/** The SVG drawing being taken from the markup: where it starts, how deep its nested drawings go, its score. */
interface OpenSvg {
  start: number
  depth: number
  score: number
}

/** The least score a drawing or picture needs to be taken for the logo. */
const LOGO_SCORE = 3
/** How many attributes of one element are read; the rest are left out. */
const MAX_ATTRIBUTES = 64
/** The longest attribute value kept. */
const MAX_VALUE = 4_096
/** How many different classes are counted, and how many style attributes kept. */
const MAX_CLASSES = 5_000
const MAX_STYLE_ATTRIBUTES = 500
/** How many style sheets and icons are kept, in order. */
const MAX_LINKS = 16
/** How deep the links that may hold the logo are followed. */
const MAX_LINK_DEPTH = 8
/** The elements whose content is text, never tags. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'iframe', 'xmp'])
/** A page title that says the site is checking for robots. */
const BOT_WALL_TITLE =
  /just a moment|attention required|access denied|are you a robot|captcha|checking your browser|security check|ddos-guard|pardon our interruption/i
/** Markup of a check for robots, which links no style sheet, unlike a page of the site that loads its script. */
const BOT_WALL_MARKS = ['chl_page', 'cf-chl-', 'captcha-delivery.com', 'px-captcha', '_Incapsula_Resource']
/** Words of a class, id or label that say logo. */
const LOGO_WORDS = /logo|brand/i
/** Words of a class that say button. */
const BUTTON_WORDS = /(^|[^a-z0-9])(btn|button|cta)([^a-z0-9]|$)/i
/** The named entities a title uses. */
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** The page's markup read against `base`, the page's own link after its redirects. */
export function readSitePage(html: string, base: URL): SitePage {
  let at = 0
  let baseUrl = base
  const page: SitePage = {
    title: '',
    blocked: false,
    stylesheets: [],
    styles: [],
    classes: { uses: new Map(), page: new Set(), heading: new Set(), button: new Set() },
    themeColor: null,
    icons: [],
    manifest: null,
    shareImage: null,
    logo: null,
    googleFonts: [],
  }
  const uses = page.classes.uses as Map<string, number>
  const links: LinkHint[] = []
  let header = 0
  let styleAttributes = 0
  let svg: OpenSvg | null = null
  let marked = false
  let best: LogoCandidate | null = null
  const offer = (candidate: LogoCandidate) => {
    if (candidate.score >= LOGO_SCORE && (!best || candidate.score > best.score)) best = candidate
  }

  while (at < html.length) {
    const open = html.indexOf('<', at)
    if (open < 0) break
    if (html.startsWith('<!--', open)) {
      at = endOf(html, '-->', open + 4)
      continue
    }
    if (html[open + 1] === '!' || html[open + 1] === '?') {
      at = endOf(html, '>', open + 2)
      continue
    }
    const closing = html[open + 1] === '/'
    const name = tagName(html, open + (closing ? 2 : 1))
    if (!name) {
      at = open + 1
      continue
    }
    const { attributes, end } = readAttributes(html, open + (closing ? 2 : 1) + name.length)
    at = end
    if (closing) {
      if (name === 'header' || name === 'nav') header = Math.max(0, header - 1)
      else if (name === 'a') links.pop()
      else if (name === 'svg' && svg && --svg.depth === 0) {
        const markup = html.slice(svg.start, at)
        if (drawsSomething(markup)) offer({ logo: { kind: 'svg', markup: withNamespace(markup) }, score: svg.score })
        svg = null
      }
      continue
    }
    const classes = (attributes.get('class') ?? '').split(/\s+/).filter(Boolean)
    for (const c of classes) if (uses.has(c) || uses.size < MAX_CLASSES) uses.set(c, (uses.get(c) ?? 0) + 1)
    noteClasses(page.classes, name, attributes, classes)
    const style = attributes.get('style')
    if (style && styleAttributes < MAX_STYLE_ATTRIBUTES && !/[{}]/.test(style)) {
      styleAttributes++
      page.styles.push(`${name}${classes.map((c) => `.${cssEscape(c)}`).join('')} { ${style} }`)
    }
    const inLink = { home: links.some((link) => link.home), logo: links.some((link) => link.logo) }
    switch (name) {
      case 'header':
      case 'nav':
        header++
        break
      case 'a':
        if (links.length < MAX_LINK_DEPTH)
          links.push({ home: leadsHome(attributes.get('href'), baseUrl), logo: saysLogo(attributes) })
        break
      case 'svg':
        if (html.startsWith('/>', at - 2)) break
        if (svg) svg.depth++
        else if (!tiny(attributes))
          svg = {
            start: open,
            depth: 1,
            score: (inLink.logo ? 3 : 0) + (inLink.home ? 2 : 0) + (saysLogo(attributes) ? 3 : 0) + (header ? 1 : 0),
          }
        break
      case 'img': {
        const url = linkOf(attributes.get('src') ?? attributes.get('data-src'), baseUrl)
        if (!url || svg) break
        const words = `${attributes.get('alt') ?? ''} ${attributes.get('class') ?? ''} ${attributes.get('id') ?? ''} ${fileName(url)}`
        const score = (/logo/i.test(words) ? 3 : 0) + (inLink.logo ? 3 : 0) + (inLink.home ? 2 : 0) + (header ? 1 : 0)
        offer({ logo: { kind: 'image', url }, score })
        break
      }
      case 'link':
        readLink(page, attributes, baseUrl)
        break
      case 'meta':
        readMeta(page, attributes, baseUrl)
        break
      case 'base': {
        const href = linkOf(attributes.get('href'), base)
        if (href && baseUrl === base) baseUrl = new URL(href)
        break
      }
    }
    if (RAW_TEXT.has(name) && !html.startsWith('/>', at - 2)) {
      const close = closeOf(html, name, at)
      const text = html.slice(at, close)
      if (name === 'style' && !svg) page.styles.push(text)
      if (name === 'title' && !svg && !page.title) page.title = decodeEntities(text.slice(0, 300)).trim()
      if (
        name === 'script' &&
        BOT_WALL_MARKS.some((mark) => text.includes(mark) || (attributes.get('src') ?? '').includes(mark))
      )
        marked = true
      at = close
    }
  }
  page.blocked = BOT_WALL_TITLE.test(page.title) || (marked && page.stylesheets.length === 0)
  page.logo = (best as LogoCandidate | null)?.logo ?? null
  return page
}

/** Where `marker` ends, searching from `from`; the markup's end when it never does. */
function endOf(html: string, marker: string, from: number): number {
  const found = html.indexOf(marker, from)
  return found < 0 ? html.length : found + marker.length
}

/** The lower-case tag name at `from`, or '' when no name starts there. */
function tagName(html: string, from: number): string {
  let end = from
  while (end < html.length && end - from < 32 && /[a-zA-Z0-9-]/.test(html[end] ?? '')) end++
  if (end === from || !/[a-zA-Z]/.test(html[from] ?? '')) return ''
  return html.slice(from, end).toLowerCase()
}

/** The attributes of the tag from `from` to its `>`, and where the tag ends. */
function readAttributes(html: string, from: number): { attributes: Attributes; end: number } {
  const attributes: Attributes = new Map()
  let at = from
  while (at < html.length) {
    const char = html[at] ?? ''
    if (char === '>') return { attributes, end: at + 1 }
    if (/[\s/]/.test(char)) {
      at++
      continue
    }
    const nameStart = at
    while (at < html.length && !/[\s=>/]/.test(html[at] ?? '')) at++
    const name = html.slice(nameStart, Math.min(at, nameStart + 64)).toLowerCase()
    while (at < html.length && /\s/.test(html[at] ?? '')) at++
    let value = ''
    if (html[at] === '=') {
      at++
      while (at < html.length && /\s/.test(html[at] ?? '')) at++
      const quote = html[at]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, at + 1)
        const end = close < 0 ? html.length : close
        value = html.slice(at + 1, Math.min(end, at + 1 + MAX_VALUE))
        at = end + 1
      } else {
        const start = at
        while (at < html.length && !/[\s>]/.test(html[at] ?? '')) at++
        value = html.slice(start, Math.min(at, start + MAX_VALUE))
      }
    }
    if (name && !attributes.has(name) && attributes.size < MAX_ATTRIBUTES) attributes.set(name, decodeEntities(value))
  }
  return { attributes, end: html.length }
}

/** Where the element `name`'s closing tag starts, from `from`; the markup's end when it has none. */
function closeOf(html: string, name: string, from: number): number {
  let at = from
  for (;;) {
    const found = html.indexOf('</', at)
    if (found < 0) return html.length
    const after = html[found + 2 + name.length] ?? ''
    if (html.slice(found + 2, found + 2 + name.length).toLowerCase() === name && !/[a-zA-Z0-9-]/.test(after))
      return found
    at = found + 2
  }
}

/** Notes the classes of the page itself, of headings and of buttons. */
function noteClasses(classes: PageClasses, name: string, attributes: Attributes, list: string[]) {
  const into =
    name === 'html' || name === 'body'
      ? classes.page
      : /^h[1-3]$/.test(name)
        ? classes.heading
        : name === 'button' ||
            (name === 'input' && /^(submit|button)$/i.test(attributes.get('type') ?? '')) ||
            list.some((c) => BUTTON_WORDS.test(c))
          ? classes.button
          : null
  if (into) for (const c of list) if (into.size < MAX_CLASSES) (into as Set<string>).add(c)
}

/** Reads a `<link>`: a style sheet, a Google Fonts link, an icon or the web manifest. */
function readLink(page: SitePage, attributes: Attributes, base: URL) {
  const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/)
  const href = attributes.get('href')
  const url = linkOf(href, base)
  if (!url) return
  if (rel.includes('stylesheet') && !rel.includes('alternate')) {
    const fonts = googleFontsOf(url)
    if (fonts.length > 0) page.googleFonts.push(...fonts)
    else if (!/^print$/i.test((attributes.get('media') ?? '').trim()) && page.stylesheets.length < MAX_LINKS)
      page.stylesheets.push(url)
  } else if (
    (rel.includes('icon') || rel.some((r) => r.startsWith('apple-touch-icon'))) &&
    page.icons.length < MAX_LINKS
  ) {
    const sizes = (attributes.get('sizes') ?? '').toLowerCase()
    const size = sizes.includes('any')
      ? Infinity
      : Math.max(0, ...[...sizes.matchAll(/(\d{1,5})x(\d{1,5})/g)].map((m) => Math.max(Number(m[1]), Number(m[2]))))
    const apple = rel.some((r) => r.startsWith('apple-touch-icon'))
    page.icons.push({
      url,
      size: size || (apple ? 180 : 0),
      type: attributes.get('type')?.toLowerCase() ?? null,
      rel: apple ? 'apple-touch-icon' : 'icon',
    })
  } else if (rel.includes('manifest') && !page.manifest) page.manifest = url
}

/** Reads a `<meta>`: the theme colour for light pages, and the share picture. */
function readMeta(page: SitePage, attributes: Attributes, base: URL) {
  const name = (attributes.get('name') ?? attributes.get('property') ?? '').toLowerCase()
  const content = attributes.get('content') ?? ''
  if (name === 'theme-color' && !page.themeColor && !/dark/i.test(attributes.get('media') ?? ''))
    page.themeColor = content.trim().slice(0, 100)
  if ((name === 'og:image' || name === 'og:image:secure_url') && !page.shareImage)
    page.shareImage = linkOf(content, base)
}

/** `href` read against `base` as an https link of at most 2,048 characters, or null. */
function linkOf(href: string | undefined, base: URL): string | null {
  const text = href?.trim()
  if (!text) return null
  const url = URL.parse(text, base.href)
  if (!url || url.protocol !== 'https:' || url.href.length > 2048) return null
  url.hash = ''
  return url.href
}

/** Whether a link leads to the site's home page. */
function leadsHome(href: string | undefined, base: URL): boolean {
  const url = href === undefined ? null : URL.parse(href.trim(), base.href)
  return Boolean(url && url.host === base.host && /^\/(index\.html?)?$/.test(url.pathname))
}

/** Whether an element's class, id, label or title says logo. */
function saysLogo(attributes: Attributes): boolean {
  return ['class', 'id', 'aria-label', 'title'].some((name) => LOGO_WORDS.test(attributes.get(name) ?? ''))
}

/** Whether a drawing's own size says it is an icon, at most 24 pixels a side. */
function tiny(attributes: Attributes): boolean {
  const width = Number.parseFloat(attributes.get('width') ?? '')
  const height = Number.parseFloat(attributes.get('height') ?? '')
  return width > 0 && height > 0 && width <= 24 && height <= 24
}

/** Whether an SVG drawing draws a shape or words of its own, rather than only pointing at another drawing. */
function drawsSomething(markup: string): boolean {
  return /<(path|rect|circle|ellipse|polygon|polyline|line|text|image)[\s/>]/i.test(markup)
}

/** An SVG drawing taken from a page, given the SVG namespace a page leaves out and a file needs. */
function withNamespace(markup: string): string {
  const tag = markup.slice(0, markup.indexOf('>') + 1)
  return /\sxmlns\s*=/.test(tag) ? markup : `<svg xmlns="http://www.w3.org/2000/svg"${markup.slice(4)}`
}

/** The last part of a link's path. */
function fileName(link: string): string {
  return new URL(link).pathname.split('/').pop() ?? ''
}

/** A class name as a CSS selector writes it. */
function cssEscape(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
}

/** Text with its character references read: the common names, and numbers. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[ref.toLowerCase()] ?? whole
  })
}
