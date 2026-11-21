// A pattern's button: a row box in a colour, hugging its label, its corners the style's.
import { TextProps } from '@dazbee/schema'

import { inkFor, lookStyle } from './text-look.ts'
import { round, solid, type TreeBuilder } from './tree.ts'
import type { Setting, Words } from './words.ts'

/** A button's size for a label at `label` px: the label's own width and height, with room round it. */
export function buttonSize(setting: Setting, text: string, label: number) {
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
  const across = Math.round(label * 1.4)
  const down = Math.round(label * 0.8)
  return { width: own.width + 2 * across, height: own.height + 2 * down, own, across, down, props }
}

/** The button: a row box in its colour, hugging its label, its corners the style's. */
export function buttonPart(
  tree: TreeBuilder,
  setting: Setting,
  words: Words,
  label: number,
  parent: string,
  at: { x: number; y: number },
) {
  const { palette, style } = setting
  const fill = words.buttonFill ?? palette.primary
  const size = buttonSize(setting, words.button ?? '', label)
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
