// How big text must be to read in a frame, where the frame is shown: a Google Display size at its own
// pixels, as a banner is placed; any other frame fitted to a phone's width, as a feed, story or video
// ad fills the screen's width; and its text there at least the size a phone's text reads at. A
// text's smallest letters are what is held to it.
import type { TextProps } from './layers.ts'
import { SIZE_PRESETS } from './sizes.ts'
import { withRunStyle } from './typography.ts'

/** The size and weight of some of a text's letters. */
export interface Letters {
  size: number
  weight: number
}

/**
 * The width, in CSS pixels, a frame wider than it is shown at. StatCounter's mobile screen resolutions
 * worldwide for October 2026 list 414 × 896, 360 × 800 and 384 × 832 as the three most used; this is
 * the narrowest of them, so text that reads here reads on each.
 */
export const PHONE_WIDTH = 360

/**
 * The smallest text that reads where a frame is shown, in CSS pixels. Apple's UI Design Dos and
 * Don'ts (https://developer.apple.com/design/tips/): "Text should be at least 11 points so it's
 * legible at a typical viewing distance without zooming"; an iOS point is a CSS pixel.
 */
export const READABLE_TEXT_PX = 11

/**
 * How many of a frame's pixels make one CSS pixel where it is shown: 1 for a size of the Google
 * Display channel, which shows at its own size; else the frame's width over PHONE_WIDTH, and 1 for a
 * frame no wider.
 */
export function shownScale(width: number, height: number): number {
  const banner = SIZE_PRESETS.some(
    (preset) => preset.channel === 'google' && preset.width === width && preset.height === height,
  )
  return banner ? 1 : Math.max(1, width / PHONE_WIDTH)
}

/** The smallest font size, in the frame's pixels, that reads in a frame this size where it is shown. */
export function readableTextSize(width: number, height: number): number {
  return READABLE_TEXT_PX * shownScale(width, height)
}

/**
 * The size, as drawn with `scale` for shrink to fit, and weight of a text's smallest letters, the
 * thinnest of those; undefined for a text of only spaces.
 */
export function smallestLetters(props: TextProps, scale: number): Letters | undefined {
  const edges = [...new Set([0, props.text.length, ...props.runs.flatMap((r) => [r.start, r.end])])].sort(
    (a, b) => a - b,
  )
  let smallest: Letters | undefined
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i] ?? 0
    const end = edges[i + 1] ?? start
    if (!/\S/u.test(props.text.slice(start, end))) continue
    let style = props.style
    for (const run of props.runs) if (run.start <= start && run.end >= end) style = withRunStyle(style, run.style)
    const piece = { size: style.fontSize * scale, weight: style.fontWeight }
    if (!smallest || piece.size < smallest.size || (piece.size === smallest.size && piece.weight < smallest.weight))
      smallest = piece
  }
  return smallest
}
