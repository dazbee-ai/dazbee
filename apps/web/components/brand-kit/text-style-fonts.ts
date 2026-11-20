// The fonts a brand text style can be set in, as the kit's form offers them: the kit's font roles,
// set or not, then the brand's own fonts, which a style follows as the kit changes; then each
// family of the brand's catalog, which a style keeps as it is. And how a style's letter spacing is
// shown.
import { type BrandKit, brandRoleOf, brandRolesOf, type BrandTextStyleFont, type LetterSpacing } from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

/** A font a style can be set in, the field's value for it, and what the menu says of it. */
export interface TextStyleFontChoice {
  value: string
  font: BrandTextStyleFont
  label: string
}

/**
 * The fonts the form offers, in order; `t` is the person's catalog's brand kit messages. A style's
 * own font that none of them is, a family the catalog no longer has or a kit font since taken out,
 * comes first, so the style's field still shows what it is set in.
 */
export function textStyleFonts(
  kit: BrandKit,
  families: readonly string[],
  t: Messages['editor']['brandKit'],
  own?: BrandTextStyleFont,
): TextStyleFontChoice[] {
  const kitFont = (token: string, name: string, family: string | undefined): TextStyleFontChoice => ({
    value: textStyleFontValue({ token }),
    font: { token },
    label: format(t.kitFont, { name, family: family ?? t.notSet }),
  })
  const offered = [
    ...brandRolesOf(kit, 'font').map(({ role, entry }) => kitFont(role, t.brandRoles[role], entry?.family)),
    ...kit.fonts.filter((f) => !brandRoleOf('font', f.token)).map((f) => kitFont(f.token, f.name, f.family)),
    ...families.map((family) => ({ value: textStyleFontValue({ family }), font: { family }, label: family })),
  ]
  if (!own || offered.some((f) => f.value === textStyleFontValue(own))) return offered
  const label = 'family' in own ? own.family : t.notSet
  return [{ value: textStyleFontValue(own), font: own, label }, ...offered]
}

/** The field's value for a font: a kit font's apart from a family of the same name. */
export function textStyleFontValue(font: BrandTextStyleFont) {
  return 'token' in font ? `kit:${font.token}` : `family:${font.family}`
}

/** The unit a letter spacing is shown in: pixels, or a percentage of the size. */
export function letterSpacingUnit(spacing: LetterSpacing) {
  return spacing.unit === 'px' ? 'px' : '%'
}
