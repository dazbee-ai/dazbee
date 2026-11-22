// Writes the illustrations' manifest (`src/illustrations.json`) from the sets' pinned sources: a repository set's SVG
// files from its GitHub archive at the commit `sets.ts` pins, and a gallery set's scenes in its style from the
// gallery's list pages, each file fetched from its link, one at a time. Every file is read with the SVG reader, and one
// it can't read whole, or larger than an upload may be, is left out. The manifest lists each one's source, SHA-256,
// size, drawn size, tags and topics; the files themselves are stored by `pnpm --filter @dazbee/api illustrations:upload`.
// Run `pnpm --filter @dazbee/graphics illustrations [folder]` after changing a pin, and the upload after it. A folder
// given keeps what the gallery served and is read again on the next run, so a run can be repeated without fetching.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { MAX_SVG_BYTES } from '@dazbee/schema'
import { svgToLayers } from '@dazbee/svg'

import { fetchLink, readRepositorySet } from './illustration-sources.ts'
import { topicsOf } from './illustration-topics.ts'
import type { IllustrationFile } from './illustrations.ts'
import { WORD_BREAK } from './search.ts'
import { linePerEntry, tagsOf } from './set-files.ts'
import { ILLUSTRATION_SET_IDS, ILLUSTRATION_SETS, type IllustrationSetId } from './sets.ts'

/** A scene a gallery's list page offers: its name, its style, its keywords and category, and its file's link. */
interface GalleryScene {
  name: string
  style: string
  words: string[]
  url: string
}

const PACKAGE = join(import.meta.dirname, '..')
/** How long to wait before each list page fetched from a gallery, and the most bytes one may have. */
const PAGE_PAUSE_MS = 2000
const MAX_PAGE_BYTES = 5_000_000
/** The longest word a scene's tags keep from what its gallery says of it. */
const MAX_TAG_LENGTH = 30
/** The most list pages a gallery is read to, so a page that links to itself can't keep the writer going. */
const MAX_PAGES = 200

const cache = process.argv[2]
if (cache) await mkdir(cache, { recursive: true })
const ck = await loadCanvasKit()
const entries: [string, IllustrationFile][] = []
for (const set of ILLUSTRATION_SET_IDS) {
  const before = entries.length
  let left = 0
  const add = (name: string, source: string, bytes: Uint8Array, words: readonly string[]) => {
    const file = checked(set, name, source, bytes, words)
    if (file) entries.push([`${set}/${name}`, file])
    else left++
  }
  const { source } = ILLUSTRATION_SETS[set]
  if ('repository' in source) {
    const files: [string, Uint8Array][] = []
    await readRepositorySet(set, async (path, bytes) => {
      files.push([path, bytes])
    })
    for (const [path, bytes] of files.sort(([a], [b]) => (a < b ? -1 : 1))) {
      const name = slugOf(path.slice(source.folder.length + 1, -'.svg'.length))
      add(name, path, bytes, name.split('-'))
    }
  } else {
    const named = new Set<string>()
    for (const scene of await galleryScenes(source)) {
      const name = unique(slugOf(scene.name), named)
      add(name, scene.url, await cached(scene.url, fetchLink), [...scene.name.split(WORD_BREAK), ...scene.words])
    }
  }
  console.log(`${set}: ${entries.length - before} illustrations listed, ${left} left out`)
}
await writeFile(join(PACKAGE, 'src', 'illustrations.json'), linePerEntry(entries))

/**
 * The file as the manifest lists it, its tags its own plain words and the set's, with the topics its words put it in;
 * undefined, told why, when it is larger than an upload may be or the SVG reader can't read it whole.
 */
function checked(
  set: IllustrationSetId,
  name: string,
  source: string,
  bytes: Uint8Array,
  words: readonly string[],
): IllustrationFile | undefined {
  if (bytes.length > MAX_SVG_BYTES) return leftOut(source, 'it is larger than an SVG upload may be')
  let read
  try {
    read = svgToLayers(ck, new TextDecoder().decode(bytes), { name })
  } catch (error) {
    return leftOut(source, error instanceof Error ? error.message : String(error))
  }
  if (read.skipped.length > 0) return leftOut(source, `the reader leaves out its ${read.skipped.join(', ')}`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const own = words
    .flatMap((word) => word.toLowerCase().split(WORD_BREAK))
    .filter((word) => word && word.length <= MAX_TAG_LENGTH)
  const tags = tagsOf([...own.filter((word) => !/^\d+$/.test(word)), ...ILLUSTRATION_SETS[set].tags])
  const topics = topicsOf(own).filter((topic) => !tags.includes(topic))
  const size = { width: Math.round(read.width * 100) / 100, height: Math.round(read.height * 100) / 100 }
  return { source, sha256, byteSize: bytes.length, ...size, tags, topics }
}

/** Tells why a file is left out of the manifest. */
function leftOut(source: string, why: string): undefined {
  console.log(`left out ${source}: ${why}`)
  return undefined
}

/** A name as an illustration's: `Team Meeting 2` as `team-meeting-2`. */
function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

/** The name, or with the first number after it that no scene of the set has yet, kept as taken. */
function unique(name: string, taken: Set<string>): string {
  let made = name
  for (let n = 2; taken.has(made); n++) made = `${name}-${n}`
  taken.add(made)
  return made
}
/**
 * The scenes a gallery's list pages offer in `galleryStyle` whose files are links to `files`, page after page as each
 * links to the next, a pause before each page; the link to the next page is the one whose number is one more.
 */
async function galleryScenes({
  gallery,
  galleryStyle,
  files,
}: {
  gallery: string
  galleryStyle: string
  files: string
}): Promise<GalleryScene[]> {
  const scenes: GalleryScene[] = []
  let url: string | undefined = gallery
  for (let page = 1; url && page <= MAX_PAGES; page++) {
    const html = new TextDecoder().decode(
      await cached(url, (page) => fetchLink(page, { pauseMs: PAGE_PAUSE_MS, maxBytes: MAX_PAGE_BYTES })),
    )
    scenes.push(...scenesOf(html).filter((scene) => scene.style === galleryStyle && scene.url.startsWith(files)))
    const next = new RegExp(`href="(\\?[0-9a-z]+_page=${page + 1})"`).exec(html)?.[1]
    url = next ? new URL(next, gallery).href : undefined
  }
  return scenes
}

/** The bytes at a link: from the folder given, when it kept them, else fetched and kept there. */
async function cached(url: string, get: (url: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!cache) return get(url)
  const file = join(cache, createHash('sha256').update(url).digest('hex'))
  try {
    return new Uint8Array(await readFile(file))
  } catch {
    const bytes = await get(url)
    await writeFile(file, bytes)
    return bytes
  }
}

/** A list page's scenes, as the gallery writes each one: an image of the file, then its keywords and category. */
function scenesOf(html: string): GalleryScene[] {
  return html
    .split('class="illustration_item ')
    .slice(1)
    .flatMap((item) => {
      const image = /<img imageCategory="Illustration" imageName="([^"]*)" src="(https:\/\/[^"]+\.svg)"/.exec(item)
      const field = (name: string) =>
        new RegExp(`fs-cmsfilter-field="${name}" class="hide">([^<]*)<`).exec(item)?.[1] ?? ''
      if (!image?.[1] || !image[2]) return []
      const words = [...field('keywords').split(','), field('category')].map(unescaped)
      return [{ name: unescaped(image[1]), style: field('styles'), words, url: image[2] }]
    })
}

/** HTML's escapes in a list page's text written as the characters they stand for. */
function unescaped(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .trim()
}
