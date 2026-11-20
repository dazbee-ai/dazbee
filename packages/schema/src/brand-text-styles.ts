// Brand text styles: a kit's named text looks, such as Headline, each a font, a weight, a line
// height, a letter spacing and a case, and no size. The kit's form adds Headline, Subhead and Body
// first; a style set in a kit font follows it as the kit changes.
import { z } from 'zod'

import type { BrandKit } from './api.ts'
import { brandRoleOf, freeToken } from './brand-roles.ts'
import { textStyleFields } from './layers.ts'
import { NO_LETTER_SPACING } from './typography.ts'
import { BrandToken } from './variables.ts'

/**
 * The font a brand text style is set in: a kit font's token, a brand role such as Heading or one of
 * the brand's own, which the style follows as the kit changes; or a family of its own.
 */
export const BrandTextStyleFont = z.union([
  z.object({ token: BrandToken }),
  z.object({ family: z.string().trim().min(1).max(100) }),
])
export type BrandTextStyleFont = z.infer<typeof BrandTextStyleFont>

/**
 * A brand text style: a named text look, such as Headline, that texts follow. It holds no size, so
 * it fits every ad size; each text keeps its own. A line height left out is the font's own.
 */
export const BrandTextStyle = z.object({
  token: BrandToken,
  name: z.string().trim().min(1).max(60),
  font: BrandTextStyleFont,
  fontWeight: textStyleFields.fontWeight,
  fontStyle: textStyleFields.fontStyle,
  lineHeight: textStyleFields.lineHeight.optional(),
  letterSpacing: textStyleFields.letterSpacing,
  textCase: textStyleFields.textCase.optional(),
})
export type BrandTextStyle = z.infer<typeof BrandTextStyle>

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

/**
 * The kit without one of its fonts. Styles that follow a font of the brand's own take its family,
 * so they keep their look; styles that follow a font role keep following it, set or not.
 */
export function withoutKitFont(kit: BrandKit, token: string): BrandKit {
  const font = kit.fonts.find((f) => f.token === token)
  if (!font) return kit
  const keep = brandRoleOf('font', token) !== undefined
  return {
    ...kit,
    fonts: kit.fonts.filter((f) => f.token !== token),
    textStyles: kit.textStyles.map((s) =>
      !keep && 'token' in s.font && s.font.token === token ? { ...s, font: { family: font.family } } : s,
    ),
  }
}
