// Which of a family's faces a text can be drawn in. CanvasKit picks a family's face for a weight and
// style with Skia's CSS3 matching (`SkFontStyleSet::matchStyleCSS3` in src/core/SkFontMgr.cpp, at
// the Skia commit packages/canvaskit/build/skia-commit names), scored here the same way. Loading
// every face that could win for each weight and style asked of a family draws exactly what loading
// all of its faces draws, so the largest families load one or two files, not all of them.
import type { FileStyle } from './file-style.ts'
import whole from './whole-families.json' with { type: 'json' }

/** Upright or italic: a face's style, and the style a text asks for. */
export type FontStyle = 'normal' | 'italic'

/** A family in one weight and style that text is drawn in. */
export interface FontUse {
  family: string
  weight: number
  style: FontStyle
}

/**
 * A face of the font catalog as it is recorded: its weight, or a variable face's range of weights, its
 * style, and where its file came from.
 */
export interface CatalogFace {
  family: string
  weight: number
  weights?: { min: number; max: number } | undefined
  style: FontStyle
  /**
   * Where the file came from: `google` for a face recorded at the weight Google names it by, which
   * its file may not say; any other, such as an upload, for one recorded from its own file.
   */
  source?: string | undefined
}

/**
 * The Google families whose files CanvasKit reads in a way `facesToLoad` doesn't foresee, such as
 * faces of two widths in one family, as `pnpm --filter @dazbee/fonts whole-families` finds them
 * in the files of google/fonts at the commit the list was written from: every face of one is loaded.
 */
export const WHOLE_FAMILIES: ReadonlySet<string> = new Set(whole.families)

/** Skia's slants, by their numbers in `SkFontStyle::Slant`. */
const UPRIGHT = 0
const ITALIC = 1
const OBLIQUE = 2

/** Skia's score for a face's slant (column) against the slant asked for (row). */
const SLANT_SCORE = [
  [3, 1, 2],
  [1, 3, 2],
  [1, 2, 3],
] as const

/**
 * The weights CanvasKit may read a Google static face at, beyond the one recorded, by that weight:
 * Google records a Thin at 100 and an ExtraLight at 200, and its checks allow their files to say
 * 250 and 275 in `usWeightClass`, which CanvasKit reads (and one of google/fonts says 250 for an
 * ExtraLight).
 */
const GOOGLE_FILE_WEIGHTS: Readonly<Record<number, readonly number[]>> = { 100: [250], 200: [250, 275] }

/**
 * The faces of one family that CanvasKit could draw text in for any of the weights and styles
 * asked of it, each once, in the order given. A face counts at every weight its file may say
 * (`readWeights`); a family's Google variable faces share one default weight, anywhere in their
 * range. A family's uploaded italics are all marked italic or all oblique in their files, and its
 * Google italics italic, as every file of google/fonts is. Width is not recorded: a family's faces
 * are taken to share one. Every face of a Google family in `WHOLE_FAMILIES` is loaded.
 */
export function facesToLoad<F extends CatalogFace>(
  faces: readonly F[],
  asked: readonly Pick<FontUse, 'weight' | 'style'>[],
): F[] {
  if (faces.length === 0 || asked.length === 0) return []
  if (faces.every((face) => face.source === 'google' && WHOLE_FAMILIES.has(face.family))) return [...faces]
  const shared = sharedDefaults(faces)
  const italics = faces.some((face) => face.style === 'italic' && face.source !== 'google')
    ? [ITALIC, OBLIQUE]
    : [ITALIC]
  const picked = new Set<number>()
  for (const { weight, style } of asked) {
    const pattern = { weight, slant: style === 'italic' ? ITALIC : UPRIGHT }
    for (const at of shared)
      for (const italic of italics) {
        const ranges = faces.map((face) => scoreRange(pattern, face, at, face.style === 'italic' ? italic : UPRIGHT))
        ranges.forEach((range, i) => {
          if (ranges.every((other, j) => j === i || range.max >= other.min)) picked.add(i)
        })
      }
  }
  return faces.filter((_, i) => picked.has(i))
}

/**
 * Whether CanvasKit, reading a family's files at `styles` (one for each of `faces`), draws some
 * whole weight from 100 to 900, upright or italic, in a face `facesToLoad` leaves out: such a
 * family is one of `WHOLE_FAMILIES`. Checked without them.
 */
export function missesDrawnFace(faces: readonly CatalogFace[], styles: readonly FileStyle[]): boolean {
  const asOwn = faces.map((face) => ({ ...face, family: '' }))
  for (const style of ['normal', 'italic'] as const)
    for (let weight = 100; weight <= 900; weight++) {
      const loaded = facesToLoad(asOwn, [{ weight, style }])
      const drawn = asOwn[drawnFace(styles, weight, style)]
      if (drawn && !loaded.includes(drawn)) return true
    }
  return false
}

/**
 * Each default weight the family's Google variable faces may share, every whole weight their
 * ranges have in common; one undefined where it has none.
 */
function sharedDefaults(faces: readonly CatalogFace[]): (number | undefined)[] {
  const ranges = faces.flatMap((face) => (face.weights && face.source === 'google' ? [face.weights] : []))
  if (ranges.length === 0) return [undefined]
  const min = Math.max(...ranges.map((range) => range.min))
  const max = Math.min(...ranges.map((range) => range.max))
  if (min > max) return [undefined]
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

/** The least and most Skia may score a face read at `slant` for `pattern`, over the weights its file may say. */
function scoreRange(
  pattern: { weight: number; slant: number },
  face: CatalogFace,
  shared: number | undefined,
  slant: number,
) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const weight of readWeights(face, shared)) {
    const score = skiaScore(pattern, { weight, slant })
    min = Math.min(min, score)
    max = Math.max(max, score)
  }
  return { min, max }
}

/**
 * The weights CanvasKit may read a face's file at: an upload's own, a variable face's file default
 * (`shared`, or anywhere in its range without it), or a Google static face's recorded weight and
 * the others its file may say.
 */
function readWeights(face: CatalogFace, shared?: number): number[] {
  if (face.weights) {
    if (face.source !== 'google') return [face.weight]
    const { min, max } = face.weights
    if (shared !== undefined) return [Math.min(max, Math.max(min, shared))]
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  }
  if (face.source !== 'google') return [face.weight]
  return [face.weight, ...(GOOGLE_FILE_WEIGHTS[face.weight] ?? [])]
}

/** `matchStyleCSS3`'s score of a face for a pattern of normal width, less the width's part. */
function skiaScore(pattern: { weight: number; slant: number }, current: { weight: number; slant: number }) {
  const slant = (SLANT_SCORE[pattern.slant]?.[current.slant] ?? 0) << 8
  const p = pattern.weight
  const c = current.weight
  if (p === c) return slant + 1000
  if (p < 400) return slant + (c <= p ? 1000 - p + c : 1000 - c)
  if (p <= 500) {
    if (c >= p && c <= 500) return slant + 1000 + p - c
    return slant + (c <= p ? 500 + c : 1000 - c)
  }
  return slant + (c > p ? 1000 + p - c : c)
}

/**
 * The face CanvasKit draws text of `weight` and `style` in, among faces it reads at `styles`, by its
 * index: the one `matchStyleCSS3` scores highest for a pattern of normal width, the first of a tie.
 */
function drawnFace(styles: readonly FileStyle[], weight: number, style: FontStyle): number {
  const pattern = { weight, slant: style === 'italic' ? ITALIC : UPRIGHT }
  let best = -1
  let index = 0
  styles.forEach((current, i) => {
    const score = (widthScore(current.width) << 16) + skiaScore(pattern, current)
    if (score > best) {
      best = score
      index = i
    }
  })
  return index
}

/** `matchStyleCSS3`'s score for a face's width, against a pattern of normal width (5). */
function widthScore(width: number): number {
  return width <= 5 ? 5 + width : 10 - width
}
