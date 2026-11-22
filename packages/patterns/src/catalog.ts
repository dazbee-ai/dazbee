// The patterns, and building one: a pure function of the pattern, its style, the brand kit, the content and a size,
// giving the frame's layers.
import { type LayerTree, shownScale, TextProps } from '@dazbee/schema'

import { backdrop, type Build, footTint, type LogoCap } from './build.ts'
import { frameRoom, SHORT_FRAME } from './frame-shape.ts'
import { LARGE_TEXT_CONTRAST, paletteOf, TEXT_CONTRAST } from './palette.ts'
import { BIG_NUMBER, bigNumber } from './patterns/big-number.ts'
import { PHOTO_BAND, photoBand } from './patterns/photo-band.ts'
import { PRODUCT_BADGE, productBadge } from './patterns/product-badge.ts'
import { QUOTE, quote } from './patterns/quote.ts'
import { SPLIT, split } from './patterns/split.ts'
import { WORDS_ONLY, wordsOnly } from './patterns/words-only.ts'
import { STYLES } from './styles.ts'
import { LARGE_TEXT_PX } from './text-look.ts'
import { treeBuilder } from './tree.ts'
import type { ContentPart, Measure, Pattern, PatternInput, PatternLayers } from './types.ts'
import { CAP_HEIGHT } from './words.ts'

/** A pattern, and what builds it in a frame. */
interface Built {
  pattern: Pattern
  build: (b: Build) => void
}

/** Every pattern, and what builds it, in the order they are listed. */
const BUILT: readonly Built[] = [
  { pattern: PHOTO_BAND, build: photoBand },
  { pattern: SPLIT, build: split },
  { pattern: PRODUCT_BADGE, build: productBadge },
  { pattern: BIG_NUMBER, build: bigNumber },
  { pattern: QUOTE, build: quote },
  { pattern: WORDS_ONLY, build: wordsOnly },
]

/** Every pattern, as an agent is told of them. */
export const PATTERNS: readonly Pattern[] = BUILT.map(({ pattern }) => pattern)

/** The pattern of an id; undefined for none. */
export function findPattern(id: string): Pattern | undefined {
  return PATTERNS.find((pattern) => pattern.id === id)
}

/** The content a pattern needs and isn't given. */
export function missingContent(pattern: Pattern, content: Partial<Record<ContentPart, unknown>>): ContentPart[] {
  return pattern.needs.filter((part) => content[part] === undefined || content[part] === '')
}

/**
 * The content given that a pattern doesn't use: the parts it neither needs nor takes, and words to set apart that
 * the headline doesn't hold.
 */
export function unusedContent(pattern: Pattern, content: Partial<Record<ContentPart, unknown>>): ContentPart[] {
  const used = new Set<ContentPart>([...pattern.needs, ...pattern.takes])
  const given = (Object.keys(content) as ContentPart[]).filter((part) => content[part] !== undefined)
  const unused = given.filter((part) => !used.has(part))
  const { headline, highlight } = content
  if (
    used.has('highlight') &&
    typeof highlight === 'string' &&
    typeof headline === 'string' &&
    !headline.toLowerCase().includes(highlight.toLowerCase())
  )
    unused.push('highlight')
  return unused
}

/** The most of the lead's cap height a logo is drawn, label and all; and its ink on a display size. */
const LOGO_OVER_CAP = 1.6
const LOGO_INK_OVER_CAP_DISPLAY = 1.2
/** The most of the lead's inked area a logo covers, label and all. */
const LOGO_AREA_MOST = 0.5
/** A logo label's room round the logo, both sides together, as a share of the logo's height. */
const LABEL_ROUND = 0.7
/** The most times a frame is built again to bring its logo under its lead. */
const LOGO_PASSES = 3

/**
 * A pattern's layers for one frame, arranged for its size: its id and link ids each the part it is. Throws for a
 * pattern there is none of, or content it can't be built without.
 */
export function buildPattern(id: string, input: PatternInput): PatternLayers {
  const [layers] = buildPatterns(id, input, [input])
  if (!layers) throw new Error(`the pattern "${id}" built nothing`)
  return layers
}

/**
 * A pattern's layers for each of a set of sizes built together, as one campaign: the headline's highlight is set
 * apart alike at every size, in a colour that reads where the set's smallest headline is set, and each frame's logo
 * is brought under its lead, so it signs the ad and never outranks its message. Throws as buildPattern does.
 */
export function buildPatterns(
  id: string,
  input: Omit<PatternInput, 'width' | 'height'>,
  sizes: readonly { width: number; height: number }[],
): PatternLayers[] {
  const built = BUILT.find(({ pattern }) => pattern.id === id)
  if (!built) throw new Error(`no pattern "${id}"`)
  const missing = missingContent(built.pattern, input.content)
  if (missing.length > 0) throw new Error(`the pattern "${id}" needs ${missing.join(', ')}`)
  const once = (size: { width: number; height: number }, more: Pick<Build, 'highlightContrast' | 'logoCap'>) =>
    buildOnce(built, id, { ...input, ...size }, more)
  // The highlight's colour reads as large text does only where every size sets its headline as large text.
  const first = sizes.map((size) => once(size, {}))
  const large = first.every((layers, i) => headlineLarge(layers, sizes[i] ?? { width: 0, height: 0 }))
  const highlightContrast = large ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST
  return sizes.map((size) => {
    let cap: LogoCap | undefined
    let layers = once(size, { highlightContrast })
    for (let pass = 0; pass < LOGO_PASSES; pass++) {
      const next = logoCapOf(layers, size, input.measure, cap)
      if (!next) break
      cap = next
      layers = once(size, { highlightContrast, logoCap: cap })
    }
    return layers
  })
}

/** A pattern's layers for one frame, built once with the set's highlight contrast and the logo's cap. */
function buildOnce(
  built: Built,
  id: string,
  input: PatternInput,
  more: Pick<Build, 'highlightContrast' | 'logoCap'>,
): PatternLayers {
  const style = STYLES[input.style]
  const palette = paletteOf(input.kit, style)
  const tree = treeBuilder()
  const b: Build = {
    tree,
    style,
    styleName: input.style,
    pattern: id,
    palette,
    frame: frameRoom(input.width, input.height, style.margin),
    measure: input.measure,
    content: input.content,
    kitLogo: input.kit.logoAssetId,
    ...more,
  }
  backdrop(b, palette.background)
  built.build(b)
  footTint(b)
  return tree.tree()
}

/** Whether a frame's headline is large text as shown, or it has none. */
function headlineLarge({ nodes }: LayerTree, { width, height }: { width: number; height: number }): boolean {
  const headline = nodes.headline
  if (headline?.type !== 'text') return true
  return headline.props.style.fontSize / shownScale(width, height) >= LARGE_TEXT_PX
}

/**
 * The cap a frame's logo is brought under where it outranks its lead (the number where there is one, else the
 * headline), tighter than `before`: its drawn height, label and all, at most LOGO_OVER_CAP times the lead's cap
 * height (a short frame's lead's line height), its ink on a display size LOGO_INK_OVER_CAP_DISPLAY times it, and its
 * drawn area LOGO_AREA_MOST of the lead's inked area. None where the logo is under it already, or no tighter cap is
 * left to try.
 */
function logoCapOf(
  { nodes }: LayerTree,
  { width, height }: { width: number; height: number },
  measure: Measure,
  before: LogoCap | undefined,
): LogoCap | undefined {
  const lead = nodes.number ?? nodes.headline
  const mark = nodes.logo
  if (lead?.type !== 'text' || !mark) return undefined
  const props = TextProps.parse(lead.props)
  const size = props.style.fontSize
  const lineHeight = size * (props.style.lineHeight ?? 1.2)
  const lines = Math.max(1, Math.round(props.height / lineHeight))
  const line = Math.min(props.width, measure(props, null).width / lines)
  const capHeight = size * CAP_HEIGHT
  const area = line * ((lines - 1) * lineHeight + capHeight)
  const short = height <= SHORT_FRAME
  const display = width < 1000 && height < 1000
  const most = {
    height: short ? lineHeight : capHeight * LOGO_OVER_CAP,
    ink: display ? capHeight * LOGO_INK_OVER_CAP_DISPLAY : Number.POSITIVE_INFINITY,
    area: area * LOGO_AREA_MOST,
  }
  // The logo as drawn: its ink, and its label's room round it where it has one.
  const ink = mark.props
  const round = nodes['logo-label'] ? ink.height * LABEL_ROUND : 0
  const drawn = { width: ink.width + round, height: ink.height + round }
  const over =
    drawn.height > most.height + 1 || ink.height > most.ink + 1 || drawn.width * drawn.height > most.area * 1.02
  if (!over) return undefined
  const cap = {
    height: Math.min(before?.height ?? Number.POSITIVE_INFINITY, most.height),
    ink: Math.min(before?.ink ?? Number.POSITIVE_INFINITY, most.ink, most.height),
    area: Math.min(before?.area ?? Number.POSITIVE_INFINITY, most.area),
  }
  if (before && cap.height >= before.height && cap.ink >= before.ink && cap.area >= before.area) return undefined
  return cap
}
