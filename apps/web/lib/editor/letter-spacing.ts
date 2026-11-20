// Letter spacing as the Text tab shows and takes it: its unit and value, shared or mixed, the unit
// typed after a value (`2%`, `1.5px`), and a spacing in the other unit at the size it is set at.
import { type LetterSpacing, letterSpacingPx, NO_LETTER_SPACING } from '@dazbee/schema'

import { tidy } from './size.ts'

export type SpacingUnit = LetterSpacing['unit']

/** A unit after a value, at the end of what was typed. */
const TYPED_UNIT = /(%|px)\s*$/i

/** The unit typed at the end of a value: percent for `%`, px for `px`; null for none, or another. */
export function typedUnit(text: string): SpacingUnit | null {
  const unit = TYPED_UNIT.exec(text.trim())?.[1]?.toLowerCase()
  if (unit === '%') return 'percent'
  return unit === 'px' ? 'px' : null
}

/** Letter spacing in `unit`, the same room between letters at `fontSize`, tidied as shown. */
export function spacingIn(spacing: LetterSpacing, unit: SpacingUnit, fontSize: number): LetterSpacing {
  if (spacing.unit === unit) return spacing
  const pixels = letterSpacingPx(spacing, fontSize)
  return { unit, value: tidy(unit === 'px' ? pixels : (pixels * 100) / fontSize) }
}

/** The unit and value of letter spacing that styles share, each mixed where they differ; a style without its own has none, in percent. */
export function shownSpacing(styles: readonly { letterSpacing?: LetterSpacing | undefined }[]): {
  unit: SpacingUnit | 'mixed'
  value: number | 'mixed'
} {
  const spacings = styles.map((style) => style.letterSpacing ?? NO_LETTER_SPACING)
  const [first] = spacings
  const unit = spacings.every((s) => s.unit === first?.unit) ? (first?.unit ?? 'percent') : 'mixed'
  const value = unit !== 'mixed' && spacings.every((s) => s.value === first?.value) ? (first?.value ?? 0) : 'mixed'
  return { unit, value }
}
