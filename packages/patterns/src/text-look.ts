// How a text is set in a pattern: a look's type at a size, and the ink that reads on what is behind it.
import { shownScale } from '@dazbee/schema'

import { inkOn, LARGE_TEXT_CONTRAST, type Swatch, TEXT_CONTRAST } from './palette.ts'
import type { TextLook } from './styles.ts'
import type { Setting } from './words.ts'

/** WCAG 2's large text, 18 point, in CSS pixels. */
export const LARGE_TEXT_PX = 24

/** The ink a text takes on `surface`: the first of `offered`, else the kit's text and background colours, that reads at its size. */
export function inkFor({ palette, frame }: Setting, surface: string, size: number, offered?: Swatch[]): Swatch {
  const large = size / shownScale(frame.width, frame.height) >= LARGE_TEXT_PX
  return inkOn(surface, offered ?? [palette.text, palette.background], large ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST)
}

/** A text's style in a look at `size`, its colour black until it is given one. */
export function lookStyle({ palette }: Setting, look: TextLook, size: number) {
  return {
    fontFamily: palette[look.font].value,
    fontWeight: palette.brandFont[look.font] ? look.brandWeight : look.weight,
    fontSize: size,
    color: '#000000FF',
    letterSpacing: { unit: 'percent' as const, value: look.tracking },
    lineHeight: look.lineHeight,
    ...(look.textCase === 'none' ? {} : { textCase: look.textCase }),
  }
}
