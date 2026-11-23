// A text's paint as its Colour panel reads and writes it: its colour, a gradient or a text image
// fill, which are one paint, so picking one takes the others off. Read and picked for the selected
// characters while one text is edited, else for every character of the selected texts: the base
// style's and each run's that sets its own paint.
import {
  type GradientPaint,
  type ImagePaint,
  inColour,
  type Paint,
  shownGradient,
  shownImage,
  TextImagePaint,
  type TextRun,
  withRunStyle,
} from '@dazbee/schema'

import { hexChange } from '@/lib/colour.ts'

import { type Patch, type Props, set, shared, type Style, type Target } from './target.ts'

/** What a style or a run sets to paint its characters: a colour, a gradient or an image fill. */
type PaintSet = { color: string } | { gradient: GradientPaint } | { image: TextImagePaint }

/** What a text style paints its characters with: its image fill or gradient while one shows, else its colour as a solid. */
export function textPaint(style: Style): Paint {
  return shownImage(style) ?? shownGradient(style) ?? { type: 'solid', color: style.color }
}

/** The paint every selected character shows, or mixed where they differ. */
export function shownTextPaint(target: Target): Paint | 'mixed' {
  return target.range ? shared(target.range.map(textPaint)) : shared(target.props.flatMap(paintsOf))
}

/** The paint the picker edits: the selected range's first character's, else the first text's first. */
export function firstTextPaint(target: Target): Paint {
  const [first] = target.range ?? []
  return first ? textPaint(first) : (paintsOf(target.props[0])[0] ?? textPaint(target.props[0].style as Style))
}

/**
 * Colours the selected characters, `hex` (`#rrggbb`), each keeping the alpha of its own colour (a
 * range its first character's): their gradient or image fill comes off. Whether it wrote.
 */
export function colourTexts(target: Target, hex: string): boolean {
  return paintTexts(target, (style) => ({ color: hexChange(hex)(style.color) }))
}

/**
 * Paints the selected characters with `to` of the paint they show (a range its first character's).
 * A colour switched to from an image fill is the colour kept under it. Whether it wrote.
 */
export function pickTextPaint(target: Target, to: (now: Paint) => Paint): boolean {
  return paintTexts(target, (style) => {
    const now = textPaint(style)
    return paintSet(style, now, to(now))
  })
}

/**
 * Paints the selected range while one text is edited with what its first character's style takes,
 * else each selected text's base style and each run that sets its own paint with what it takes,
 * laid over the run's characters as the editor writes runs. One undo step.
 */
function paintTexts(target: Target, paintOf: (style: Style) => PaintSet): boolean {
  const { range } = target
  if (range) return target.editor.styleTextSelection(paintOf(range[0] ?? (target.props[0].style as Style)))
  return set(target, (props): Patch => {
    const style = props.style as Style
    const runs = paintRuns(props).map((run) => ({
      start: run.start,
      end: run.end,
      style: paintOf(withRunStyle(style, run.style) as Style),
    }))
    const paint = paintOf(style)
    return {
      style: 'color' in paint ? inColour(style, paint.color) : withRunStyle(style, paint),
      ...(runs.length > 0 && { runs }),
    }
  })
}

/**
 * The paints a text's characters show: its base style's, unless runs that set a paint cover every
 * character, and each such run's over it.
 */
function paintsOf(props: Props): Paint[] {
  const style = props.style as Style
  const painting = paintRuns(props).toSorted((a, b) => a.start - b.start)
  let reached = 0
  for (const run of painting) if (run.start <= reached) reached = Math.max(reached, run.end)
  const length = ((props.text ?? '') as string).length
  const base = length === 0 || reached < length ? [textPaint(style)] : []
  return [...base, ...painting.map((run) => textPaint(withRunStyle(style, run.style) as Style))]
}

/** A text's runs that set their own colour, gradient or image fill. */
function paintRuns(props: Props): TextRun[] {
  return ((props.runs ?? []) as TextRun[]).filter(
    (run) => run.style.color !== undefined || run.style.gradient !== undefined || run.style.image !== undefined,
  )
}

/** What a style sets to paint with `next` in place of `now`: a colour switched to from an image fill is the colour kept under it. */
function paintSet(style: Style, now: Paint, next: Paint): PaintSet {
  if (next.type === 'solid') return { color: now.type === 'image' ? style.color : next.color }
  return next.type === 'image' ? { image: textImage(next) } : { gradient: next }
}

/** An image fill as a text holds it: with no crop, and filling the box where it was cropped. */
function textImage(image: ImagePaint): TextImagePaint {
  return TextImagePaint.parse({ ...image, fit: image.fit === 'crop' ? 'fill' : image.fit })
}
