// A website's font as a family of the brand's font catalog. A family the catalog has (a Google Font, or the brand's
// own upload) is used as is; else the next family the site's CSS names after it, its own fallback, when the catalog
// has that; else the closest Google family: of the same category (from the stack's generic family, else the name's
// words), drawing the weights the site uses, sharing a word of its name that describes a design (Grotesk, Slab,
// Display), and more used. A site's font files are never fetched.
import type { FontFamily, WebsiteFont } from '@dazbee/schema'

/** A site's font as the catalog has it: the family the site names first, the catalog's family, and how it matched. */
export type FontMatch = Omit<WebsiteFont, 'role'>

/** A catalog family as matching reads it. */
interface Candidate {
  family: string
  category: string | null
  rank: number | null
  min: number
  max: number
}

/** The generic families and system fonts a stack may name, each with the category it stands for. */
const GENERIC: Readonly<Record<string, string>> = {
  serif: 'serif',
  'ui-serif': 'serif',
  'sans-serif': 'sans-serif',
  'ui-sans-serif': 'sans-serif',
  'system-ui': 'sans-serif',
  '-apple-system': 'sans-serif',
  blinkmacsystemfont: 'sans-serif',
  'ui-rounded': 'sans-serif',
  monospace: 'monospace',
  'ui-monospace': 'monospace',
  cursive: 'handwriting',
  fantasy: 'display',
  emoji: '',
  math: '',
  fangsong: 'serif',
}
/** The words of a family name that say nothing of its design. */
const PLAIN_WORDS = new Set([
  'sans',
  'serif',
  'pro',
  'std',
  'text',
  'web',
  'webfont',
  'font',
  'var',
  'variable',
  'vf',
  'regular',
  'new',
  'neue',
  'the',
  'ui',
  'one',
  'next',
  'now',
])
/** Endings a site gives a family's name that the family's own name doesn't have. */
const NAME_ENDINGS = /(variable|var|vf|webfont|web)$/
/** The weights a site is taken to use when it names none: regular and bold. */
const USUAL_WEIGHTS = [400, 700]

/**
 * The catalog's family for a font stack as a site's CSS names it, drawing `weights` (the site's own, when known);
 * null for a stack that names no family and for an empty catalog.
 */
export function matchFont(
  stack: readonly string[],
  weights: readonly number[],
  catalog: readonly FontFamily[],
): FontMatch | null {
  const byName = new Map(catalog.map((family) => [nameKey(family.family), family.family]))
  const named = stack.filter((family) => !(family.toLowerCase() in GENERIC))
  const site = named[0] ?? stack.find((family) => GENERIC[family.toLowerCase()]) ?? null
  if (!site || catalog.length === 0) return null
  const same = byName.get(nameKey(site))
  if (same) return { site, family: same, match: 'same' }
  for (const fallback of named.slice(1)) {
    const family = byName.get(nameKey(fallback))
    if (family) return { site, family, match: 'fallback' }
  }
  const closest = closestFamily(site, categoryOf(stack, site), weights.length > 0 ? weights : USUAL_WEIGHTS, catalog)
  return closest ? { site, family: closest, match: 'closest' } : null
}

/** A family's name as names are compared: lower case, letters and digits only, a site's ending such as "var" off. */
function nameKey(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return key.replace(NAME_ENDINGS, '') || key
}

/** The category a stack's font is of: its generic family's, else what its name's words say, else sans-serif. */
function categoryOf(stack: readonly string[], site: string): string {
  for (const family of stack) {
    const generic = GENERIC[family.toLowerCase()]
    if (generic) return generic
  }
  const words = wordsOf(site)
  if (words.some((w) => w === 'mono' || w === 'code')) return 'monospace'
  if (words.some((w) => w === 'script' || w === 'hand')) return 'handwriting'
  if (words.includes('slab') || (words.includes('serif') && !words.includes('sans'))) return 'serif'
  return 'sans-serif'
}

/**
 * The catalog's closest Google family to `site`, of `category` and with an upright face: the one that scores most,
 * two for sharing a word of the name that describes a design, up to one for drawing the site's weights, and up to a
 * half for being used more; the more used of two that score the same.
 */
function closestFamily(site: string, category: string, weights: readonly number[], catalog: readonly FontFamily[]) {
  const words = new Set(wordsOf(site).filter((word) => word.length >= 3 && !PLAIN_WORDS.has(word)))
  let best: { family: string; score: number; rank: number } | null = null
  for (const candidate of catalog.flatMap(candidateOf)) {
    if (candidate.category !== category) continue
    const shares = wordsOf(candidate.family).some((word) => words.has(word)) ? 2 : 0
    const drawn = weights.filter((w) => w >= candidate.min && w <= candidate.max).length / weights.length
    const used = candidate.rank ? 0.5 / (1 + Math.log10(candidate.rank)) : 0
    const score = shares + drawn + used
    const rank = candidate.rank ?? Infinity
    if (!best || score > best.score || (score === best.score && rank < best.rank))
      best = { family: candidate.family, score, rank }
  }
  return best?.family ?? null
}

/** A Google family with an upright face, drawing Latin when its scripts are known, as matching reads it. */
function candidateOf(family: FontFamily): Candidate[] {
  const upright = family.faces.filter((face) => face.style === 'normal')
  if (family.source !== 'google' || upright.length === 0) return []
  if (family.scripts && !family.scripts.includes('Latn')) return []
  return [
    {
      family: family.family,
      category: family.category,
      rank: family.rank ?? null,
      min: Math.min(...upright.map((face) => face.weights?.min ?? face.weight)),
      max: Math.max(...upright.map((face) => face.weights?.max ?? face.weight)),
    },
  ]
}

/** A family name's words, lower case: split at spaces, dashes and where a capital follows a small letter. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}
