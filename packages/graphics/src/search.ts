// Finding bundled icons, stickers, illustrations and artwork by words: each word of the query is matched against a graphic's name, then its
// tags and categories, and the graphics that match every word are ranked, the sets taking turns so each set's best show.
import { artworks } from './artwork.ts'
import { ARTWORK_SETS, type ArtworkKind, type ArtworkSetId, isArtworkSet } from './artwork-sets.ts'
import { readBundled } from './bundled.ts'
import { illustrations } from './illustrations.ts'
import {
  GRAPHIC_SET_IDS,
  type GraphicKind,
  type GraphicSetId,
  type IconSetId,
  ILLUSTRATION_SETS,
  type IllustrationSetId,
  isIconSet,
  isIllustrationSet,
  kindOfSet,
  type StickerSetId,
} from './sets.ts'

/**
 * One graphic as a search index holds it: its name, the styles it is drawn in, its tags with its categories, and for
 * an illustration the topics its words put it in, which match a little less than its own words.
 */
export type IndexedGraphic = [name: string, styles: string[], tags: string[], topics?: string[]]

/** The icons' search index (`sets/index.json`): each icon set's icons. */
export type IconIndex = Record<IconSetId, IndexedGraphic[]>

/** The stickers' search index (`sets/stickers.json`): each sticker set's stickers. */
export type StickerIndex = Record<StickerSetId, IndexedGraphic[]>

/** A graphic as a search finds it: its kind with its set, and what every graphic has. */
export type FoundGraphic = (
  | { kind: 'icon'; set: IconSetId }
  | { kind: 'sticker'; set: StickerSetId }
  | { kind: 'illustration'; set: IllustrationSetId }
  | { kind: ArtworkKind; set: ArtworkSetId }
) & {
  /** Its id, the set and the name: `tabler/shopping-cart`, `fluent-emoji/rocket`, `undraw/delivery`, `coolshapes/star-1`. */
  id: string
  name: string
  /** The styles it is drawn in, the one placed when none is asked for first. */
  styles: string[]
  tags: string[]
}

/** What a search may be narrowed to. */
export interface GraphicSearch {
  kind?: GraphicKind
  set?: GraphicSetId
  /** How many graphics it gives at most. */
  limit: number
}

/** What a match on each part of a graphic scores, per word of the query. */
const SCORE = { name: 10, namePrefix: 6, tag: 4, topic: 3, tagPrefix: 2, wholeName: 20 } as const
/** The shortest word that matches the start of a longer one, in an icon's or a sticker's name or tags. */
const MIN_PREFIX = 2
/** What parts words: anything but a letter or a digit. */
export const WORD_BREAK = /[^\p{L}\p{N}]+/u

/** The indexes, each read once on the first search that needs it. */
let icons: IconIndex | undefined
let stickers: StickerIndex | undefined
let illustrationIndex: Partial<Record<IllustrationSetId, IndexedGraphic[]>> | undefined
let artworkIndex: Partial<Record<ArtworkSetId, IndexedGraphic[]>> | undefined

/**
 * The graphics that match every word of `query`, best first, the sets taking turns: every set's, or only those of
 * the kind or the set asked for.
 */
export function searchGraphics(query: string, { kind, set, limit }: GraphicSearch): FoundGraphic[] {
  const words = wordsOf(query)
  if (words.length === 0) return []
  const sets = GRAPHIC_SET_IDS.filter((id) => (set ? id === set : !kind || kindOfSet(id) === kind))
  const ranked = sets.map((id) =>
    graphicsOf(id)
      .flatMap((graphic) => {
        const score = scoreOf(graphic, words, isIconSet(id) || kindOfSet(id) === 'sticker')
        return score > 0 ? [{ graphic, score }] : []
      })
      .sort((a, b) => b.score - a.score || simpler(a.graphic[0], b.graphic[0]))
      .map(({ graphic }) => found(id, graphic)),
  )
  const merged: FoundGraphic[] = []
  for (let rank = 0; merged.length < limit && ranked.some((list) => rank < list.length); rank++)
    for (const list of ranked) {
      const graphic = list[rank]
      if (graphic && merged.length < limit) merged.push(graphic)
    }
  return merged
}

/** The icon, sticker or illustration with the id `id` (`tabler/shopping-cart`); undefined when no set has it. */
export function findGraphic(id: string): FoundGraphic | undefined {
  const [set, name, ...rest] = id.split('/')
  const known = GRAPHIC_SET_IDS.find((each) => each === set)
  if (rest.length > 0 || !known || !name) return undefined
  const graphic = graphicsOf(known).find(([each]) => each === name)
  return graphic && found(known, graphic)
}

/** A plural word's singular, as English mostly makes it; the word itself otherwise. */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** A query's words: lowercase letters and digits. */
function wordsOf(query: string): string[] {
  return query.toLowerCase().split(WORD_BREAK).filter(Boolean)
}

/** A set's graphics, from its kind's index, read from `sets/` or its manifest the first time. */
function graphicsOf(set: GraphicSetId): IndexedGraphic[] {
  if (isArtworkSet(set)) {
    artworkIndex ??= {}
    artworkIndex[set] ??= artworks()
      .filter((artwork) => artwork.set === set)
      .map(({ name, tags, files }) => [name, ARTWORK_SETS[set].styles.filter((style) => style in files), tags])
    return artworkIndex[set]
  }
  if (isIconSet(set)) {
    icons ??= readBundled('index.json') as IconIndex
    return icons[set]
  }
  if (isIllustrationSet(set)) {
    illustrationIndex ??= {}
    illustrationIndex[set] ??= illustrations()
      .filter((illustration) => illustration.set === set)
      .map(({ name, tags, topics }) => [name, [ILLUSTRATION_SETS[set].style], tags, topics])
    return illustrationIndex[set]
  }
  stickers ??= readBundled('stickers.json') as StickerIndex
  return stickers[set]
}

/**
 * How well a graphic matches every word, each word scored by its best match, a plural by its singular either way; 0 when a
 * word matches nothing. With `prefixes`, a word also matches the start of a longer name or tag word; an illustration's
 * and an artwork graphic's words match only whole, so “app” doesn't find an apple.
 */
function scoreOf([name, , tags, topics = []]: IndexedGraphic, words: string[], prefixes: boolean): number {
  const parts = {
    name: withSingulars(name.split('-')),
    tags: withSingulars(tags.flatMap((tag) => [tag, ...tag.split(WORD_BREAK)])),
    topics,
    prefixes,
  }
  let total = name === words.join('-') ? SCORE.wholeName : 0
  for (const word of words) {
    const score = wordScore(word, parts) || wordScore(singular(word), parts)
    if (score === 0) return 0
    total += score
  }
  return total
}

/** Words with the singular of each plural among them, so a plural in a name matches its singular in a query. */
function withSingulars(words: string[]): string[] {
  return [...new Set(words.flatMap((word) => [word, singular(word)]))]
}

/** A word's best match among a graphic's name words, tag words and topics. */
function wordScore(
  word: string,
  { name, tags, topics, prefixes }: { name: string[]; tags: string[]; topics: string[]; prefixes: boolean },
): number {
  if (name.includes(word)) return SCORE.name
  const prefix = (each: string) => prefixes && word.length >= MIN_PREFIX && each.startsWith(word)
  if (name.some(prefix)) return SCORE.namePrefix
  if (tags.includes(word)) return SCORE.tag
  if (topics.includes(word)) return SCORE.topic
  return tags.some(prefix) ? SCORE.tagPrefix : 0
}

/** Orders names of equal score: fewer words first, then shorter, then alphabetically. */
function simpler(a: string, b: string): number {
  return a.split('-').length - b.split('-').length || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/** An indexed graphic as a search gives it. */
function found(set: GraphicSetId, [name, styles, tags, topics = []]: IndexedGraphic): FoundGraphic {
  const what = { id: `${set}/${name}`, name, styles, tags: [...new Set([...tags, ...topics])] }
  if (isIconSet(set)) return { kind: 'icon', set, ...what }
  if (isIllustrationSet(set)) return { kind: 'illustration', set, ...what }
  if (isArtworkSet(set)) return { kind: ARTWORK_SETS[set].kind, set, ...what }
  return { kind: 'sticker', set, ...what }
}
