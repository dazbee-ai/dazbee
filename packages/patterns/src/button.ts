// A pattern's button: a row box in a colour that stands out from the ground it is on, hugging its label, its corners
// the style's.
import { TextProps } from '@dazbee/schema'

import { contrast, INK, inkOn, type Palette, type Swatch, TEXT_CONTRAST, WHITE } from './palette.ts'
import { inkFor, lookStyle } from './text-look.ts'
import { round, solid, stroke, type TreeBuilder } from './tree.ts'
import type { Setting, Words } from './words.ts'

/** A button's colour, and the edge it is drawn with where no colour of the kit stands out from its ground. */
export interface ButtonFill {
  fill: Swatch
  edge?: Swatch
}

/** The room at each end of a button's label, as a share of its size; and the least it takes where room is short. */
export const BUTTON_SIDE = 1.4
export const BUTTON_SIDE_TIGHT = 0.8

/** The contrast a button holds with its ground, as WCAG 2 asks of a control. */
const BUTTON_CONTRAST = 3

/**
 * The button's colour on `ground`: the first of the style's button role, then the accent, primary, secondary and
 * text colours, that stands out from the ground at 3:1 and holds a label at 4.5:1, never the ground's own; else the
 * one that stands out most, edged in the ground's ink.
 */
export function ctaFill(palette: Palette, ground: Swatch, first: 'accent' | 'primary'): ButtonFill {
  const offered = offeredFills(palette, ground, first)
  const found = buttonColours(palette, ground, first)[0]
  if (found) return { fill: found }
  const best = offered.reduce((a, b) => (contrast(b.value, ground.value) > contrast(a.value, ground.value) ? b : a))
  return { fill: best, edge: inkOn(ground.value, [palette.text, palette.background], BUTTON_CONTRAST) }
}

/**
 * Every colour a button or badge takes on `ground`, in the order ctaFill tries them: those that stand out from the
 * ground at 3:1 and hold a label at 4.5:1, never the ground's own.
 */
export function buttonColours(palette: Palette, ground: Swatch, first: 'accent' | 'primary'): Swatch[] {
  return offeredFills(palette, ground, first).filter(
    (swatch) => contrast(swatch.value, ground.value) >= BUTTON_CONTRAST,
  )
}

/** The kit's colours a button is offered on `ground`, the style's first, those that hold a label where any does. */
function offeredFills(palette: Palette, ground: Swatch, first: 'accent' | 'primary'): Swatch[] {
  // A colour no ink reads on as small text can't hold a label.
  const holds = (swatch: Swatch) =>
    [palette.background, palette.text, WHITE, INK].some((ink) => contrast(ink.value, swatch.value) >= TEXT_CONTRAST)
  const all = [palette[first], palette.accent, palette.primary, palette.secondary, palette.text].filter(
    (swatch) => swatch.value !== ground.value && (!swatch.ref || swatch.ref !== ground.ref),
  )
  return all.some(holds) ? all.filter(holds) : all
}

/**
 * A button's size for a label at `label` px: the label's own width and height, with room round it, `side` of the
 * label's size at each end, at least `least` tall; `height` tall where it is given.
 */
export function buttonSize(
  setting: Setting,
  text: string,
  label: number,
  least = 0,
  side = BUTTON_SIDE,
  height?: number,
) {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    text,
    style: lookStyle(setting, setting.style.button, label),
    boxMode: 'autoWidth',
  })
  const own = setting.measure(props, null)
  const across = Math.round(label * side)
  const down = Math.round(
    height === undefined
      ? Math.max(label * 0.8, (least - own.height) / 2)
      : Math.max(label * 0.3, (height - own.height) / 2),
  )
  return { width: own.width + 2 * across, height: own.height + 2 * down, own, across, down, props }
}

/** The button: a row box in its colour, hugging its label, its corners the style's. */
export function buttonPart(
  tree: TreeBuilder,
  setting: Setting,
  words: Words,
  label: number,
  parent: string | undefined,
  at: { x: number; y: number },
  least = 0,
  side = BUTTON_SIDE,
  height?: number,
) {
  const { palette, style } = setting
  const fill = words.buttonFill?.fill ?? palette.primary
  const edge = words.buttonFill?.edge
  const size = buttonSize(setting, words.button ?? '', label, least, side, height)
  const ink = inkFor(setting, fill.value, label, [palette.background, palette.text])
  const box = { ...at, width: round(size.width), height: round(size.height) }
  const { fills, bindings } = solid(fill)
  const button = tree.add(
    'button',
    {
      type: 'box',
      name: 'Button',
      role: 'cta',
      props: {
        ...box,
        fills,
        ...(edge ? { strokes: [stroke(edge.value, Math.max(1, Math.round(size.height / 40)))] } : {}),
        cornerRadius: round(size.height * style.buttonRound),
        sizing: { width: 'hug', height: 'hug' },
        layout: {
          direction: 'row',
          padding: { top: size.down, right: size.across, bottom: size.down, left: size.across },
          justify: 'center',
          align: 'center',
        },
      },
      ...(bindings ? { bindings } : {}),
    },
    parent,
  )
  const font = palette[style.button.font]
  tree.add(
    'button-label',
    {
      type: 'text',
      name: 'Button label',
      role: 'cta',
      props: {
        ...size.props,
        x: box.x + size.across,
        y: box.y + size.down,
        width: size.own.width,
        height: size.own.height,
        style: { ...size.props.style, color: ink.value },
        sizing: { width: 'hug', height: 'hug' },
      },
      bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
    },
    button,
  )
}
