// Pixabay's search API, Dazbee's stock library: searches, and look-ups of one photo by its id. Each answer is kept
// 24 hours, as Pixabay's terms ask, and shared by every request that asks for it meanwhile, those asking at once
// included. Requests are kept to `perMinute` a minute in this process, and none is sent before the time Pixabay names
// once it turns one away. The key goes only in each request's address: no answer or log line holds it.
import { z } from 'zod'

import {
  serverText,
  STOCK_PHOTO_MAX_SIDE,
  STOCK_SOURCE,
  type StockPhoto,
  type StockPhotoId,
  type StockResults,
  type StockSearch,
} from '@dazbee/schema'

import { requestLimit } from '../admin/waiting-list.ts'
import { logEvent } from '../log.ts'

/** The stock library the routes search and save photos from. */
export interface StockLibrary {
  /** The photos a search finds, best first, naming the library. */
  search(search: StockSearch): Promise<StockResults>
  /**
   * The photo of `id`, to download: as kept from a search or an earlier look-up, unless `fresh` asks Pixabay again.
   * It throws `StockRefused` for an id Pixabay has no photo for.
   */
  photo(id: StockPhotoId, options?: { fresh?: boolean }): Promise<StockDownload>
}

/** A photo to save: the link of its largest picture Dazbee may download, its name, and who took it. */
export interface StockDownload {
  link: string
  name: string
  photographer: string
  /** Whether it was kept from an earlier request, so its link may have lapsed since. */
  kept: boolean
}

/** How the Pixabay client reaches Pixabay. */
export interface PixabaySettings {
  key: string
  /** Sends a request; the global `fetch` unless given. */
  fetch?: typeof fetch
  /** The clock answers are kept and requests counted by; `Date.now` unless given. */
  now?: () => number
  /** The most requests sent in a minute; `PIXABAY_PER_MINUTE` unless given. */
  perMinute?: number
  /** The address of Pixabay's search API; `PIXABAY_URL` unless given. */
  url?: string
}

/** A search or save the stock library can't answer, in a sentence, with the status it is answered with. */
export class StockRefused extends Error {
  readonly status: 400 | 429 | 502
  constructor(message: string, status: 400 | 429 | 502) {
    super(message)
    this.status = status
  }
}

/** The environment variable that holds Pixabay's key; stock search is off without it. */
export const PIXABAY_KEY_SETTING = 'PIXABAY_API_KEY'
/** The most requests Pixabay takes from one key in a minute. */
export const PIXABAY_PER_MINUTE = 100
/** The address of Pixabay's search API. */
export const PIXABAY_URL = 'https://pixabay.com/api/'
/** What a search or save is answered when the server has no Pixabay key. */
export const STOCK_OFF =
  'Stock photo search is off on this Dazbee server (it has no Pixabay key), so trying again won’t help; use pictures from links or the brand’s own images instead'

/** A photo as Pixabay's API answers it: the fields Dazbee reads. */
const PixabayHit = z.object({
  id: z.number().int().positive(),
  pageURL: z.url(),
  tags: z.string(),
  previewURL: z.url(),
  largeImageURL: z.url(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  user: z.string(),
})
type PixabayHit = z.infer<typeof PixabayHit>

/** Answers kept, by what was asked: when each was asked, and its photos, while asked too; and how many are kept at most. */
interface Kept {
  answers: Map<string, { at: number; hits: Promise<PixabayHit[]> }>
  most: number
}

/** Pixabay's answer to a search or a look-up. */
const PixabayAnswer = z.object({ hits: z.array(PixabayHit) })

/** How long an answer is kept, as Pixabay's terms ask. */
const KEEP_MS = 24 * 60 * 60 * 1000
/**
 * The most searches kept, about 15 KB each at most, so that searches can't fill the API's memory; the oldest goes
 * first.
 */
const MAX_SEARCHES_KEPT = 2_000
/** The most photos kept on their own, each shared with the search that found it. */
const MAX_PHOTOS_KEPT = 40_000
/** How many photos a search answers. */
const PER_PAGE = 20
/** How many of a photo's tags a search tells. */
const TAGS_TOLD = 10
/** How long a saved photo's name made from its tags is at most, in characters. */
const NAME_LENGTH = 48
/** How long Pixabay may take to answer. */
const TIMEOUT_MS = 10_000
/** The window requests are counted in. */
const MINUTE_MS = 60_000
/** What every request to Pixabay is counted under, as one key's requests are counted together. */
const ALL_REQUESTS = 'pixabay'
/** Each orientation a search keeps to, as Pixabay names it. */
const ORIENTATIONS: Record<NonNullable<StockSearch['orientation']>, string> = {
  any: 'all',
  landscape: 'horizontal',
  portrait: 'vertical',
}

/** The stock library the environment's Pixabay key turns on, or null when it has none. */
export function pixabayFromEnv(env: Readonly<Record<string, string | undefined>>): StockLibrary | null {
  const key = serverText(env, PIXABAY_KEY_SETTING)
  return key ? pixabay({ key }) : null
}

/** The stock library on Pixabay's search API, reached with `settings`. */
export function pixabay({
  key,
  fetch: send = fetch,
  now = Date.now,
  perMinute = PIXABAY_PER_MINUTE,
  url = PIXABAY_URL,
}: PixabaySettings): StockLibrary {
  // The searches kept, by their words, orientation and colour, and the photos kept, by their id.
  const searches: Kept = { answers: new Map(), most: MAX_SEARCHES_KEPT }
  const photos: Kept = { answers: new Map(), most: MAX_PHOTOS_KEPT }
  // The requests sent in the last minute.
  const requests = requestLimit({ perWindow: perMinute, windowMs: MINUTE_MS })
  // Until when no request is sent, as Pixabay said when it turned one away.
  let pausedUntil = 0

  async function search(asked: StockSearch): Promise<StockResults> {
    const q = asked.q.trim().replace(/\s+/g, ' ').toLowerCase()
    const orientation = asked.orientation ?? 'any'
    const params = new URLSearchParams({ q, image_type: 'photo', safesearch: 'true', per_page: String(PER_PAGE) })
    if (orientation !== 'any') params.set('orientation', ORIENTATIONS[orientation])
    if (asked.colour) params.set('colors', asked.colour)
    const { hits } = answer(searches, `${q}|${orientation}|${asked.colour ?? ''}`, params)
    return { source: STOCK_SOURCE, photos: (await hits).map(photoOf) }
  }

  async function photo(id: StockPhotoId, { fresh = false } = {}): Promise<StockDownload> {
    if (fresh) photos.answers.delete(String(id))
    const { hits, wasKept } = answer(photos, String(id), new URLSearchParams({ id: String(id) }))
    const [hit] = await hits
    if (!hit)
      throw new StockRefused(`Pixabay has no photo with the id ${id}; search again and use an id it answers`, 400)
    return { link: hit.largeImageURL, name: nameOf(hit), photographer: hit.user, kept: wasKept }
  }

  /**
   * The photos Pixabay answers `params`: as `kept` under `asked` within the last 24 hours, else asked now and kept;
   * a search's photos are kept on their own too, so saving one asks nothing more. An answer that fails is not kept.
   */
  function answer(
    kept: Kept,
    asked: string,
    params: URLSearchParams,
  ): { hits: Promise<PixabayHit[]>; wasKept: boolean } {
    const at = now()
    const found = kept.answers.get(asked)
    if (found && at - found.at < KEEP_MS) return { hits: found.hits, wasKept: true }
    const lookUp = kept === photos
    const hits = ask(params, lookUp).then((found) => {
      if (!lookUp) for (const hit of found) keep(photos, String(hit.id), at, Promise.resolve([hit]))
      return found
    })
    keep(kept, asked, at, hits)
    hits.catch(() => {
      if (kept.answers.get(asked)?.hits === hits) kept.answers.delete(asked)
    })
    return { hits, wasKept: false }
  }

  /**
   * The photos Pixabay answers to one request of `params`, counted against the requests a minute. A look-up of an id
   * Pixabay doesn't know answers none.
   */
  async function ask(params: URLSearchParams, lookUp: boolean): Promise<PixabayHit[]> {
    const busy = () =>
      new StockRefused(
        `Dazbee has searched Pixabay as often as it may for now (${perMinute} times a minute, as Pixabay asks); try again in a minute`,
        429,
      )
    if (now() < pausedUntil || !requests.take(ALL_REQUESTS, now())) throw busy()
    let response: Response
    try {
      response = await send(`${url}?${new URLSearchParams({ key, ...Object.fromEntries(params) })}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      logEvent('pixabay-unreachable', { error: error instanceof Error ? error.name : 'unknown' })
      throw new StockRefused('Pixabay could not be reached; try again in a moment', 502)
    }
    if (response.status === 429) {
      pausedUntil = now() + resetSeconds(response) * 1000
      throw busy()
    }
    const text = await response.text().catch(() => '')
    if (response.status === 400 && lookUp && /\bid\b/i.test(text)) return []
    if (!response.ok) {
      logEvent('pixabay-refused', { status: response.status })
      throw new StockRefused(`Pixabay refused Dazbee’s search (${response.status}); try again later`, 502)
    }
    const parsed = PixabayAnswer.safeParse(jsonOf(text))
    if (!parsed.success) {
      logEvent('pixabay-unreadable', { status: response.status })
      throw new StockRefused('Pixabay answered something Dazbee can’t read; try again later', 502)
    }
    return parsed.data.hits
  }

  return { search, photo }
}

/** Keeps `hits` in `kept` under `asked` as asked at `at`, letting the oldest answer go past the most it keeps. */
function keep(kept: Kept, asked: string, at: number, hits: Promise<PixabayHit[]>) {
  kept.answers.delete(asked)
  kept.answers.set(asked, { at, hits })
  while (kept.answers.size > kept.most) kept.answers.delete(kept.answers.keys().next().value ?? '')
}

/** A photo as a search answers it, with the size its largest picture Dazbee may download has. */
function photoOf(hit: PixabayHit): StockPhoto {
  const scale = Math.min(1, STOCK_PHOTO_MAX_SIDE / Math.max(hit.imageWidth, hit.imageHeight))
  return {
    id: hit.id,
    preview: hit.previewURL,
    width: Math.max(1, Math.round(hit.imageWidth * scale)),
    height: Math.max(1, Math.round(hit.imageHeight * scale)),
    photographer: hit.user,
    tags: tagsOf(hit),
    page: hit.pageURL,
  }
}

/** The words Pixabay finds a photo by, once each, at most `TAGS_TOLD`. */
function tagsOf(hit: PixabayHit): string[] {
  const tags = hit.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return [...new Set(tags)].slice(0, TAGS_TOLD)
}

/**
 * A photo's name in the asset library: its first tags, whole, within `NAME_LENGTH` characters, the first word
 * capitalised; else its id.
 */
function nameOf(hit: PixabayHit): string {
  const [first, ...rest] = tagsOf(hit)
  if (!first) return `Pixabay photo ${hit.id}`
  let name = first
  for (const tag of rest) {
    if (name.length + 2 + tag.length > NAME_LENGTH) break
    name = `${name}, ${tag}`
  }
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`.slice(0, 120)
}

/** The seconds Pixabay says to wait after turning a request away: its reset header, else a minute. */
function resetSeconds(response: Response): number {
  const said = Number(response.headers.get('retry-after') ?? response.headers.get('x-ratelimit-reset'))
  return Number.isFinite(said) && said > 0 ? Math.min(said, 3600) : 60
}

/** `text` read as JSON, or undefined when it isn't. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
