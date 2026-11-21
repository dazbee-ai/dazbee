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
import type { Pattern, PatternInput, PatternLayers } from './types.ts'

/** A pattern, and what builds it in a frame. */
interface Built {
  pattern: Pattern
  build: (b: Build) => void
}

/** Every pattern, in the order `list_patterns` gives them. */
const BUILT: readonly Built[] = [
  { pattern: PHOTO_BAND, build: photoBand },
  { pattern: SPLIT, build: split },
  { pattern: PRODUCT_BADGE, build: productBadge },
  { pattern: BIG_NUMBER, build: bigNumber },
  { pattern: QUOTE, build: quote },
  { pattern: WORDS_ONLY, build: wordsOnly },
]

/** Every pattern, as `list_patterns` tells them. */
export const PATTERNS: readonly Pattern[] = BUILT.map(({ pattern }) => pattern)

/** The pattern of an id; undefined for none. */
export function findPattern(id: string): Pattern | undefined {
  return PATTERNS.find((pattern) => pattern.id === id)
}

/**
 * A pattern's layers for one frame, arranged for its size: its id and link ids each the part it is. Throws for a
 * pattern there is none of, or content it can't be built without.
 */
export function buildPattern(id: string, input: PatternInput): PatternLayers {
  const built = BUILT.find(({ pattern }) => pattern.id === id)
  if (!built) throw new Error(`no pattern "${id}"`)
  const missing = built.pattern.needs.filter((part) => input.content[part] === undefined || input.content[part] === '')
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
  }
  backdrop(b, palette.background)
  built.build(b)
  return tree.tree()
}
