// The fonts a brand text style can be set in, as the kit's form offers them: the kit's font roles,
// set or not, then the brand's own fonts, which a style follows as the kit changes; then each
// family of the brand's catalog, which a style keeps as it is.
import { type BrandKit, brandRoleOf, brandRolesOf, type BrandTextStyleFont } from '@dazbee/schema'

import { format, type Messages } from '@/lib/i18n/index.ts'

/** A font a style can be set in, the field's value for it, and what the menu says of it. */
export interface TextStyleFontChoice {
  value: string
  font: BrandTextStyleFont
  label: string
}

/** The field's value for a font: a kit font's apart from a family of the same name. */
export const textStyleFontValue = (font: BrandTextStyleFont) =>
  'token' in font ? `kit:${font.token}` : `family:${font.family}`

/** The fonts the form offers, in order; `t` is the person's catalog's brand kit messages. */
export function textStyleFonts(
  kit: BrandKit,
  families: readonly string[],
  t: Messages['editor']['brandKit'],
): TextStyleFontChoice[] {
  const kitFont = (token: string, name: string, family: string | undefined): TextStyleFontChoice => ({
    value: textStyleFontValue({ token }),
    font: { token },
    label: format(t.kitFont, { name, family: family ?? t.notSet }),
  })
  return [
    ...brandRolesOf(kit, 'font').map(({ role, entry }) => kitFont(role, t.brandRoles[role], entry?.family)),
    ...kit.fonts.filter((f) => !brandRoleOf('font', f.token)).map((f) => kitFont(f.token, f.name, f.family)),
    ...families.map((family) => ({ value: textStyleFontValue({ family }), font: { family }, label: family })),
  ]
}
