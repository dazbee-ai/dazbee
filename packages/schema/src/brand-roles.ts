// Brand roles: the named places every brand kit has, the colours Primary, Secondary, Accent,
// Background and Text, the fonts Heading and Body, and the logo. Each is a reserved brand token, so
// a layer bound to `brand:primary` follows whichever brand's kit it is drawn with. A kit colour or
// font whose token is a role of its kind fills that role; the rest are the brand's own. The kit's
// logo fills the logo role (`brandVariables`).
import type { BrandColor, BrandFont, BrandKit } from './api.ts'

/** The two parts of a kit that hold roles. */
export type KitKind = 'color' | 'font'

/** Each kind's roles, in the order the kit shows them. */
export const BRAND_ROLES = {
  color: ['primary', 'secondary', 'accent', 'background', 'text'],
  font: ['heading', 'body'],
} as const
export type BrandRole = (typeof BRAND_ROLES)[KitKind][number]

/** The brand role the kit's logo fills, a picture: a layer bound to `brand:logo` draws the brand's logo. */
export const LOGO_ROLE = 'logo'

/** How many colours and fonts a kit holds at most, its brand roles included. */
export const BRAND_KIT_LIMITS = { color: 24, font: 8 } as const

/** What a kit holds of each kind. */
interface KitEntries {
  color: BrandColor
  font: BrandFont
}

/** A role of a kind, and the kit's entry that fills it; none while the role is not set. */
export interface KitBrandRole<K extends KitKind> {
  role: BrandRole
  entry: KitEntries[K] | undefined
}

/** The name a role set from the kit's form stores; the app shows each role's own name, translated. */
const BRAND_ROLE_NAMES: Readonly<Record<BrandRole, string>> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  background: 'Background',
  text: 'Text',
  heading: 'Heading',
  body: 'Body',
}

/** The role of a kind a token names; undefined for a token of the brand's own, or a role of the other kind. */
export function brandRoleOf(kind: KitKind, token: string): BrandRole | undefined {
  return (BRAND_ROLES[kind] as readonly string[]).includes(token) ? (token as BrandRole) : undefined
}

/** A kit's colours or fonts with the roles first, in role order, then the brand's own in the order given. */
export function inBrandRoleOrder<T extends { token: string }>(kind: KitKind, entries: readonly T[]): T[] {
  const roles: readonly string[] = BRAND_ROLES[kind]
  const rank = (entry: T) => (roles.includes(entry.token) ? roles.indexOf(entry.token) : roles.length)
  return [...entries].sort((a, b) => rank(a) - rank(b))
}

/**
 * Every role of a kind, in role order, each with the kit's entry that fills it. A role whose token
 * the kit holds for the other kind is left out: it can't be set without naming two things.
 */
export function brandRolesOf<K extends KitKind>(kit: BrandKit, kind: K): KitBrandRole<K>[] {
  const own = entriesOf(kit, kind)
  const other = new Set(entriesOf(kit, kind === 'color' ? 'font' : 'color').map((entry) => entry.token))
  return BRAND_ROLES[kind]
    .filter((role) => !other.has(role))
    .map((role) => ({ role, entry: own.find((entry) => entry.token === role) }))
}

/** Whether the kit holds as many colours, or fonts, as a kit may: no role of that kind that isn't set can be. */
export function kitIsFull(kit: BrandKit, kind: KitKind) {
  return entriesOf(kit, kind).length >= BRAND_KIT_LIMITS[kind]
}

/**
 * The kit with a role set to a colour, or a font's family: the entry that fills it changes where it
 * is, or one named as the role is added. The same kit for a role it can't set (see `brandRolesOf`),
 * or one that isn't set while the kit is full.
 */
export function withBrandRole(kit: BrandKit, kind: KitKind, role: BrandRole, value: string): BrandKit {
  const found = brandRolesOf(kit, kind).find((r) => r.role === role)
  if (!found || (!found.entry && kitIsFull(kit, kind))) return kit
  if (kind === 'color') {
    const colors = found.entry
      ? kit.colors.map((c) => (c.token === role ? { ...c, value } : c))
      : [...kit.colors, { token: role, name: BRAND_ROLE_NAMES[role], value }]
    return { ...kit, colors }
  }
  const fonts = found.entry
    ? kit.fonts.map((f) => (f.token === role ? { ...f, family: value } : f))
    : [...kit.fonts, { token: role, name: BRAND_ROLE_NAMES[role], family: value }]
  return { ...kit, fonts }
}

/** The kit with a role no longer set; the same kit when it isn't. */
export function withoutBrandRole(kit: BrandKit, kind: KitKind, role: BrandRole): BrandKit {
  if (!brandRolesOf(kit, kind).some((r) => r.role === role && r.entry)) return kit
  return kind === 'color'
    ? { ...kit, colors: kit.colors.filter((c) => c.token !== role) }
    : { ...kit, fonts: kit.fonts.filter((f) => f.token !== role) }
}

/**
 * A token for a colour or font of the brand's own, from its name: "Colour 3" gives colour-3. It is
 * none the kit holds and no role's, the logo's included, so "Text" gives text-2.
 */
export function freeToken(kit: BrandKit, name: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'token'
  const taken = new Set(
    [...kit.colors, ...kit.fonts].map((x) => x.token).concat(Object.values(BRAND_ROLES).flat(), LOGO_ROLE),
  )
  let token = base
  for (let n = 2; taken.has(token); n++) token = `${base}-${n}`
  return token
}

/** A kit's colours, or its fonts. */
function entriesOf<K extends KitKind>(kit: BrandKit, kind: K): readonly KitEntries[K][] {
  const parts: { [P in KitKind]: readonly KitEntries[P][] } = { color: kit.colors, font: kit.fonts }
  return parts[kind]
}
