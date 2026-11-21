// The patterns, and building one: a pure function of the pattern, its style, the brand kit, the content and a size,
// giving the frame's layers.
import { backdrop, type Build } from './build.ts'
import { frameRoom } from './frame-shape.ts'
import { paletteOf } from './palette.ts'
import { BIG_NUMBER, bigNumber } from './patterns/big-number.ts'
import { PHOTO_BAND, photoBand } from './patterns/photo-band.ts'
import { PRODUCT_BADGE, productBadge } from './patterns/product-badge.ts'
import { QUOTE, quote } from './patterns/quote.ts'
import { SPLIT, split } from './patterns/split.ts'
import { WORDS_ONLY, wordsOnly } from './patterns/words-only.ts'
import { STYLES } from './styles.ts'
import { treeBuilder } from './tree.ts'
import type { ContentPart, Pattern, PatternInput, PatternLayers } from './types.ts'

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

/**
 * A pattern's layers for one frame, arranged for its size: its id and link ids each the part it is. Throws for a
 * pattern there is none of, or content it can't be built without.
 */
export function buildPattern(id: string, input: PatternInput): PatternLayers {
  const built = BUILT.find(({ pattern }) => pattern.id === id)
  if (!built) throw new Error(`no pattern "${id}"`)
  const missing = missingContent(built.pattern, input.content)
  if (missing.length > 0) throw new Error(`the pattern "${id}" needs ${missing.join(', ')}`)
  const style = STYLES[input.style]
  const palette = paletteOf(input.kit, style)
  const tree = treeBuilder()
  const b: Build = {
    tree,
    style,
    styleName: input.style,
    palette,
    frame: frameRoom(input.width, input.height, style.margin),
    measure: input.measure,
    content: input.content,
    kitLogo: input.kit.logoAssetId,
  }
  backdrop(b, palette.background)
  built.build(b)
  return tree.tree()
}
