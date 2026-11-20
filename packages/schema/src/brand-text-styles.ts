// Brand text styles: a kit's named text looks, such as Headline, each a font, a weight, a line
// height, a letter spacing and a case, and no size. The kit's form adds Headline, Subhead and Body
// first; a style set in a kit font follows it as the kit changes.
import type { BrandKit, BrandTextStyle } from './api.ts'
import { freeToken } from './brand-roles.ts'
import { NO_LETTER_SPACING } from './typography.ts'

/** The styles the kit's form adds first, in this order. */
export const BRAND_TEXT_STYLE_PRESETS = ['headline', 'subhead', 'body'] as const
export type BrandTextStylePreset = (typeof BRAND_TEXT_STYLE_PRESETS)[number]

/**
 * Each first style's token and look. Body's token isn't `body`, the Body font's role, so the style
 * and the font each keep their own `brand:` name.
 */
const PRESETS: Readonly<Record<BrandTextStylePreset, Omit<BrandTextStyle, 'name'>>> = {
  headline: {
    token: 'headline',
    font: { token: 'heading' },
    fontWeight: 700,
    fontStyle: 'normal',
    lineHeight: 1.1,
    letterSpacing: { unit: 'percent', value: -1 },
  },
  subhead: {
    token: 'subhead',
    font: { token: 'heading' },
    fontWeight: 600,
    fontStyle: 'normal',
    lineHeight: 1.25,
    letterSpacing: NO_LETTER_SPACING,
  },
  body: {
    token: 'body-text',
    font: { token: 'body' },
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 1.4,
    letterSpacing: NO_LETTER_SPACING,
  },
}

/**
 * The style the kit's form adds next: the first of Headline, Subhead and Body whose token the kit
 * doesn't hold, in its look, or else one in Body's look numbered after the kit's styles. `name`
 * gives the name it shows, in the person's language: a first style's, or the nth's.
 */
export function newBrandTextStyle(
  kit: BrandKit,
  name: (preset: BrandTextStylePreset | null, n: number) => string,
): BrandTextStyle {
  const n = kit.textStyles.length + 1
  const preset = BRAND_TEXT_STYLE_PRESETS.find((p) => freeToken(kit, PRESETS[p].token) === PRESETS[p].token)
  if (preset) return { ...PRESETS[preset], name: name(preset, n) }
  return { ...PRESETS.body, token: freeToken(kit, `style-${n}`), name: name(null, n) }
}

/**
 * The family a style is set in: the family of the kit font it follows, or its own. Undefined while
 * the kit font it follows is not set.
 */
export function brandTextStyleFamily(kit: BrandKit, style: BrandTextStyle): string | undefined {
  const { font } = style
  return 'family' in font ? font.family : kit.fonts.find((f) => f.token === font.token)?.family
}
