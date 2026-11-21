// A brand kit filled from the brand's website: the site read, its logo added to the brand's asset library
// through the checks a picture from a link gets, and the kit's empty roles filled, or with `replace` every role the
// site gives, saved over the kit as it was read.
import type { Db } from '@dazbee/db'
import {
  type AssetSummary,
  BRAND_ROLES,
  type BrandFromWebsite,
  type BrandFromWebsiteAnswer,
  type BrandKit,
  brandRolesOf,
  LOGO_ROLE,
  type StoredBrandKit,
  WEBSITE_READ_TIMEOUT_MS,
  type WebsiteRole,
  withBrandRole,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { InvalidUpload } from '../assets/assets.ts'
import { addingFromOutside, AddingFromUrlBusy, recordFetched } from '../assets/from-url.ts'
import { SvgBusy } from '../assets/svg-assets.ts'
import { FetchRefused, type SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { listFonts } from '../fonts/fonts.ts'
import { getBrandKit, InvalidKit, saveBrandKit } from './brand-kits.ts'
import type { LogoSource } from './site-page.ts'
import { fetchLogo, readWebsite, type Website } from './website.ts'

/** Dazbee is reading as many websites as it reads at once; this one is refused until one ends. */
export class ReadingWebsitesBusy extends Error {
  constructor() {
    super('Dazbee is reading other websites; try again in a moment')
  }
}

/** A logo a read added to the asset library, and where on the site it came from. */
interface AddedLogo {
  asset: AssetSummary
  source: LogoSource
}

/** The websites a member may read into kits in an hour, themselves and their agents together. */
export const WEBSITES_PER_HOUR = 20

/** The most websites read at once in the process, as each holds its page and CSS while it is read. */
const MAX_READING_AT_ONCE = 4
/** The most logos tried that need a fetch; the logo in a page's markup needs none. */
const MAX_LOGO_FETCHES = 2
/** How many times a save is tried again when the kit was saved by someone else meanwhile. */
const SAVE_ATTEMPTS = 3

/** The websites being read now. */
let reading = 0

/**
 * Reads the website at `input.url` into the brand's kit: its logo, colours and fonts fill the roles the kit hasn't
 * set, and with `input.replace` the roles it has too; a site's font that isn't in the brand's catalog becomes the
 * closest family that is. It answers what the site gave and what changed. It throws `FetchRefused` for a page that
 * can't be read and `ReadingWebsitesBusy` past `MAX_READING_AT_ONCE`.
 */
export async function brandFromWebsite(
  db: Db,
  storage: Storage,
  outside: SafeFetchSettings,
  workspaceId: string,
  brandId: string,
  input: BrandFromWebsite,
): Promise<BrandFromWebsiteAnswer> {
  if (readingWebsitesBusy()) throw new ReadingWebsitesBusy()
  reading++
  try {
    const until = Date.now() + WEBSITE_READ_TIMEOUT_MS
    const link = websiteLink(input.url)
    const replace = input.replace ?? false
    const before = await getBrandKit(db, workspaceId, brandId)
    if (!replace && allSet(before))
      return {
        ...nothingRead(link, before),
        notes: ['Every role a website fills is set in this kit already; ask again with replace to replace them'],
      }
    const catalog = await listFonts(db, workspaceId, brandId)
    const wantLogo = replace || !before.logoAssetId
    const website = await readWebsite(link, outside, catalog, { logos: wantLogo, until })
    const notes = [...website.notes]
    const added = wantLogo ? await addLogo(db, storage, outside, workspaceId, brandId, website, notes) : null
    const logo = added?.asset ?? null
    if (wantLogo && website.logos.length === 0)
      notes.push('Dazbee found no logo on the site that it can add; ask the person for their logo file')
    let kit: StoredBrandKit = before
    for (let attempt = 1; ; attempt++) {
      const filled = fillKit(kit, website, logo, replace)
      const saved = filled.filled.length === 0 ? kit : await saveBrandKit(db, workspaceId, brandId, filled.kit)
      if (saved !== 'changed') return answerOf(website, saved, filled, added, notes)
      if (attempt === SAVE_ATTEMPTS)
        throw new InvalidKit('The brand kit kept changing while Dazbee read the site; ask again')
      kit = await getBrandKit(db, workspaceId, brandId)
    }
  } finally {
    reading--
  }
}

/** Whether Dazbee is reading as many websites as it reads at once, so that another would be refused. */
export function readingWebsitesBusy(): boolean {
  return reading >= MAX_READING_AT_ONCE
}

/** A website's address as a link to read: https added when it names no scheme, and an http link read over https. */
function websiteLink(text: string): string {
  const trimmed = text.trim()
  if (/^http:\/\//i.test(trimmed)) return `https://${trimmed.slice(7)}`
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Whether the kit sets the logo and every colour and font role. */
function allSet(kit: BrandKit): boolean {
  return (
    Boolean(kit.logoAssetId) &&
    brandRolesOf(kit, 'color').every((role) => role.entry) &&
    brandRolesOf(kit, 'font').every((role) => role.entry)
  )
}

/** The answer of a read that read nothing, as the kit is set already. */
function nothingRead(link: string, kit: StoredBrandKit): Omit<BrandFromWebsiteAnswer, 'notes'> {
  return {
    site: link,
    kit,
    filled: [],
    kept: [],
    colors: {},
    fonts: [],
    logo: null,
    candidates: { logo: null, shareImage: null },
  }
}

/**
 * The first of the site's logos the asset library takes, added as a picture from a link is, named for the site and
 * tagged logo; at most `MAX_LOGO_FETCHES` are fetched. Each logo refused is noted.
 */
async function addLogo(
  db: Db,
  storage: Storage,
  outside: SafeFetchSettings,
  workspaceId: string,
  brandId: string,
  website: Website,
  notes: string[],
): Promise<AddedLogo | null> {
  let fetches = 0
  for (const source of website.logos) {
    if (source.kind === 'link' && fetches++ >= MAX_LOGO_FETCHES) break
    try {
      // Fetched before taking the place for adding a picture, so a slow site holds no one else's.
      const file =
        source.kind === 'svg'
          ? { bytes: new TextEncoder().encode(source.markup), contentType: 'image/svg+xml', url: website.site }
          : await fetchLogo(source.url, website.budget, outside)
      const asset = await addingFromOutside(() =>
        recordFetched(db, storage, workspaceId, brandId, file, { name: `${website.name} logo`, tags: ['logo'] }),
      )
      return { asset, source }
    } catch (error) {
      if (error instanceof AddingFromUrlBusy || error instanceof SvgBusy) {
        notes.push(`Dazbee is busy adding other pictures, so it didn’t add the site’s logo; ask again in a moment`)
        return null
      }
      if (!(error instanceof FetchRefused || error instanceof InvalidUpload)) throw error
      notes.push(`Dazbee couldn’t add ${logoName(source)}: ${error.message}`)
    }
  }
  return null
}

/** How a logo is named in a note. */
function logoName(source: LogoSource): string {
  return source.kind === 'svg' ? 'the logo drawn in the site’s header' : `the logo at ${source.url}`
}

/** The kit with the website's roles in it, and the roles it filled and the ones it kept. */
function fillKit(kit: StoredBrandKit, website: Website, logo: AssetSummary | null, replace: boolean) {
  let next: BrandKit = {
    colors: kit.colors,
    fonts: kit.fonts,
    logoAssetId: kit.logoAssetId,
    voice: kit.voice,
    textStyles: kit.textStyles,
  }
  const filled: WebsiteRole[] = []
  const kept: WebsiteRole[] = []
  if (website.logos.length > 0) {
    if (kit.logoAssetId && !replace) kept.push(LOGO_ROLE)
    else if (logo && logo.id !== kit.logoAssetId) {
      next = { ...next, logoAssetId: logo.id }
      filled.push(LOGO_ROLE)
    }
  }
  const roles = [
    ...BRAND_ROLES.color.map((role) => ({ kind: 'color' as const, role, value: website.colors[role] })),
    ...BRAND_ROLES.font.map((role) => ({
      kind: 'font' as const,
      role,
      value: website.fonts.find((f) => f.role === role)?.family,
    })),
  ]
  for (const { kind, role, value } of roles) {
    if (!value) continue
    const set = brandRolesOf(next, kind).find((r) => r.role === role)?.entry
    const now = set && ('value' in set ? set.value : set.family)
    if (now === value) continue
    if (set && !replace) {
      kept.push(role)
      continue
    }
    const changed = withBrandRole(next, kind, role, value)
    if (changed !== next) filled.push(role)
    next = changed
  }
  return { kit: { ...next, basedOn: kit.updatedAt }, filled, kept }
}

/** What the read answers: the site's other logo at a link is offered for adding by link. */
function answerOf(
  website: Website,
  kit: StoredBrandKit,
  { filled, kept }: { filled: WebsiteRole[]; kept: WebsiteRole[] },
  added: AddedLogo | null,
  notes: string[],
): BrandFromWebsiteAnswer {
  const other = website.logos.find((source) => source.kind === 'link' && source !== added?.source)
  return {
    site: website.site,
    kit,
    filled,
    kept,
    colors: website.colors,
    fonts: website.fonts,
    logo: added?.asset ?? null,
    candidates: { logo: other?.kind === 'link' ? other.url : null, shareImage: website.shareImage },
    notes,
  }
}
