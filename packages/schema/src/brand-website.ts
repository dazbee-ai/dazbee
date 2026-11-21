// A brand kit filled from the brand's website: what is asked, and what the API answers.
import { z } from 'zod'

import { AssetSummary, MAX_URL_LENGTH, StoredBrandKit } from './api.ts'
import { BRAND_ROLES, LOGO_ROLE } from './brand-roles.ts'
import { Color } from './primitives.ts'

/** How long reading a website's files may take together, before its logo is recorded and its kit saved. */
export const WEBSITE_READ_TIMEOUT_MS = 30_000

/** Reads the website at `url` into the brand's kit: its empty roles, and with `replace` the roles already set too. */
export const BrandFromWebsite = z.object({
  url: z.string().trim().min(1).max(MAX_URL_LENGTH),
  replace: z.boolean().optional(),
})
export type BrandFromWebsite = z.infer<typeof BrandFromWebsite>

/** A brand role a website can fill: the logo, a colour role or a font role. */
export const WebsiteRole = z.enum([LOGO_ROLE, ...BRAND_ROLES.color, ...BRAND_ROLES.font])
export type WebsiteRole = z.infer<typeof WebsiteRole>

/**
 * How a site's font became a family of the catalog: `same` when the catalog has the site's own family, `fallback`
 * when it has the next family the site's CSS names after it, `closest` when it is the closest the catalog has.
 */
export const FontMatchKind = z.enum(['same', 'fallback', 'closest'])
export type FontMatchKind = z.infer<typeof FontMatchKind>

/** A font role as the site sets it: the family the site names, and the catalog's family for it. */
export const WebsiteFont = z.object({
  role: z.enum(BRAND_ROLES.font),
  /** The family the site's CSS names first for the role, or a system font's name. */
  site: z.string(),
  family: z.string(),
  match: FontMatchKind,
})
export type WebsiteFont = z.infer<typeof WebsiteFont>

/** What reading a website found, and what it changed in the brand's kit. */
export const BrandFromWebsiteAnswer = z.object({
  /** The page read, after its redirects. */
  site: z.string(),
  /** The kit as the read left it. */
  kit: StoredBrandKit,
  /** The roles the read set. */
  filled: WebsiteRole.array(),
  /** The roles the site has that were already set, and kept as they were. */
  kept: WebsiteRole.array(),
  /** The site's colour for each colour role it gives one. */
  colors: z.partialRecord(z.enum(BRAND_ROLES.color), Color),
  fonts: WebsiteFont.array(),
  /** The logo the read added to the brand's asset library; none when it added none. */
  logo: AssetSummary.nullable(),
  /** Pictures the site offers that weren't added: an https link each, for adding by link. */
  candidates: z.object({ logo: z.string().nullable(), shareImage: z.string().nullable() }),
  /** What the read couldn't do, each in a sentence. */
  notes: z.string().array(),
})
export type BrandFromWebsiteAnswer = z.infer<typeof BrandFromWebsiteAnswer>
