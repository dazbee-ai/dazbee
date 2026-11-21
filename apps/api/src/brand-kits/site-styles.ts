// A website's CSS read for its brand: the colours it uses, weighted by where (buttons, headings, links, the page's
// bands) and by how many of the page's elements a rule styles; the page's own background and text colours; the
// font stacks of its headings and its text; its `@font-face` families with their weights; and the Google Fonts it
// imports. One pass over the text with a bounded stack, values and variables capped, so CSS of any shape takes time
// in step with its length.
import { type GoogleFontFamily, googleFontsOf } from './google-font-links.ts'
import { colorsIn, type Hex, type SiteColors } from './site-colors.ts'
import type { PageClasses } from './site-page.ts'

/** A font role's stack: the families a rule names, in order. */
export interface SiteFonts {
  heading: string[]
  body: string[]
}

/** What the site's CSS says of its brand. */
export interface SiteStyles {
  colors: SiteColors
  fonts: SiteFonts
  /** The weights each `@font-face` family draws, by its lower-case name. */
  faces: ReadonlyMap<string, number[]>
  googleFonts: GoogleFontFamily[]
}

/** What a rule's selector styles. */
type Target = 'page' | 'heading' | 'button' | 'link' | 'band' | 'paragraph' | 'other'

/** A declaration kept to read once every variable is known: what its rule styles, how much it counts, its value. */
interface Declaration {
  target: Target
  /** For the page and headings, which of several rules wins: the body over html, h1 over h2. */
  rank: number
  weight: number
  property: string
  value: string
}

/** A block the reading is inside: a rule, an at-rule, or a `@font-face`, and whether its declarations count. */
interface Block {
  kind: 'rule' | 'at' | 'font-face'
  selectors: { target: Target; rank: number; weight: number }[]
  skipped: boolean
  face: { family: string; weights: number[] } | null
}

/** How deep blocks are followed; deeper ones are read past. */
const MAX_DEPTH = 32
/** How many declarations and variables are kept, and the longest value of each. */
const MAX_DECLARATIONS = 50_000
const MAX_VARIABLES = 5_000
const MAX_VALUE = 1_000
/** How many times variables are read inside variables. */
const MAX_VARIABLE_DEPTH = 4
/** How much a colour counts for each property, by what its rule styles. */
const COLOR_WEIGHTS: Record<'background' | 'color' | 'border', Partial<Record<Target, number>>> = {
  background: { button: 6, band: 2, heading: 2, link: 1, other: 1, paragraph: 1, page: 1 },
  color: { heading: 3, link: 3, button: 1, other: 1, paragraph: 1, page: 1 },
  border: { button: 1, other: 0.5 },
}
/** The properties whose colours count, each under the weights it takes. */
const COLOR_PROPERTIES: Readonly<Record<string, keyof typeof COLOR_WEIGHTS>> = {
  background: 'background',
  'background-color': 'background',
  'background-image': 'background',
  color: 'color',
  border: 'border',
  'border-color': 'border',
  'border-top': 'border',
  'border-bottom': 'border',
  outline: 'border',
  fill: 'border',
}
/** At-rules whose rules a light page never shows: dark schemes, print, and animations' frames. */
const UNSHOWN_AT_RULE =
  /prefers-color-scheme\s*:\s*dark|^@media\s+print|^@(-[a-z]+-)?keyframes|^@font-feature-values|^@page/i
/** A selector for a dark scheme, as frameworks write them. */
const DARK_SELECTOR = /(^|[^a-z])dark([^a-z]|$)/i
/** A state a page is seldom seen in. */
const STATE = /:(hover|focus|focus-visible|focus-within|active|visited|disabled)/i
/** The words a property takes that name no family. */
const KEYWORDS = /^(inherit|initial|unset|revert|revert-layer)$/i
/** Font sizes a `font` shorthand may give before its families. */
const FONT_SIZE =
  /^([\d.]+(px|em|rem|%|pt|vw|vh|ex|ch|q|cm|mm|in|pc)(\/\S+)?|(xx?-|x?x?)?(small|large|medium)|smaller|larger)$/i

/** The CSS of the page's style sheets and style blocks, read with how the page's elements use classes. */
export function readSiteStyles(sheets: readonly string[], classes: PageClasses): SiteStyles {
  const declarations: Declaration[] = []
  const variables = new Map<string, string>()
  const faces = new Map<string, number[]>()
  const googleFonts: GoogleFontFamily[] = []
  for (const sheet of sheets)
    readSheet(withoutComments(sheet), classes, { declarations, variables, faces, googleFonts })

  const used = new Map<Hex, number>()
  const page: Record<'background' | 'text', { color: Hex; rank: number } | null> = { background: null, text: null }
  const fonts: Record<'heading' | 'body' | 'paragraph', { stack: string[]; rank: number } | null> = {
    heading: null,
    body: null,
    paragraph: null,
  }
  const resolved = variableReader(variables)
  for (const declaration of declarations) {
    const value = resolved(declaration.value)
    const { target, rank, weight, property } = declaration
    const kind = COLOR_PROPERTIES[property]
    if (kind) {
      const colors = colorsIn(value)
      const counts = (COLOR_WEIGHTS[kind][target] ?? 0) * weight
      for (const color of colors) if (counts > 0) used.set(color, (used.get(color) ?? 0) + counts)
      const first = colors[0]
      const side = kind === 'background' ? 'background' : kind === 'color' ? 'text' : null
      if (first && side && target === 'page' && rank >= (page[side]?.rank ?? 0)) page[side] = { color: first, rank }
    }
    if (property === 'font-family' || property === 'font') {
      const stack = property === 'font' ? stackOfShorthand(value) : stackOf(value)
      const role =
        target === 'page' ? 'body' : target === 'heading' ? 'heading' : target === 'paragraph' ? 'paragraph' : null
      if (role && stack.length > 0 && rank >= (fonts[role]?.rank ?? 0)) fonts[role] = { stack, rank }
    }
  }
  const body = fonts.body?.stack ?? fonts.paragraph?.stack ?? []
  return {
    colors: {
      used,
      background: page.background?.color ?? null,
      text: page.text?.color ?? null,
      read: sheets.length > 0,
    },
    fonts: { heading: fonts.heading?.stack ?? body, body },
    faces,
    googleFonts,
  }
}

/** The families a `font-family` value names, unquoted, at most ten. */
export function stackOf(value: string): string[] {
  return splitOutside(value, ',')
    .map((family) =>
      family
        .trim()
        .replace(/^(["'])(.*)\1$/, '$2')
        .trim(),
    )
    .filter((family) => family.length > 0 && family.length <= 100 && !family.includes('(') && !KEYWORDS.test(family))
    .slice(0, 10)
}

/** What the reading collects across the sheets. */
interface Collected {
  declarations: Declaration[]
  variables: Map<string, string>
  faces: Map<string, number[]>
  googleFonts: GoogleFontFamily[]
}

/** Reads one sheet, its comments taken out, into what is collected. */
function readSheet(css: string, classes: PageClasses, into: Collected) {
  const stack: Block[] = []
  let deeper = 0
  let start = 0
  const segment = (end: number) => css.slice(start, end).trim()
  for (let at = 0; at < css.length; at++) {
    const char = css[at]
    if (char === '"' || char === "'") {
      at = quoteEnd(css, at)
      continue
    }
    if (char === '(' && /url$/i.test(css.slice(Math.max(0, at - 3), at))) {
      const close = css.indexOf(')', at)
      at = close < 0 ? css.length : close
      continue
    }
    if (char !== '{' && char !== '}' && char !== ';') continue
    const text = segment(at)
    start = at + 1
    if (char === '{') {
      if (deeper > 0 || stack.length >= MAX_DEPTH) deeper++
      else stack.push(blockOf(text, stack, classes))
    } else if (char === '}') {
      if (deeper > 0) {
        deeper--
        continue
      }
      declare(text, stack.at(-1), into)
      const closed = stack.pop()
      if (closed?.face && closed.face.family) {
        const key = closed.face.family.toLowerCase()
        into.faces.set(
          key,
          [...new Set([...(into.faces.get(key) ?? []), ...closed.face.weights])].sort((a, b) => a - b),
        )
      }
    } else if (deeper === 0) {
      if (stack.length === 0 && /^@import/i.test(text)) importOf(text, into)
      else declare(text, stack.at(-1), into)
    }
  }
}

/** The block a prelude opens, inside the blocks open now. */
function blockOf(prelude: string, stack: readonly Block[], classes: PageClasses): Block {
  const parent = stack.at(-1)
  const skipped = Boolean(parent?.skipped)
  if (prelude.startsWith('@')) {
    if (/^@font-face/i.test(prelude))
      return { kind: 'font-face', selectors: [], skipped, face: { family: '', weights: [] } }
    return { kind: 'at', selectors: [], skipped: skipped || UNSHOWN_AT_RULE.test(prelude), face: null }
  }
  return {
    kind: 'rule',
    selectors: splitOutside(prelude.slice(0, MAX_VALUE), ',').flatMap((selector) => targetOf(selector, classes)),
    skipped,
    face: null,
  }
}

/** Keeps a declaration of the block it is in: a variable, a `@font-face` descriptor, or a property of a rule. */
function declare(text: string, block: Block | undefined, into: Collected) {
  const colon = text.indexOf(':')
  if (!block || block.skipped || colon < 1) return
  const property = text.slice(0, colon).trim().toLowerCase()
  const value = text
    .slice(colon + 1, colon + 1 + MAX_VALUE)
    .replace(/!important\s*$/i, '')
    .trim()
  if (block.face) {
    if (property === 'font-family') block.face.family = stackOf(value)[0] ?? ''
    if (property === 'font-weight') block.face.weights = faceWeights(value)
    return
  }
  if (block.kind !== 'rule') return
  if (property.startsWith('--')) {
    if (into.variables.has(property) || into.variables.size < MAX_VARIABLES) into.variables.set(property, value)
    return
  }
  if (!COLOR_PROPERTIES[property] && property !== 'font-family' && property !== 'font') return
  for (const { target, rank, weight } of block.selectors)
    if (into.declarations.length < MAX_DECLARATIONS) into.declarations.push({ target, rank, weight, property, value })
}

/** Notes the Google Fonts an `@import` loads. */
function importOf(text: string, into: Collected) {
  const link = /url\(\s*["']?([^"')\s]+)|["']([^"']+)["']/i.exec(text)
  const url = link?.[1] ?? link?.[2]
  if (url) into.googleFonts.push(...googleFontsOf(url))
}

/**
 * What one selector styles, and how much its declarations count: its subject (the last part, after the last
 * combinator) names the page, a heading, a button, a link, a band of the page, a paragraph or something else. A rule
 * of classes no element of the page carries counts a quarter, and one the page's elements use counts more the more
 * they use it; a state such as hover counts half. A selector for a dark scheme counts nothing.
 */
function targetOf(selector: string, classes: PageClasses): { target: Target; rank: number; weight: number }[] {
  if (DARK_SELECTOR.test(selector)) return []
  const subject = splitOutside(selector.trim(), ' >+~').at(-1) ?? ''
  const tag = /^[a-z][a-z0-9-]*/i.exec(subject)?.[0].toLowerCase() ?? ''
  const names = [...subject.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => (m[1] ?? '').replace(/\\(.)/g, '$1'))
  const counts = names.map((name) => classes.uses.get(name) ?? 0)
  const usage = names.length === 0 ? 1 : Math.max(...counts) === 0 ? 0.25 : 1 + Math.log2(1 + Math.max(...counts))
  const weight = usage * (STATE.test(subject) ? 0.5 : 1)
  const heading = /^h([1-6])$/.exec(tag)
  if (tag === 'body' || names.some((name) => classes.page.has(name))) return [{ target: 'page', rank: 2, weight }]
  if (tag === 'html' || /^:root/i.test(subject)) return [{ target: 'page', rank: 1, weight }]
  if (heading) return [{ target: 'heading', rank: 7 - Number(heading[1]), weight }]
  if (names.some((name) => classes.heading.has(name))) return [{ target: 'heading', rank: 4, weight }]
  if (
    tag === 'button' ||
    names.some((name) => classes.button.has(name)) ||
    /(^|[^a-z0-9])(btn|button|cta)([^a-z0-9]|$)/i.test(subject)
  )
    return [{ target: 'button', rank: 0, weight }]
  if (tag === 'a') return [{ target: 'link', rank: 0, weight }]
  if (tag === 'p') return [{ target: 'paragraph', rank: 0, weight }]
  if (/^(header|nav|footer)$/.test(tag) || /header|hero|banner|navbar|footer/i.test(names.join(' ')))
    return [{ target: 'band', rank: 0, weight }]
  return [{ target: 'other', rank: 0, weight }]
}

/**
 * What reads values with their `var()`s replaced by the variables' values, or their fallbacks: each variable read
 * once, inside others at most `MAX_VARIABLE_DEPTH` deep, a cycle read as nothing, and every value cut at
 * `MAX_VALUE`, so no CSS makes a value grow past it.
 */
function variableReader(variables: ReadonlyMap<string, string>): (value: string) => string {
  const read = new Map<string, string>()
  return (value) => resolve(value, 0)

  function resolve(value: string, depth: number): string {
    if (!value.includes('var(')) return value
    const pattern = /var\(\s*(--[\w-]{1,100})\s*(?:,([^()]{0,200}))?\)/g
    let out = ''
    let last = 0
    for (let match = pattern.exec(value); match && out.length < MAX_VALUE; match = pattern.exec(value)) {
      const [whole, name = '', fallback] = match
      out += value.slice(last, match.index) + (depth >= MAX_VARIABLE_DEPTH ? '' : variableOf(name, fallback, depth))
      last = match.index + whole.length
    }
    return (out.length < MAX_VALUE ? out + value.slice(last) : out).slice(0, MAX_VALUE)
  }

  function variableOf(name: string, fallback: string | undefined, depth: number): string {
    const value = variables.get(name)
    if (value === undefined) return resolve(fallback?.trim() ?? '', depth + 1)
    let done = read.get(name)
    if (done === undefined) {
      read.set(name, '')
      done = resolve(value, depth + 1)
      read.set(name, done)
    }
    return done
  }
}

/** The families a `font` shorthand names: what follows its size. */
function stackOfShorthand(value: string): string[] {
  const words = splitOutside(value, ' ')
  const size = words.findIndex((word) => FONT_SIZE.test(word))
  return size < 0 ? [] : stackOf(words.slice(size + 1).join(' '))
}

/** The weights a `@font-face` draws: one, or a range's ends; `normal` is 400 and `bold` 700. */
function faceWeights(value: string): number[] {
  return value
    .split(/\s+/)
    .map((word) => (word === 'normal' ? 400 : word === 'bold' ? 700 : Number.parseInt(word, 10)))
    .filter((weight) => weight >= 1 && weight <= 1000)
}

/** `text` split at any of `separators`, never inside quotes, brackets or parentheses, the empty parts left out. */
function splitOutside(text: string, separators: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? ''
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && separators.includes(char)) {
      parts.push(text.slice(start, at))
      start = at + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** Where the string opened by the quote at `from` ends, an escaped quote passed over. */
function quoteEnd(css: string, from: number): number {
  const quote = css[from] ?? '"'
  let at = from + 1
  for (;;) {
    const close = css.indexOf(quote, at)
    if (close < 0) return css.length
    let slashes = 0
    while (css[close - 1 - slashes] === '\\') slashes++
    if (slashes % 2 === 0) return close
    at = close + 1
  }
}

/** CSS with its comments taken out. */
function withoutComments(css: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const open = css.indexOf('/*', at)
    if (open < 0) return out + css.slice(at)
    out += css.slice(at, open)
    const close = css.indexOf('*/', open + 2)
    if (close < 0) return out
    at = close + 2
  }
}
