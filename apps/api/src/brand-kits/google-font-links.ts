// The families a Google Fonts link loads, with the weights it asks for, read from the link alone: Dazbee never
// fetches Google's CSS for them, as its catalog holds Google's families already.
import { MAX_URL_LENGTH } from '@dazbee/schema'

/** A family a Google Fonts link loads, with the weights it asks for. */
export interface GoogleFontFamily {
  family: string
  weights: number[]
}

/** The most families a site's Google Fonts links give, all its links together. */
export const MAX_GOOGLE_FAMILIES = 20

/**
 * Adds the families a Google Fonts link loads to `families`, while they are fewer than `MAX_GOOGLE_FAMILIES`.
 */
export function addGoogleFonts(families: GoogleFontFamily[], link: string) {
  if (families.length < MAX_GOOGLE_FAMILIES)
    families.push(...googleFontsOf(link).slice(0, MAX_GOOGLE_FAMILIES - families.length))
}

/**
 * The families a Google Fonts link loads, with the weights it asks for: the css2 API's `family=Name:wght@400;700`
 * (or `ital,wght@0,400;1,700`) and the first API's `family=Name:400,700italic|Other`, at most `MAX_GOOGLE_FAMILIES`.
 * Nothing for any other link, or one longer than a link may be.
 */
export function googleFontsOf(link: string): GoogleFontFamily[] {
  const url = link.length > MAX_URL_LENGTH ? null : URL.parse(link)
  if (!url || url.hostname !== 'fonts.googleapis.com') return []
  const families: GoogleFontFamily[] = []
  for (const param of url.searchParams.getAll('family'))
    for (const spec of param.split('|')) {
      if (families.length === MAX_GOOGLE_FAMILIES) return families
      const [name = '', axes = ''] = spec.split(':', 2)
      const family = name.trim().slice(0, 100)
      if (family) families.push({ family, weights: weightsOf(axes) })
    }
  return families
}

/** The weights a Google Fonts family's spec asks for: each `wght` value, a range's ends, or the old API's list. */
function weightsOf(spec: string): number[] {
  const weights = new Set<number>()
  const [axes = '', values] = spec.includes('@') ? spec.split('@', 2) : ['', spec]
  const names = axes.split(',')
  const wght = axes ? names.indexOf('wght') : -1
  for (const tuple of (values ?? '').split(axes ? ';' : ',').slice(0, 50)) {
    const parts = axes ? tuple.split(',') : [tuple]
    const value = wght >= 0 ? parts[wght] : axes ? undefined : parts[0]
    for (const end of (value ?? '').split('..')) {
      const weight = Number.parseInt(end, 10)
      if (weight >= 1 && weight <= 1000) weights.add(weight)
    }
  }
  return [...weights].sort((a, b) => a - b)
}
