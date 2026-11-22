import type { CanvasKit, Paragraph, ParagraphBuilder } from '@dazbee/canvaskit'
import { scaled } from '@dazbee/doc'
import { scriptFamilies } from '@dazbee/fonts'
import { autoDirection, type GradientPaint, type TextProps, withRunStyle } from '@dazbee/schema'

import type { Resources } from '../resources.ts'
import { strutStyle, textStyle } from './canvaskit-style.ts'
import type { Placement } from './placed.ts'
import { madeUpSmallCaps } from './small-caps.ts'
import { madeUpSuperSubs, paragraphShape, superSubLineStyle, withoutSuperSubs } from './super-sub.ts'
import { withCase } from './text-case.ts'
import { linedGradients, pushPainted, type TextPass } from './text-paint.ts'
import type { StyledPiece } from './types.ts'
import { rewrap, type Rewrapped } from './wrap-style.ts'

/** One paragraph of a text layer (the text between line breaks), laid out where it sits in the layer. */
export interface TextBlock {
  paragraph: Paragraph
  /** The same paragraph with the runs outlined over the letters stroked and the rest clear, drawn over it; null without such outlines. */
  outline: Paragraph | null
  /** The same with the runs outlined under the letters stroked, drawn before every block's fill; null without such outlines. */
  outlineUnder: Paragraph | null
  /** For each gradient whose runs are underlined or struck through, the same with only those lines, which it fills, drawn over it. */
  gradientLines: { gradient: GradientPaint; paragraph: Paragraph }[]
  /** Its bullet or number, at (markerX, markerY) in the block, on the first line's baseline; null when not in a list. */
  marker: Paragraph | null
  markerX: number
  markerY: number
  /**
   * The paragraph as drawn, its case changed and a line Pretty ends early ending in a line separator
   * in place of its space, without the line break; offsets match the layer's text.
   */
  text: string
  /** Where it is in the layer's text, in UTF-16 units. */
  start: number
  end: number
  /** Its origin in the layer, before vertical alignment. */
  x: number
  y: number
  height: number
}

/**
 * A text layer shaped and laid out: the one layout drawing, measuring and editing use, so the caret
 * sits on the glyphs that are drawn. Blocks stack down from the layer's (x, y + dy). Paragraphs cut
 * off by `maxLines` have no block. The caller deletes it.
 */
export interface TextLayout {
  blocks: TextBlock[]
  dy: number
  width: number
  height: number
  /** The base font size shrink to fit chose, over the one set; 1 without it. */
  scale: number
  /** The most pixels a made-up superscript or subscript moves its glyphs off their line's baseline; 0 without one. */
  superSubShift: number
  align: TextProps['align']
  rtl: boolean
  /** The styled pieces its characters are drawn in, by their offsets in the layer's text. */
  pieces: StyledPiece[]
  /**
   * Where each letter is drawn when its letters are moved and turned (ADR-0021); null when the
   * paragraphs draw it as they are laid out. Freed with the layout.
   */
  placed: Placement | null
  delete(): void
}

/** What laying out text needs of the resources: the fonts, the fallbacks, and the features each family has. */
export type TextResources = Pick<Resources, 'fonts' | 'fallbackFamilies' | 'familyFeatures' | 'familySuperSubs'>

type Style = TextProps['style']

const ELLIPSIS = '\u2026'
/** The pass that draws a text's characters. */
const FILL: TextPass = { kind: 'fill' }

/**
 * Shapes and lays out a text layer, a paragraph at a time (#47): lists put each paragraph's lines
 * clear of a gutter for its marker, and paragraph spacing goes between them. A text with one
 * paragraph is laid out as one SkParagraph, as before.
 */
export function layoutText(ck: CanvasKit, props: TextProps, resources: TextResources): TextLayout {
  const fit = props.shrinkToFit
  if (!fit) return place(props, build(ck, props, resources, 1))
  // The largest quarter point size from min to max that fits; min when none does.
  const base = props.style.fontSize
  let lo = Math.ceil(fit.min * 4)
  let hi = Math.floor(fit.max * 4)
  let best: TextLayout | null = null
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const laid = build(ck, props, resources, mid / 4 / base)
    if (fits(props, laid)) {
      best?.delete()
      best = laid
      lo = mid + 1
    } else {
      laid.delete()
      hi = mid - 1
    }
  }
  return place(props, best ?? build(ck, props, resources, fit.min / base))
}

/** What a text layer's layout depends on: everything but where it is placed and how it is painted over. */
export function layoutKey(props: TextProps, fallbackFamilies: string[]) {
  return JSON.stringify([
    props.text,
    props.runs,
    props.style,
    props.width,
    props.height,
    props.boxMode,
    props.wrapStyle,
    props.align,
    props.verticalAlign,
    props.direction,
    props.list,
    props.paragraphSpacing,
    props.maxLines,
    props.shrinkToFit,
    fallbackFamilies,
  ])
}

/** Vertical alignment in a fixed box. */
function place(props: TextProps, laid: TextLayout): TextLayout {
  const free = props.boxMode === 'fixed' ? props.height - laid.height : 0
  laid.dy = { top: 0, middle: free / 2, bottom: free }[props.verticalAlign]
  return laid
}

function build(ck: CanvasKit, props: TextProps, resources: TextResources, scale: number): TextLayout {
  const direction = props.direction === 'auto' ? autoDirection(props.text) : props.direction
  const rtl = direction === 'rtl'
  const base = scaled(props.style, scale) as Style
  // A text tries the shipped fallbacks, then the script fonts its own characters need
  // (`scriptFamilies`, as `textFontUses` loads them), so a character's font never hangs on which
  // other texts asked for theirs.
  const fallbacks = { fallbackFamilies: [...resources.fallbackFamilies, ...scriptFamilies(props.text)] }
  // Later runs win where runs overlap, so split the text at every run edge and merge per piece.
  const edges = [...new Set([0, props.text.length, ...props.runs.flatMap((r) => [r.start, r.end])])].sort(
    (a, b) => a - b,
  )
  const pieces = edges.slice(0, -1).map((start, i) => {
    const end = edges[i + 1] ?? props.text.length
    let style = props.style
    for (const run of props.runs) if (run.start <= start && run.end >= end) style = withRunStyle(style, run.style)
    return { start, end, style: scaled(style, scale) as Style }
  })
  const styleAt = (offset: number) =>
    pieces.find((p) => offset >= p.start && offset < p.end)?.style ?? pieces.at(-1)?.style ?? base
  const cased = withCase(props.text, styleAt)
  // Superscripts and subscripts the fonts lack are drawn smaller and moved off the baseline, and
  // small caps they lack as smaller capitals, in pieces of their own.
  const shape = paragraphShape(ck, resources.fonts, rtl, (style) => textStyle(ck, style, fallbacks, FILL))
  const scripted = madeUpSuperSubs(cased, pieces, shape, resources.familySuperSubs, resources.familyFeatures)
  const { shown, pieces: drawn } = madeUpSmallCaps(cased, scripted, resources.familyFeatures)

  /** A paragraph's style; `strut` is the style its lines are at least as tall as, where its own runs are smaller. */
  const paragraphStyle = (style: Style, extra: { maxLines?: number; ellipsis?: string } = {}, strut?: Style) =>
    new ck.ParagraphStyle({
      textAlign: {
        start: ck.TextAlign.Start,
        center: ck.TextAlign.Center,
        end: ck.TextAlign.End,
        justify: ck.TextAlign.Justify,
      }[props.align],
      textDirection: rtl ? ck.TextDirection.RTL : ck.TextDirection.LTR,
      textStyle: textStyle(ck, style, fallbacks, FILL),
      ...(strut ? { strutStyle: strutStyle(ck, strut, fallbacks) } : {}),
      ...extra,
    })
  const outlined = (under: boolean) =>
    pieces.some((p) => (p.style.outline?.width ?? 0) > 0 && (p.style.outline?.under ?? false) === under)
  // Gradients are placed in the layer's box, which drawing puts the paragraphs in.
  const box = { x: 0, y: 0, width: props.width, height: props.height }
  /** Pushes a style onto a paragraph's builder, painted for the pass. */
  const push = (builder: ParagraphBuilder, piece: Pick<StyledPiece, 'style' | 'superSub'>, pass: TextPass) =>
    pushPainted(
      ck,
      builder,
      textStyle(ck, piece.style, fallbacks, pass, piece.superSub?.baselineShift),
      piece.style,
      pass,
      box,
    )
  /**
   * One paragraph of the text, drawn for the pass. `more` is drawn after it, as an ellipsis is.
   * `text` is what it draws in place of the shown text, of the same length.
   */
  const paragraphOf = (
    start: number,
    end: number,
    extra: { maxLines?: number; ellipsis?: string },
    pass: TextPass,
    more = '',
    text = shown.slice(start, end),
  ) => {
    // An empty paragraph takes the style typing would give it: the character before's.
    const lead = start < end ? styleAt(start) : styleAt(Math.max(0, start - 1))
    const strut = superSubLineStyle(drawn.filter((p) => p.start < end && p.end > start))
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(
      paragraphStyle(start === 0 && end === props.text.length ? base : lead, extra, strut),
      resources.fonts,
    )
    for (const piece of drawn) {
      const from = Math.max(piece.start, start)
      const to = Math.min(piece.end, end)
      if (to <= from) continue
      push(builder, piece, pass)
      builder.addText(text.slice(from - start, to - start))
      builder.pop()
    }
    if (more) {
      const last = Math.max(start, end - 1)
      const piece = drawn.find((p) => last >= p.start && last < p.end)
      push(builder, piece ?? { style: styleAt(last) }, pass)
      builder.addText(more)
      builder.pop()
    }
    const paragraph = builder.build()
    builder.delete()
    return paragraph
  }

  // Paragraphs, and the marker of each one with text.
  const ranges: { start: number; end: number }[] = []
  let at = 0
  for (const line of props.text.split('\n')) {
    ranges.push({ start: at, end: at + line.length })
    at += line.length + 1
  }
  let number = 0
  const markers = ranges.map(({ start, end }) => {
    if (!props.list || start === end) return null
    number++
    // A marker is never raised or lowered, whichever its paragraph's first character is.
    const style = withoutSuperSubs(styleAt(start))
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(paragraphStyle(style), resources.fonts)
    push(builder, { style }, FILL)
    // In right-to-left text the full stop lands on the number's left, as Arabic lists show it.
    builder.addText(props.list === 'bullet' ? '\u2022' : `${number}.`)
    builder.pop()
    const paragraph = builder.build()
    builder.delete()
    // Laid out at its own width: a right-to-left one laid out wider would sit at the far end.
    paragraph.layout(Number.POSITIVE_INFINITY)
    paragraph.layout(Math.ceil(paragraph.getMaxIntrinsicWidth()))
    return paragraph
  })
  // The gutter: the widest marker and half the base size more.
  const gutter = props.list
    ? Math.ceil(Math.max(0, ...markers.map((m) => m?.getMaxIntrinsicWidth() ?? 0)) + base.fontSize / 2)
    : 0

  let paragraphs = ranges.map(({ start, end }) => paragraphOf(start, end, {}, FILL))
  /** How the last paragraph was cut, so its outline pass is cut alike. */
  let cutWith: { extra: { maxLines?: number; ellipsis?: string }; more: string } = { extra: {}, more: '' }
  let width: number
  if (props.boxMode === 'autoWidth') {
    for (const p of paragraphs) p.layout(Number.POSITIVE_INFINITY)
    width = Math.ceil(Math.max(0, ...paragraphs.map((p) => p.getMaxIntrinsicWidth())))
    for (const p of paragraphs) p.layout(width)
    width += gutter
  } else {
    width = props.width
    for (const p of paragraphs) p.layout(width - gutter)
  }
  const inner = width - gutter
  const lineCount = (p: Paragraph) => Math.max(1, p.getLineMetrics().length)

  // Lines past maxLines are cut: the paragraph they end in gets an ellipsis, and later ones go.
  if (props.maxLines !== undefined) {
    let left = props.maxLines
    for (const [i, p] of paragraphs.entries()) {
      const lines = lineCount(p)
      const range = ranges[i] as { start: number; end: number }
      const cut = lines > left
      const last = lines === left && paragraphs.slice(i + 1).length > 0
      if (cut || last) {
        p.delete()
        cutWith = { extra: { maxLines: left, ellipsis: ELLIPSIS }, more: last ? ELLIPSIS : '' }
        const remake = paragraphOf(range.start, range.end, cutWith.extra, FILL, cutWith.more)
        remake.layout(inner)
        paragraphs[i] = remake
        for (const gone of paragraphs.slice(i + 1)) gone.delete()
        for (const gone of markers.slice(i + 1)) gone?.delete()
        paragraphs = paragraphs.slice(0, i + 1)
        markers.length = i + 1
        break
      }
      left -= lines
    }
  }

  // Balance and Pretty narrow each paragraph's lines; one cut off with an ellipsis keeps its own.
  const cutAt = cutWith.extra.maxLines === undefined ? -1 : paragraphs.length - 1
  const wraps = paragraphs.map((paragraph, i): Rewrapped => {
    const { start, end } = ranges[i] as { start: number; end: number }
    const text = shown.slice(start, end)
    if (i === cutAt) return { paragraph, text, width: inner, dx: 0 }
    return rewrap(paragraph, text, props, rtl, inner, (local) => paragraphOf(start, end, {}, FILL, '', local))
  })
  const spacing = (props.paragraphSpacing ?? 0) * scale
  let y = 0
  const blocks: TextBlock[] = wraps.map((wrap, i) => {
    const { paragraph } = wrap
    const range = ranges[i] as { start: number; end: number }
    const lastOne = i === paragraphs.length - 1
    /** This paragraph drawn for another pass, cut and wrapped as its fill pass is. */
    const passOf = (pass: TextPass) => {
      const laid = paragraphOf(
        range.start,
        range.end,
        lastOne ? cutWith.extra : {},
        pass,
        lastOne ? cutWith.more : '',
        wrap.text,
      )
      laid.layout(wrap.width)
      return laid
    }
    const lined = linedGradients(pieces.filter((p) => p.start < range.end && p.end > range.start).map((p) => p.style))
    const marker = markers[i] ?? null
    const block: TextBlock = {
      paragraph,
      outline: outlined(false) ? passOf({ kind: 'outline', under: false }) : null,
      outlineUnder: outlined(true) ? passOf({ kind: 'outline', under: true }) : null,
      gradientLines: [...lined].map(([key, gradient]) => ({
        gradient,
        paragraph: passOf({ kind: 'lines', gradient: key }),
      })),
      marker,
      markerX: rtl ? inner + gutter - (marker?.getMaxIntrinsicWidth() ?? 0) : 0,
      markerY: (paragraph.getLineMetrics()[0]?.baseline ?? 0) - (marker?.getLineMetrics()[0]?.baseline ?? 0),
      text: wrap.text,
      start: range.start,
      end: range.end,
      x: (rtl ? 0 : gutter) + wrap.dx,
      y,
      height: paragraph.getHeight(),
    }
    y += block.height + (i < paragraphs.length - 1 ? spacing : 0)
    return block
  })
  const layout: TextLayout = {
    blocks,
    dy: 0,
    width,
    height: y,
    scale,
    superSubShift: Math.max(0, ...drawn.map((p) => Math.abs(p.superSub?.baselineShift ?? 0))),
    align: props.align,
    rtl,
    pieces: drawn,
    placed: null,
    delete() {
      for (const b of blocks) {
        b.paragraph.delete()
        b.outline?.delete()
        b.outlineUnder?.delete()
        for (const l of b.gradientLines) l.paragraph.delete()
        b.marker?.delete()
      }
      layout.placed?.delete()
    },
  }
  return layout
}

/** Whether text fits its box: no word broken across lines, nothing cut off, and in a fixed box no line below it. */
function fits(props: TextProps, laid: TextLayout): boolean {
  if (props.boxMode === 'autoWidth') return true
  const total = props.text.split('\n').length
  if (laid.blocks.length < total || laid.blocks.some((b) => b.paragraph.didExceedMaxLines())) return false
  for (const b of laid.blocks) if (b.paragraph.getMinIntrinsicWidth() > b.paragraph.getMaxWidth() + 0.01) return false
  return props.boxMode !== 'fixed' || laid.height <= props.height + 0.01
}
