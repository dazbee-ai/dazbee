// Finding bundled icons and stickers by words: each word of the query is matched against a graphic's name, then its
// tags and categories, and the graphics that match every word are ranked, the sets taking turns so each set's best show.
import { readBundled } from './bundled.ts'
import {
  GRAPHIC_SET_IDS,
  type GraphicKind,
  type GraphicSetId,
  type IconSetId,
  kindOf,
  type StickerSetId,
} from './sets.ts'

/** One graphic as a search index holds it: its name, the styles it is drawn in, and its tags with its categories. */
export type IndexedGraphic = [name: string, styles: string[], tags: string[]]

/** The icons' search index (`sets/index.json`): each icon set's icons. */
export type IconIndex = Record<IconSetId, IndexedGraphic[]>

/** The stickers' search index (`sets/stickers.json`): each sticker set's stickers. */
export type StickerIndex = Record<StickerSetId, IndexedGraphic[]>

/** An icon or a sticker as a search finds it. */
export interface FoundGraphic {
  /** Its id, the set and the name: `tabler/shopping-cart`, `fluent-emoji/rocket`. */
  id: string
  kind: GraphicKind
  set: GraphicSetId
  name: string
  /** The styles it is drawn in, the one placed when none is asked for first. */
  styles: string[]
  tags: string[]
}

/** What a search may be narrowed to. */
export interface GraphicSearch {
  kind?: GraphicKind
  set?: GraphicSetId
  /** How many icons it gives at most. */
  limit: number
}

/** What a match on each part of an icon scores, per word of the query. */
const SCORE = { name: 10, namePrefix: 6, tag: 4, tagPrefix: 2, wholeName: 20 } as const
/** The shortest word that matches the start of a longer one. */
const MIN_PREFIX = 2
/** What parts words: anything but a letter or a digit. */
const WORD_BREAK = /[^\p{L}\p{N}]+/u

/** The indexes, each read once on the first search that needs it. */
let icons: IconIndex | undefined
let stickers: StickerIndex | undefined

/**
 * The graphics that match every word of `query`, best first, the sets taking turns: every set's, or only those of
 * the kind or the set asked for.
 */
export function searchGraphics(query: string, { kind, set, limit }: GraphicSearch): FoundGraphic[] {
  const words = wordsOf(query)
  if (words.length === 0) return []
  const sets = GRAPHIC_SET_IDS.filter((id) => (set ? id === set : !kind || kindOf(id) === kind))
  const ranked = sets.map((id) =>
    graphicsOf(id)
      .flatMap((icon) => {
        const score = scoreOf(icon, words)
        return score > 0 ? [{ icon, score }] : []
      })
      .sort((a, b) => b.score - a.score || simpler(a.icon[0], b.icon[0]))
      .map(({ icon }) => found(id, icon)),
  )
  const merged: FoundGraphic[] = []
  for (let rank = 0; merged.length < limit && ranked.some((list) => rank < list.length); rank++)
    for (const list of ranked) {
      const icon = list[rank]
      if (icon && merged.length < limit) merged.push(icon)
    }
  return merged
}

/** The icon or sticker with the id `id` (`tabler/shopping-cart`); undefined when no set has it. */
export function findGraphic(id: string): FoundGraphic | undefined {
  const [set, name, ...rest] = id.split('/')
  const known = GRAPHIC_SET_IDS.find((each) => each === set)
  if (rest.length > 0 || !known || !name) return undefined
  const graphic = graphicsOf(known).find(([each]) => each === name)
  return graphic && found(known, graphic)
}

/** A query's words: lowercase letters and digits. */
function wordsOf(query: string): string[] {
  return query.toLowerCase().split(WORD_BREAK).filter(Boolean)
}

/** A set's graphics, from its kind's index, read from `sets/` the first time. */
function graphicsOf(set: GraphicSetId): IndexedGraphic[] {
  if (kindOf(set) === 'icon') {
    icons ??= readBundled('index.json') as IconIndex
    return icons[set as IconSetId]
  }
  stickers ??= readBundled('stickers.json') as StickerIndex
  return stickers[set as StickerSetId]
}

/** How well an icon matches every word, each word scored by its best match, or a plural by its singular; 0 when a word matches nothing. */
function scoreOf([name, , tags]: IndexedGraphic, words: string[]): number {
  const nameWords = name.split('-')
  const tagWords = tags.flatMap((tag) => [tag, ...tag.split(WORD_BREAK)])
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

/** An indexed graphic as a search gives it. */
function found(set: GraphicSetId, [name, styles, tags]: IndexedGraphic): FoundGraphic {
  return { id: `${set}/${name}`, kind: kindOf(set), set, name, styles, tags }
}
