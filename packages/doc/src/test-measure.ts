// A text measure for tests: the same size for the same text and style on every machine, with no
// fonts. Each character is half its font size wide, letter spacing included, and each line as tall
// as the line height (1.2 times the font size unless given); lines wrap at the width given.
import { letterSpacingPx } from '@dazbee/schema'

import type { MeasureText } from './fitted-text.ts'

/** How tall a line is, as a multiple of the font size, when the style gives no line height. */
const LINE_HEIGHT = 1.2

/** The size a text takes, measured as this module's header says. */
export const testMeasure: MeasureText = (props, width) => {
  const { fontSize, letterSpacing, lineHeight } = props.style
  const advance = Math.max(0.01, fontSize / 2 + letterSpacingPx(letterSpacing, fontSize))
  const perLine = width === null ? Infinity : Math.max(1, Math.floor(width / advance))
  const paragraphs = props.text.split('\n')
  const lines = paragraphs.reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / perLine)), 0)
  const widest = Math.max(...paragraphs.map((paragraph) => Math.min(paragraph.length, perLine)))
  return { width: widest * advance, height: lines * fontSize * (lineHeight ?? LINE_HEIGHT) }
}
