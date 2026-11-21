// Finding bundled icons by words: each word of the query is matched against an icon's name, then its tags and
// categories, and the icons that match every word are ranked, the sets taking turns so each set's best show.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ICON_SET_IDS, ICON_SETS, type IconSetId } from './sets.ts'

/** One icon as the search index holds it: its name, the styles it is drawn in, and its tags with its categories. */
export type IndexedIcon = [name: string, styles: string[], tags: string[]]

/** The search index: each set's icons. */
export type IconIndex = Record<IconSetId, IndexedIcon[]>

/** An icon as a search finds it. */
export interface FoundIcon {
  /** Its id, the set and the name: `tabler/shopping-cart`. */
  graphic: string
  set: IconSetId
  name: string
  /** The styles it is drawn in, the one placed when none is asked for first. */
  styles: string[]
  tags: string[]
}

/** What a search may be narrowed to. */
export interface IconSearch {
  set?: IconSetId
  /** How many icons it gives at most. */
  limit: number
}

/** What a match on each part of an icon scores, per word of the query. */
const SCORE = { name: 10, namePrefix: 6, tag: 4, tagPrefix: 2, wholeName: 20 } as const
/** The shortest word that matches the start of a longer one. */
const MIN_PREFIX = 2

/** The index, read once on the first search. */
let loaded: IconIndex | undefined

/** The icons that match every word of `query`, best first, the sets taking turns unless one is asked for. */
export function searchIcons(query: string, { set, limit }: IconSearch): FoundIcon[] {
  const words = wordsOf(query)
  if (words.length === 0) return []
  const index = iconIndex()
  const ranked = (set ? [set] : ICON_SET_IDS).map((id) =>
    index[id]
      .flatMap((icon) => {
        const score = scoreOf(icon, words)
        return score > 0 ? [{ icon, score }] : []
      })
      .sort((a, b) => b.score - a.score || simpler(a.icon[0], b.icon[0]))
      .map(({ icon }) => found(id, icon)),
  )
  const merged: FoundIcon[] = []
  for (let rank = 0; merged.length < limit && ranked.some((list) => rank < list.length); rank++)
    for (const list of ranked) {
      const icon = list[rank]
      if (icon && merged.length < limit) merged.push(icon)
    }
  return merged
}

/** The icon with the id `graphic` (`tabler/shopping-cart`); undefined when no set has it. */
export function findIcon(graphic: string): FoundIcon | undefined {
  const [set, name, ...rest] = graphic.split('/')
  if (rest.length > 0 || !set || !name || !Object.hasOwn(ICON_SETS, set)) return undefined
  const icon = iconIndex()[set as IconSetId].find(([each]) => each === name)
  return icon && found(set as IconSetId, icon)
}

/** The index, read from `sets/index.json` the first time. */
function iconIndex(): IconIndex {
  loaded ??= JSON.parse(readFileSync(join(import.meta.dirname, '..', 'sets', 'index.json'), 'utf8')) as IconIndex
  return loaded
}

/** A query's words: lowercase letters and digits. */
function wordsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** How well an icon matches every word, each word scored by its best match, or a plural by its singular; 0 when a word matches nothing. */
function scoreOf([name, , tags]: IndexedIcon, words: string[]): number {
  const nameWords = name.split('-')
  const tagWords = tags.flatMap((tag) => [tag, ...tag.split(/[^\p{L}\p{N}]+/u)])
  let total = name === words.join('-') ? SCORE.wholeName : 0
  for (const word of words) {
    const score = wordScore(word, nameWords, tagWords) || wordScore(singular(word), nameWords, tagWords)
    if (score === 0) return 0
    total += score
  }
  return total
}

/** A word's best match among an icon's name words and tag words. */
function wordScore(word: string, nameWords: string[], tagWords: string[]): number {
  if (nameWords.includes(word)) return SCORE.name
  const prefix = (each: string) => word.length >= MIN_PREFIX && each.startsWith(word)
  if (nameWords.some(prefix)) return SCORE.namePrefix
  if (tagWords.includes(word)) return SCORE.tag
  return tagWords.some(prefix) ? SCORE.tagPrefix : 0
}

/** A plural word's singular, as English mostly makes it; the word itself otherwise. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Orders names of equal score: fewer words first, then shorter, then alphabetically. */
function simpler(a: string, b: string): number {
  return a.split('-').length - b.split('-').length || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/** An indexed icon as a search gives it. */
function found(set: IconSetId, [name, styles, tags]: IndexedIcon): FoundIcon {
  return { graphic: `${set}/${name}`, set, name, styles, tags }
}
