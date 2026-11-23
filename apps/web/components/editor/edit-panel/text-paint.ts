// A text's paint as its Colour panel reads and writes it: its colour, a gradient or a text image
// fill, which are one paint, so picking one takes the others off. Picked for the selected texts, or
// for the selected characters while one text is edited.
import {
  type GradientPaint,
  type ImagePaint,
  inColour,
  type Paint,
  shownGradient,
  shownImage,
  TextImagePaint,
  withRunStyle,
} from '@dazbee/schema'

import { hexChange } from '@/lib/colour.ts'

import { set, shared, type Style, type Target } from './target.ts'

/** What a text style paints its characters with: its image fill or gradient while one shows, else its colour as a solid. */
export function textPaint(style: Style): Paint {
  return shownImage(style) ?? shownGradient(style) ?? { type: 'solid', color: style.color }
}

/** The paint every one of `styles` shows, or mixed where they differ. */
export function sharedTextPaint(styles: readonly Style[]): Paint | 'mixed' {
  return shared(styles.map(textPaint))
}

/**
 * Colours the selected characters while one text is edited, else each selected text, `hex`
 * (`#rrggbb`), keeping the alpha of their first character's colour or each text's own: their
 * gradient or image fill comes off. Whether it wrote.
 */
export function colourTexts(target: Target, hex: string): boolean {
  const { range } = target
  if (range) return target.editor.styleTextSelection({ color: hexChange(hex)(range[0]?.color) })
  return set(target, (props) => {
    const style = props.style as Style
    return { style: inColour(style, hexChange(hex)(style.color)) }
  })
}

/**
 * Paints the selected characters while one text is edited, from their first character's paint, else
 * each selected text from its own, with `to` of the paint it shows. Whether it wrote.
 */
export function pickTextPaint(target: Target, to: (now: Paint) => Paint): boolean {
  const { range } = target
  if (range) {
    const first = range[0] ?? (target.props[0].style as Style)
    const now = textPaint(first)
    return target.editor.styleTextSelection(runPaint(first, now, to(now)))
  }
  return set(target, (props) => {
    const style = props.style as Style
    const now = textPaint(style)
    return { style: paintedStyle(style, now, to(now)) }
  })
}

/**
 * `style` painted with `next` in place of `now`, the paint it shows: a colour takes its gradient and
 * image fill off, and a gradient or an image fill takes the other off. A colour switched to from an
 * image fill is the colour kept under it.
 */
export function paintedStyle(style: Style, now: Paint, next: Paint): Style {
  if (next.type === 'solid') return inColour(style, keptColour(style, now, next))
  return withRunStyle(style, next.type === 'image' ? { image: textImage(next) } : { gradient: next })
}

/** What a run's style sets to paint its characters with `next` in place of `now`, as `paintedStyle` paints a text. */
function runPaint(
  first: Style,
  now: Paint,
  next: Paint,
): { color: string } | { gradient: GradientPaint } | { image: TextImagePaint } {
  if (next.type === 'solid') return { color: keptColour(first, now, next) }
  return next.type === 'image' ? { image: textImage(next) } : { gradient: next }
}

/** The colour a solid `next` paints: the style's own, kept under it, where it replaces an image fill. */
function keptColour(style: Style, now: Paint, next: Extract<Paint, { type: 'solid' }>): string {
  return now.type === 'image' ? style.color : next.color
}

/** An image fill as a text holds it: with no crop, and filling the box where it was cropped. */
function textImage(image: ImagePaint): TextImagePaint {
  return TextImagePaint.parse({ ...image, fit: image.fit === 'crop' ? 'fill' : image.fit })
}
